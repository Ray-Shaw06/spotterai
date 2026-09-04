import test from "node:test";
import assert from "node:assert/strict";

import { createRestAlarm, clampRestSeconds, silentWavBytes, restAudioMode, setRestAudioMode, REST_AUDIO_MODE_KEY, MIX, SOLO } from "../rest-alarm.js";

// ---------------------------------------------------------------------------
// A fake browser. Everything the alarm touches is recorded so the tests can
// assert on WHEN the tone was booked, which is the whole point of the module.
// ---------------------------------------------------------------------------
function fakeEnv({ withAudio = true, clockStart = 0, sessionTypes = ["auto", "playback", "transient", "transient-solo", "ambient", "play-and-record"], store = {} } = {}) {
  const log = { oscillators: [], sources: [], timeouts: [], elements: [], contexts: [], resumed: 0, played: 0, paused: 0, objectUrls: 0, revoked: 0 };
  const env = {
    navigator: {},
    setTimeout: (fn, ms) => {
      const id = log.timeouts.length + 1;
      log.timeouts.push({ id, fn, ms, cleared: false });
      return id;
    },
    clearTimeout: (id) => {
      const t = log.timeouts.find((x) => x.id === id);
      if (t) t.cleared = true;
    },
  };

  env.Blob = function FakeBlob(parts, opts) {
    this.parts = parts;
    this.type = opts?.type;
  };
  env.URL = {
    createObjectURL: () => {
      log.objectUrls += 1;
      return `blob:fake-${log.objectUrls}`;
    },
    revokeObjectURL: () => {
      log.revoked += 1;
    },
  };
  env.document = {};
  env.Audio = function FakeAudio() {
    const el = {
      src: "", loop: false, volume: 1,
      setAttribute(name, value) { el.attrs[name] = value; },
      attrs: {},
      listeners: {},
      addEventListener(ev, fn) { (el.listeners[ev] ||= []).push(fn); },
      emit(ev) { (el.listeners[ev] || []).forEach((fn) => fn()); },
      play() { log.played += 1; return Promise.resolve(); },
      pause() { log.paused += 1; },
    };
    log.elements.push(el);
    return el;
  };
  env.MediaMetadata = function FakeMetadata(init) {
    Object.assign(this, init);
  };
  env.navigator.mediaSession = { metadata: null, playbackState: "none" };

  // A real engine rejects an enum value it does not know. A permissive fake
  // would let a typo'd session type pass every test and stop music in the wild.
  let sessionType = "auto";
  log.sessionTypes = [];
  env.navigator.audioSession = {
    get type() {
      return sessionType;
    },
    set type(value) {
      if (!sessionTypes.includes(value)) throw new TypeError(`unsupported: ${value}`);
      sessionType = value;
      log.sessionTypes.push(value);
    },
  };

  env.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
  };

  if (withAudio) {
    env.AudioContext = function FakeContext() {
      this.currentTime = clockStart;
      this.sampleRate = 8000;
      this.destination = {};
      this.state = "running";
      this.listeners = {};
      this.addEventListener = (ev, fn) => {
        (this.listeners[ev] ||= []).push(fn);
      };
      this.emit = (ev) => (this.listeners[ev] || []).forEach((fn) => fn());
      this.resume = () => {
        log.resumed += 1;
        this.state = "running";
      };
      this.interrupt = () => {
        this.state = "suspended";
        this.emit("statechange");
      };
      this.close = () => {};
      this.createBuffer = (channels, length) => ({
        getChannelData: () => new Float32Array(length),
      });
      this.createBufferSource = () => {
        const node = { loop: false, started: false, stopped: false, connect() {}, disconnect() {}, start() { node.started = true; }, stop() { node.stopped = true; } };
        log.sources.push(node);
        return node;
      };
      this.createGain = () => ({
        connect() {},
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      });
      log.contexts.push(this);
      this.createOscillator = () => {
        const node = {
          type: "", frequency: { value: 0 }, startedAt: null, stoppedAt: null,
          connect() {}, disconnect() {},
          start(at) { node.startedAt = at; },
          stop(at) { node.stoppedAt = at; },
        };
        log.oscillators.push(node);
        return node;
      };
    };
  }
  return { env, log };
}

// A clock the test drives by hand, so nothing here waits on real time.
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

test("clampRestSeconds keeps rest inside a sane band", () => {
  assert.equal(clampRestSeconds(90), 90);
  assert.equal(clampRestSeconds(0), 1);
  assert.equal(clampRestSeconds(-30), 1);
  assert.equal(clampRestSeconds(99999), 3600);
  assert.equal(clampRestSeconds("120"), 120);
  assert.equal(clampRestSeconds(undefined), 1);
});

test("silentWavBytes is a well-formed, non-silent-by-bytes WAV", () => {
  const bytes = silentWavBytes(8000);
  const header = String.fromCharCode(...bytes.slice(0, 4));
  assert.equal(header, "RIFF");
  assert.equal(String.fromCharCode(...bytes.slice(8, 12)), "WAVE");
  assert.equal(bytes.length, 44 + 8000 * 2);
  // Digital silence gets a page suspended on some platforms; the samples must
  // not all be zero.
  assert.ok(bytes.slice(44).some((b) => b !== 0), "sample data must not be all zeroes");
});

test("remaining() reads the wall clock, so a frozen timer cannot lose time", () => {
  const clock = fakeClock();
  const { env } = fakeEnv();
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => {} });

  alarm.arm(120);
  assert.equal(alarm.remaining(), 120);

  // The screen locks. No interval runs, no timeout fires, 100 seconds pass.
  clock.advance(100_000);
  assert.equal(alarm.remaining(), 20, "the clock moved even though nothing ticked");

  clock.advance(30_000);
  assert.equal(alarm.remaining(), 0, "never goes negative");
});

test("the tone is booked on the audio timeline at arm time, not at fire time", () => {
  const clock = fakeClock();
  const { env, log } = fakeEnv({ clockStart: 5 });
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => {} });

  alarm.arm(90);

  assert.equal(log.resumed, 1, "the context is resumed inside the arming gesture");
  assert.equal(log.oscillators.length, 3, "three blips are scheduled up front");
  // Booked against the AUDIO clock (5) plus the rest period, which is what
  // survives JS being throttled.
  assert.equal(log.oscillators[0].startedAt, 95);
  assert.ok(log.oscillators[2].startedAt > 95, "blips are spaced, not stacked");
  assert.ok(log.oscillators.every((o) => o.stoppedAt > o.startedAt), "every blip has an end");
});

test("a keepalive source runs while armed and stops on disarm", () => {
  const clock = fakeClock();
  const { env, log } = fakeEnv();
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => {} });

  alarm.arm(60);
  assert.equal(log.sources.length, 1);
  assert.equal(log.sources[0].started, true);
  assert.equal(log.sources[0].loop, true, "it has to loop or the context goes idle");

  alarm.disarm();
  assert.equal(log.sources[0].stopped, true);
});

test("reconcile() fires once on wake when the deadline passed while hidden", () => {
  const clock = fakeClock();
  const { env } = fakeEnv();
  let fires = 0;
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => (fires += 1) });

  alarm.arm(60);
  assert.equal(alarm.reconcile(), false, "nothing owed yet");
  assert.equal(fires, 0);

  clock.advance(61_000); // phone was in a pocket
  assert.equal(alarm.reconcile(), true);
  assert.equal(fires, 1);

  // Waking again must not re-fire.
  assert.equal(alarm.reconcile(), false);
  assert.equal(fires, 1);
});

test("the setTimeout backstop and reconcile cannot double-fire", () => {
  const clock = fakeClock();
  const { env, log } = fakeEnv();
  let fires = 0;
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => (fires += 1) });

  alarm.arm(30);
  clock.advance(30_000);
  alarm.reconcile(); // the visible path gets there first
  assert.equal(fires, 1);

  log.timeouts.filter((t) => !t.cleared).forEach((t) => t.fn()); // now the throttled one lands
  assert.equal(fires, 1, "already fired, so the backstop is a no-op");
});

test("disarm() before the deadline cancels the tone and the backstop", () => {
  const clock = fakeClock();
  const { env, log } = fakeEnv();
  let fires = 0;
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => (fires += 1) });

  alarm.arm(120);
  alarm.disarm(); // user skipped rest

  assert.equal(alarm.armed(), false);
  assert.equal(alarm.remaining(), 0);
  assert.ok(log.timeouts.every((t) => t.cleared), "the backstop is cleared");

  clock.advance(200_000);
  assert.equal(alarm.reconcile(), false);
  assert.equal(fires, 0, "a skipped rest never fires");
});

test("re-arming moves the deadline and rebooks the tone", () => {
  const clock = fakeClock();
  const { env, log } = fakeEnv({ clockStart: 0 });
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => {} });

  alarm.arm(60);
  const first = log.oscillators.slice();
  clock.advance(10_000);

  alarm.arm(alarm.remaining() + 15); // "+15s" button: 50 left, so 65
  assert.equal(alarm.remaining(), 65);
  assert.equal(log.oscillators.length, 6, "a second set of blips is booked");
  assert.ok(first.every((o) => o.stoppedAt !== null), "the stale blips were cancelled");
});

test("no Web Audio at all still keeps a correct deadline and still fires", () => {
  const clock = fakeClock();
  const { env, log } = fakeEnv({ withAudio: false });
  let fires = 0;
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => (fires += 1) });

  alarm.arm(45);
  assert.equal(alarm.remaining(), 45);

  clock.advance(45_000);
  log.timeouts.filter((t) => !t.cleared).forEach((t) => t.fn());
  assert.equal(fires, 1, "vibration, notification and the screen carry it alone");
});

test("an onFire listener that throws still leaves the alarm disarmed", () => {
  const clock = fakeClock();
  const { env } = fakeEnv();
  const alarm = createRestAlarm({
    env,
    now: clock.now,
    onFire: () => {
      throw new Error("notification blew up");
    },
  });

  alarm.arm(10);
  clock.advance(10_000);
  assert.doesNotThrow(() => alarm.reconcile());
  assert.equal(alarm.armed(), false, "a broken listener must not strand an armed alarm");
});

test("solo mode plays a silent looping element, because Web Audio alone is not enough on iOS", () => {
  const clock = fakeClock();
  const { env, log } = fakeEnv();
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => {}, mode: SOLO });

  alarm.arm(120);
  assert.equal(log.elements.length, 1);
  const el = log.elements[0];
  assert.equal(el.loop, true, "a one-shot would stop holding the page after a second");
  assert.equal(el.attrs.playsinline, "", "iOS refuses to play inline without it");
  assert.match(el.src, /^blob:/, "the WAV is built in-process, so there is nothing to fetch on a cold cache");
  assert.equal(log.played, 1);

  alarm.disarm();
  assert.equal(log.paused, 1, "nothing keeps the audio thread alive outside an armed rest");
});

test("solo mode shows the rest on the lock screen, and clears it when it ends", () => {
  const clock = fakeClock();
  const { env } = fakeEnv();
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => {}, mode: SOLO });

  alarm.arm(150);
  assert.equal(env.navigator.mediaSession.playbackState, "playing");
  assert.equal(env.navigator.mediaSession.metadata.title, "Rest 2:30");
  assert.equal(env.navigator.mediaSession.metadata.artist, "SpotterAI");

  alarm.disarm();
  assert.equal(env.navigator.mediaSession.playbackState, "none", "an invisible background player is worse than none");
});

test("a missing MediaSession is decoration failing, not the alarm failing", () => {
  const clock = fakeClock();
  const { env } = fakeEnv();
  delete env.navigator.mediaSession;
  let fires = 0;
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => (fires += 1) });

  assert.doesNotThrow(() => alarm.arm(20));
  clock.advance(20_000);
  assert.equal(alarm.reconcile(), true);
  assert.equal(fires, 1);
});

test("destroy() releases the object URL and closes the context", () => {
  const clock = fakeClock();
  const { env, log } = fakeEnv();
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => {}, mode: SOLO });

  alarm.arm(60);
  alarm.destroy();

  assert.equal(alarm.armed(), false);
  assert.equal(log.paused, 1);
  assert.equal(log.revoked, 1, "the blob URL leaks for the life of the document otherwise");

  // And it stays usable: arm() rebuilds whatever destroy() tore down.
  assert.doesNotThrow(() => alarm.arm(30));
  assert.equal(alarm.remaining(), 30);
});

test("no media element support still leaves a working alarm", () => {
  const clock = fakeClock();
  const { env, log } = fakeEnv();
  delete env.Audio;
  let fires = 0;
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => (fires += 1), mode: SOLO });

  alarm.arm(15);
  assert.equal(log.elements.length, 0);
  assert.equal(log.oscillators.length, 3, "the Web Audio keepalive and the tone still stand");

  clock.advance(15_000);
  assert.equal(alarm.reconcile(), true);
  assert.equal(fires, 1);
});

// ---------------------------------------------------------------------------
// iOS hardening: the three ways a correctly scheduled tone still makes no sound
// ---------------------------------------------------------------------------

test("arming declares a MIXABLE session by default, so music keeps playing", () => {
  const clock = fakeClock();
  const { env } = fakeEnv();
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => {} });

  assert.equal(env.navigator.audioSession.type, "auto");
  alarm.arm(120);
  // "playback" is non-mixable: it STOPS Spotify the moment a set is checked
  // off, for the whole rest, which is the bug this default exists to avoid.
  assert.equal(env.navigator.audioSession.type, "ambient");
  assert.notEqual(env.navigator.audioSession.type, "playback");
});

test("mix mode falls back to ducking when the engine has no ambient session", () => {
  const clock = fakeClock();
  // An older WebKit: it knows transient but not ambient.
  const { env } = fakeEnv({ sessionTypes: ["auto", "playback", "transient"] });
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => {} });

  alarm.arm(60);
  // Second best, and still never stops the track: it dips and comes back.
  assert.equal(env.navigator.audioSession.type, "transient");
});

test("mix mode never takes the lock screen or starts a competing player", () => {
  const clock = fakeClock();
  const { env, log } = fakeEnv();
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => {} });

  alarm.arm(120);

  assert.equal(log.elements.length, 0, "a looping element competes for the one Now Playing slot");
  assert.equal(log.played, 0);
  assert.equal(env.navigator.mediaSession.metadata, null, "the lock screen belongs to whatever is actually playing");
  assert.equal(env.navigator.mediaSession.playbackState, "none");
  // The tone itself is still booked: mixing is not the same as going quiet.
  assert.equal(log.oscillators.length, 3);
  assert.equal(log.sources.length, 1, "the inaudible keepalive is mixable, so it stays in both modes");
});

test("mix mode leaves a foreign mediaSession state alone on disarm", () => {
  const clock = fakeClock();
  const { env } = fakeEnv();
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => {} });

  env.navigator.mediaSession.playbackState = "playing"; // the user's music app
  alarm.arm(60);
  alarm.disarm();
  assert.equal(env.navigator.mediaSession.playbackState, "playing", "we never announced, so this is not ours to clear");
});

test("solo mode is opt-in and still takes the session for a silenced phone", () => {
  const clock = fakeClock();
  const { env, log } = fakeEnv();
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => {}, mode: SOLO });

  alarm.arm(120);
  // Rings through the ring/silent switch, at the cost of interrupting music.
  assert.equal(env.navigator.audioSession.type, "playback");
  assert.equal(log.elements.length, 1);
  assert.equal(env.navigator.mediaSession.playbackState, "playing");
});

test("the session type is handed back on disarm, not held between sets", () => {
  const clock = fakeClock();
  const { env } = fakeEnv();
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => {} });

  alarm.arm(60);
  assert.equal(env.navigator.audioSession.type, "ambient");
  alarm.disarm();
  assert.equal(env.navigator.audioSession.type, "auto", "a claim on the mixer we are not using is a claim to give back");
});

test("the mode is read fresh on each arm, so the toggle takes effect next rest", () => {
  const clock = fakeClock();
  const store = {};
  const { env, log } = fakeEnv({ store });
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => {} });

  alarm.arm(60);
  assert.equal(alarm.mode(), MIX);
  assert.equal(log.elements.length, 0);

  setRestAudioMode(SOLO, env);
  alarm.arm(60);
  assert.equal(alarm.mode(), SOLO, "no reload required");
  assert.equal(log.elements.length, 1);
});

test("the stored mode defaults to mix, and only an exact opt-in reads as solo", () => {
  const store = {};
  const { env } = fakeEnv({ store });

  assert.equal(restAudioMode(env), MIX, "taking over someone's music is never the default");

  setRestAudioMode(SOLO, env);
  assert.equal(store[REST_AUDIO_MODE_KEY], "solo");
  assert.equal(restAudioMode(env), SOLO);

  setRestAudioMode(MIX, env);
  assert.equal(restAudioMode(env), MIX);

  store[REST_AUDIO_MODE_KEY] = "banana"; // corrupt or from a future build
  assert.equal(restAudioMode(env), MIX, "an unreadable value must fall back to the quiet-neighbour mode");
});

test("storage that throws does not stop the alarm arming in mix mode", () => {
  const clock = fakeClock();
  const { env } = fakeEnv();
  env.localStorage = {
    getItem() {
      throw new Error("storage disabled");
    },
    setItem() {
      throw new Error("storage disabled");
    },
  };

  assert.equal(restAudioMode(env), MIX);
  assert.doesNotThrow(() => setRestAudioMode(SOLO, env));
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => {} });
  assert.doesNotThrow(() => alarm.arm(45));
  assert.equal(alarm.mode(), MIX);
  assert.equal(alarm.remaining(), 45);
});

test("no audioSession support is not an error", () => {
  const clock = fakeClock();
  const { env } = fakeEnv();
  delete env.navigator.audioSession;
  let fires = 0;
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => (fires += 1) });

  assert.doesNotThrow(() => alarm.arm(15));
  clock.advance(15_000);
  assert.equal(alarm.reconcile(), true);
  assert.equal(fires, 1);
});

test("a read-only audioSession does not break arming", () => {
  const clock = fakeClock();
  const { env } = fakeEnv();
  Object.defineProperty(env.navigator, "audioSession", {
    configurable: true,
    get: () => ({ get type() { return "auto"; }, set type(_v) { throw new Error("read-only"); } }),
  });
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => {} });
  assert.doesNotThrow(() => alarm.arm(60));
  assert.equal(alarm.remaining(), 60);
  assert.doesNotThrow(() => alarm.disarm());
});

test("an engine that silently ignores a type falls through instead of believing it", () => {
  const clock = fakeClock();
  const { env } = fakeEnv();
  // WebKit shipped `ambient` after `transient`, and an engine that has neither
  // may swallow the assignment rather than throw. Reading the value back is the
  // only way to tell "accepted" from "ignored"; take it on trust and we stop at
  // the first candidate, leaving the session on a type that stops music.
  let current = "auto";
  const writes = [];
  Object.defineProperty(env.navigator, "audioSession", {
    configurable: true,
    value: Object.defineProperty({}, "type", {
      get: () => current,
      set: (v) => {
        writes.push(v);
        if (v !== "ambient") current = v; // ambient is ignored, not rejected
      },
    }),
  });

  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => {} });
  alarm.arm(60);

  assert.deepEqual(writes, ["ambient", "transient"], "the ignored value must not end the search");
  assert.equal(env.navigator.audioSession.type, "transient", "ducking is the fallback, and it still never stops the track");

  alarm.disarm();
  assert.equal(env.navigator.audioSession.type, "auto", "and the one we did land on is handed back");
});

test("a session left untouched is never 'restored' over", () => {
  const clock = fakeClock();
  const { env } = fakeEnv();
  // Every candidate is ignored, so we changed nothing. Writing a remembered
  // value back on disarm would be this page stamping the OS mixer for no
  // reason, on top of a session another app may since have taken.
  const writes = [];
  Object.defineProperty(env.navigator, "audioSession", {
    configurable: true,
    value: Object.defineProperty({}, "type", {
      get: () => "auto",
      set: (v) => writes.push(v),
    }),
  });

  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => {} });
  alarm.arm(60);
  const attempted = writes.length;
  alarm.disarm();

  assert.equal(writes.length, attempted, "nothing took, so disarm has nothing to put back");
});

test("an interrupted context is resumed while armed", () => {
  const clock = fakeClock();
  const { env, log } = fakeEnv();
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => {} });

  alarm.arm(120);
  const ctx = log.contexts[0];
  const before = log.resumed;

  ctx.interrupt(); // a phone call takes the audio session mid-rest
  assert.equal(log.resumed, before + 1, "nothing else wakes it, so the tone would be dropped");
  assert.equal(ctx.state, "running");
});

test("a context that drops out while NOT armed is left alone", () => {
  const clock = fakeClock();
  const { env, log } = fakeEnv();
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => {} });

  alarm.arm(60);
  alarm.disarm();
  const ctx = log.contexts[0];
  const before = log.resumed;

  ctx.interrupt();
  assert.equal(log.resumed, before, "holding the audio thread open between sets is a battery cost, not a feature");
});

test("an element paused by an interruption restarts while armed", () => {
  const clock = fakeClock();
  const { env, log } = fakeEnv();
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => {}, mode: SOLO });

  alarm.arm(120);
  const el = log.elements[0];
  assert.equal(log.played, 1);

  el.emit("pause"); // iOS pauses it and never resumes it on its own
  assert.equal(log.played, 2, "otherwise the page silently leaves playing-media state mid-rest");
});

test("the element is not restarted after the rest ends", () => {
  const clock = fakeClock();
  const { env, log } = fakeEnv();
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => {}, mode: SOLO });

  alarm.arm(60);
  const el = log.elements[0];
  alarm.disarm();
  const played = log.played;

  el.emit("pause");
  assert.equal(log.played, played, "a disarmed alarm must not keep an audio element alive");
});
