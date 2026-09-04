/**
 * SpotterAI — rest alarm that survives a locked screen (zero-cost, on-device)
 * ============================================================================
 * The rest timer used to count down with `restRemaining -= 1` on a one-second
 * interval, and to build a fresh AudioContext at the moment it fired. Both
 * break on a phone in your pocket:
 *
 *   1. Mobile browsers clamp or freeze background timers when the screen locks,
 *      so the countdown stopped with the screen and resumed on unlock. The
 *      alert was not a second late, it was however long the phone was away.
 *   2. A context constructed outside a user gesture starts SUSPENDED on iOS,
 *      so even when the timer did fire, it fired silently.
 *
 * This module fixes both:
 *
 *   - The deadline is wall-clock (`endsAt`), so a frozen interval loses display
 *     frames and never loses time.
 *   - `arm()` runs inside the set-done tap, a real user gesture, which is the
 *     only moment the context can be unlocked. The tone is then scheduled on
 *     the AUDIO timeline (`start(when)`), which runs on the audio thread and is
 *     not subject to timer throttling. That is what makes the sound land on
 *     time rather than on unlock.
 *   - A near-silent looping source (Web Audio) plus a silent looping <audio>
 *     element hold the page in a playing-media state, because iOS suspends a
 *     context with nothing playing through it.
 *   - `navigator.audioSession.type` (WebKit, iOS 16.4+) declares what this page
 *     is to the OS mixer, and that single value decides whether your music
 *     survives the rest timer. See AUDIO MODES below.
 *   - iOS can suspend the context or pause the element on an audio-session
 *     interruption (a call, another app taking the session). Both are watched
 *     while armed and restarted, because a keepalive that dies silently is
 *     worse than no keepalive: it looks fine right up until it matters.
 *   - `reconcile()` on wake fires immediately if the deadline passed while
 *     hidden and nothing fired, so the worst case is exactly today's behaviour.
 *
 * AUDIO MODES
 * -----------
 * The alarm holds an audio session for the WHOLE rest, not just for the beep,
 * because that is what stops iOS suspending the tone we booked. Which session
 * it holds is therefore the difference between an alarm you can hear and an
 * alarm that stops your music for two minutes at a time.
 *
 *   "mix" (default) — your music keeps playing.
 *     Session type `ambient` (falling back to `transient`), which the OS mixer
 *     treats as mixable: other apps keep the output at full volume and the
 *     blips play OVER the track. No silent <audio> element and no MediaSession
 *     metadata, so Spotify keeps the lock screen and your headphone buttons
 *     keep controlling Spotify rather than a rest timer.
 *     The price, stated honestly: an ambient session is silenced by the ring/
 *     silent switch, and iOS may drop it once the app has been in the
 *     background a while, so a long locked-screen rest can come back to
 *     vibration and the notification rather than the tone.
 *
 *   "solo" (opt-in) — the alarm wins, your music does not.
 *     Session type `playback` plus the silent looping element and the lock
 *     screen entry. Loudest and the most likely to survive a locked screen: it
 *     rings through the silent switch. It also INTERRUPTS whatever else is
 *     playing for the length of the rest, which is why it is no longer the
 *     default. For people who train without music, it is strictly better.
 *
 * Either way the session type is put back the way we found it on disarm, so
 * between sets this page is not sitting on the OS mixer at all.
 *
 * HONEST LIMIT, and it is the same one the rest of the app keeps: if the OS
 * evicts the tab or you force-quit the app, NOTHING fires. This is a
 * page-alive alarm, not a scheduled push. See the 2026-07-22 decision to retire
 * Web Push, which this does not reopen: no server, no subscription, no key.
 *
 * Pure enough to test: every browser API is reached through an injected `env`
 * and guarded, so the deadline logic runs headless in Node.
 */

/** Alert tone: three rising blips, offsets in seconds from the deadline. */
const BLIPS = [
  { at: 0, freq: 880, dur: 0.18 },
  { at: 0.22, freq: 1046, dur: 0.18 },
  { at: 0.44, freq: 1318, dur: 0.34 },
];
const PEAK_GAIN = 0.28;

/** Amplitude of the keepalive source. -80dBFS: inaudible, but not digital silence,
 *  which some platforms treat as "nothing is playing" and suspend anyway. */
const KEEPALIVE_AMPLITUDE = 0.0001;

const MIN_REST_SEC = 1;
const MAX_REST_SEC = 60 * 60;

/** Audio modes. See AUDIO MODES at the top of the file for the trade-off. */
export const MIX = "mix";
export const SOLO = "solo";
export const REST_AUDIO_MODE_KEY = "spotterai.restAlarm.audioMode";

/**
 * Session types to try, in order, per mode. The first one the browser accepts
 * wins; an unknown enum value throws under WebIDL, which is why this is a list
 * and not a constant.
 *
 * `ambient` is mixable: other apps keep the output at full volume. `transient`
 * only DUCKS them, which is second best but still never stops the music, so it
 * is the fallback for a WebKit that predates `ambient`. `playback` is the one
 * that interrupts, and it appears under SOLO only.
 */
const SESSION_TYPES = Object.freeze({
  [MIX]: Object.freeze(["ambient", "transient"]),
  [SOLO]: Object.freeze(["playback"]),
});

function safeLocalStorage(env) {
  try {
    return env.localStorage || null;
  } catch {
    return null; // storage can throw outright in locked-down contexts
  }
}

/** The stored mode for this device. Anything unrecognised reads as "mix":
 *  taking over someone's music is opt-in, never the result of a bad value. */
export function restAudioMode(env = globalThis) {
  try {
    return safeLocalStorage(env)?.getItem(REST_AUDIO_MODE_KEY) === SOLO ? SOLO : MIX;
  } catch {
    return MIX;
  }
}

export function setRestAudioMode(mode, env = globalThis) {
  const next = mode === SOLO ? SOLO : MIX;
  try {
    safeLocalStorage(env)?.setItem(REST_AUDIO_MODE_KEY, next);
  } catch {
    /* storage disabled; the alarm still honours the default for this session */
  }
  return next;
}

/** A one-second mono WAV of near-silence, as bytes. Built here rather than
 *  shipped as an asset so the alarm has nothing to fetch and cannot fail on a
 *  cold cache. */
export function silentWavBytes(sampleRate = 8000) {
  const samples = sampleRate; // one second
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, samples * 2, true);
  // Alternating +/-1 LSB. Non-zero samples, ~-90dBFS, inaudible.
  for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, i % 2 ? 1 : -1, true);
  return bytes;
}

export function clampRestSeconds(sec) {
  const n = Math.round(Number(sec) || 0);
  if (!Number.isFinite(n)) return MIN_REST_SEC;
  return Math.min(MAX_REST_SEC, Math.max(MIN_REST_SEC, n));
}

/**
 * Create an alarm. Every dependency is injectable so the timing logic can be
 * asserted without a browser.
 *
 *   onFire()  — runs once when the rest period ends (vibration, notification,
 *               UI reset). Audio is NOT its job; the tone is already scheduled.
 *   mode      — "mix" | "solo", or a function returning one. Read fresh on every
 *               arm(), so flipping the preference takes effect on the next rest
 *               rather than on the next reload.
 */
export function createRestAlarm({ env = globalThis, onFire = () => {}, now = () => Date.now(), mode = () => restAudioMode(env) } = {}) {
  const resolveMode = typeof mode === "function" ? () => (mode() === SOLO ? SOLO : MIX) : () => (mode === SOLO ? SOLO : MIX);
  let activeMode = MIX;

  let endsAt = 0;
  let fired = true; // nothing armed yet, so nothing is owed
  let fallbackId = null;

  let ctx = null;
  let keepaliveNode = null;
  let scheduled = []; // oscillator nodes booked on the audio timeline
  let element = null; // silent looping <audio>
  let contextWatched = false;
  let elementUrl = null;
  let priorSessionType = null; // what the page's session was before we armed
  let announced = false; // did we take the lock screen? only then do we give it back

  // --- Web Audio ------------------------------------------------------------

  /**
   * Declare an audio session (WebKit, iOS 16.4+) for the mode we are arming in.
   * This is the switch that decides whether the rest timer plays alongside your
   * music or stops it dead, so it is set before the tone is ever scheduled.
   * Feature-detected: every other browser has no navigator.audioSession and is
   * unaffected.
   *
   * Each candidate is assigned and then read back, because an unsupported enum
   * value can either throw or be silently ignored depending on the engine, and
   * a session we only THINK we set is how music ends up stopped anyway.
   */
  function declareAudioSession(forMode) {
    try {
      const session = env.navigator?.audioSession;
      if (!session) return;
      const wanted = SESSION_TYPES[forMode] || SESSION_TYPES[MIX];
      if (wanted.includes(session.type)) return; // already what we need
      const before = session.type;
      for (const type of wanted) {
        try {
          session.type = type;
          if (session.type === type) {
            priorSessionType = before;
            return;
          }
        } catch {
          /* this engine does not know this value; try the next one down */
        }
      }
    } catch {
      /* read-only or unsupported; the rest of the alarm is unchanged */
    }
  }

  /**
   * Hand the session back. Holding `ambient` — let alone `playback` — between
   * sets means the page keeps a claim on the OS mixer for a whole workout, and
   * a claim we are not using is exactly the kind of thing that gets an app
   * blamed for someone's music behaving oddly.
   */
  function restoreAudioSession() {
    if (priorSessionType == null) return;
    const prior = priorSessionType;
    priorSessionType = null;
    try {
      const session = env.navigator?.audioSession;
      if (session) session.type = prior;
    } catch {
      /* read-only; nothing else depends on this succeeding */
    }
  }

  function audioContext() {
    if (ctx) return ctx;
    const Ctor = env.AudioContext || env.webkitAudioContext;
    if (typeof Ctor !== "function") return null;
    try {
      ctx = new Ctor();
    } catch {
      ctx = null; // audio unavailable; vibration, notification and the screen stand alone
    }
    return ctx;
  }

  /** Near-silent loop so the context is never idle enough to be suspended. */
  function startKeepalive(context) {
    if (keepaliveNode || typeof context.createBufferSource !== "function") return;
    try {
      const buffer = context.createBuffer(1, Math.max(1, Math.floor(context.sampleRate || 44100)), context.sampleRate || 44100);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < channel.length; i++) channel[i] = i % 2 ? KEEPALIVE_AMPLITUDE : -KEEPALIVE_AMPLITUDE;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(context.destination);
      source.start();
      keepaliveNode = source;
    } catch {
      /* keepalive is a best effort; reconcile() still covers the wake path */
    }
  }

  /**
   * iOS suspends the context when another app takes the audio session (a call,
   * a video). Nothing wakes it on its own, so the scheduled tone would be
   * silently dropped. Resume whenever it drops out from under us while armed.
   */
  function watchContext(context) {
    if (contextWatched || typeof context.addEventListener !== "function") return;
    contextWatched = true;
    try {
      context.addEventListener("statechange", () => {
        if (!armed() || context.state === "running") return;
        try {
          context.resume?.();
        } catch {
          /* reconcile() on wake is still the floor */
        }
      });
    } catch {
      /* no event support; nothing lost */
    }
  }

  function stopKeepalive() {
    try {
      keepaliveNode?.stop();
    } catch {
      /* already stopped */
    }
    try {
      keepaliveNode?.disconnect();
    } catch {
      /* already detached */
    }
    keepaliveNode = null;
  }

  /**
   * Book the tone on the audio clock. `seconds` is the delay from now, so the
   * blips are queued at absolute audio times and play without JS being awake.
   */
  function scheduleTone(context, seconds) {
    if (typeof context.createOscillator !== "function") return;
    const base = (context.currentTime || 0) + Math.max(0, seconds);
    for (const blip of BLIPS) {
      try {
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.connect(gain);
        gain.connect(context.destination);
        osc.type = "sine";
        osc.frequency.value = blip.freq;
        const at = base + blip.at;
        // Exponential ramps cannot touch zero, hence the tiny floor either side.
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + blip.dur);
        osc.start(at);
        osc.stop(at + blip.dur + 0.02);
        scheduled.push(osc);
      } catch {
        /* one blip failing must not cost the others */
      }
    }
  }

  function cancelTone() {
    for (const osc of scheduled) {
      try {
        osc.stop();
      } catch {
        /* already finished */
      }
      try {
        osc.disconnect();
      } catch {
        /* already detached */
      }
    }
    scheduled = [];
  }

  // --- Silent media element -------------------------------------------------

  /**
   * iOS keeps a page's audio alive while a media element is playing. The Web
   * Audio keepalive alone is not always enough, and this costs one looping
   * element of digital near-silence.
   */
  function startElement() {
    if (element || !env.document || typeof env.Audio !== "function") return;
    try {
      if (!elementUrl) {
        const BlobCtor = env.Blob;
        const url = env.URL;
        if (typeof BlobCtor !== "function" || !url || typeof url.createObjectURL !== "function") return;
        elementUrl = url.createObjectURL(new BlobCtor([silentWavBytes()], { type: "audio/wav" }));
      }
      const audio = new env.Audio();
      audio.src = elementUrl;
      audio.loop = true;
      audio.volume = 0.01;
      audio.setAttribute?.("playsinline", "");
      // Same interruption problem as the context: iOS pauses the element and
      // never resumes it, which drops the page out of playing-media state and
      // lets the whole keepalive lapse mid-rest.
      audio.addEventListener?.("pause", () => {
        if (element !== audio || !armed()) return;
        try {
          audio.play?.()?.catch?.(() => {});
        } catch {
          /* blocked; the Web Audio keepalive and reconcile() still apply */
        }
      });
      const played = audio.play?.();
      if (played && typeof played.catch === "function") played.catch(() => {});
      element = audio;
    } catch {
      /* blocked; the Web Audio keepalive and reconcile() still apply */
    }
  }

  function stopElement() {
    try {
      element?.pause();
    } catch {
      /* already paused */
    }
    element = null;
  }

  /**
   * Put the rest on the lock screen rather than being an invisible player.
   *
   * SOLO ONLY. There is exactly one Now Playing slot on a phone, so doing this
   * while someone has music on replaces their track with "Rest 2:30" and points
   * their headphone play/pause button at a timer. In mix mode we are a guest on
   * the output and leave the lock screen to whoever is actually playing.
   */
  function announce(seconds) {
    const media = env.navigator?.mediaSession;
    if (!media) return;
    try {
      if (typeof env.MediaMetadata === "function") {
        media.metadata = new env.MediaMetadata({
          title: `Rest ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
          artist: "SpotterAI",
          album: "Workout",
        });
      }
      media.playbackState = "playing";
      announced = true;
    } catch {
      /* metadata is decoration; never let it break the alarm */
    }
  }

  /** Only ever clears an announcement we made. Writing "none" over a state we
   *  never set would stop the lock screen reflecting someone else's player. */
  function silenceAnnouncement() {
    if (!announced) return;
    announced = false;
    try {
      const media = env.navigator?.mediaSession;
      if (media) media.playbackState = "none";
    } catch {
      /* ignore */
    }
  }

  // --- Public surface -------------------------------------------------------

  function fire() {
    if (fired) return false;
    fired = true;
    clearFallback();
    try {
      onFire();
    } catch {
      /* a listener throwing must not leave the alarm armed */
    }
    return true;
  }

  function clearFallback() {
    if (fallbackId != null) {
      try {
        env.clearTimeout?.(fallbackId);
      } catch {
        /* ignore */
      }
      fallbackId = null;
    }
  }

  /**
   * Start a rest period. MUST be called from a user gesture: that is the only
   * moment the AudioContext can be resumed, and an armed alarm that cannot make
   * a sound is the bug this module exists to fix.
   */
  function arm(seconds) {
    const sec = clampRestSeconds(seconds);
    disarm();
    activeMode = resolveMode();
    endsAt = now() + sec * 1000;
    fired = false;

    // Before anything else: on iOS this decides whether the tone shares the
    // output with your music or takes it away, and it has to be set while we
    // still hold the gesture.
    declareAudioSession(activeMode);

    const context = audioContext();
    if (context) {
      // Resume inside the gesture, then schedule against the running clock.
      try {
        context.resume?.();
      } catch {
        /* a blocked resume still leaves the fallback path intact */
      }
      watchContext(context);
      // Mixable and inaudible, so this is the one keepalive that costs a
      // listener nothing. It runs in both modes.
      startKeepalive(context);
      scheduleTone(context, sec);
    }
    // The element and the lock screen entry are how a page announces itself as
    // THE thing playing. That is what solo is for and what mix must not do.
    if (activeMode === SOLO) {
      startElement();
      announce(sec);
    }

    // Backstop for the non-audio side (vibration, notification, UI). Throttling
    // can delay this; reconcile() is what makes the delay recoverable.
    if (typeof env.setTimeout === "function") {
      fallbackId = env.setTimeout(() => {
        fallbackId = null;
        fire();
      }, sec * 1000);
    }
    return endsAt;
  }

  function disarm() {
    clearFallback();
    cancelTone();
    stopKeepalive();
    stopElement();
    silenceAnnouncement();
    restoreAudioSession();
    endsAt = 0;
    fired = true;
  }

  /** Seconds left, from the clock. Never negative. */
  function remaining() {
    if (!endsAt) return 0;
    return Math.max(0, Math.ceil((endsAt - now()) / 1000));
  }

  const armed = () => !fired && endsAt > 0;

  /**
   * Called on wake. If the deadline passed while the page was hidden and the
   * throttled fallback never ran, fire now. Returns true when it caught up.
   */
  function reconcile() {
    if (!armed()) return false;
    if (now() < endsAt) return false;
    return fire();
  }

  /** Release the object URL. Only for teardown; arm() rebuilds what it needs. */
  function destroy() {
    disarm();
    if (elementUrl) {
      try {
        env.URL?.revokeObjectURL?.(elementUrl);
      } catch {
        /* ignore */
      }
      elementUrl = null;
    }
    try {
      ctx?.close?.();
    } catch {
      /* ignore */
    }
    ctx = null;
    contextWatched = false;
  }

  return { arm, disarm, remaining, reconcile, destroy, armed, endsAt: () => endsAt, mode: () => activeMode };
}
