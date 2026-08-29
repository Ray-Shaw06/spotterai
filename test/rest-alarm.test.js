import test from "node:test";
import assert from "node:assert/strict";

import { createRestAlarm, clampRestSeconds, silentWavBytes } from "../rest-alarm.js";

// ---------------------------------------------------------------------------
// A fake browser. Everything the alarm touches is recorded so the tests can
// assert on WHEN the tone was booked, which is the whole point of the module.
// ---------------------------------------------------------------------------
function fakeEnv({ withAudio = true, clockStart = 0 } = {}) {
  const log = { oscillators: [], sources: [], timeouts: [], elements: [], resumed: 0, played: 0, paused: 0, objectUrls: 0, revoked: 0 };
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

  if (withAudio) {
    env.AudioContext = function FakeContext() {
      this.currentTime = clockStart;
      this.sampleRate = 8000;
      this.destination = {};
      this.resume = () => {
        log.resumed += 1;
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

test("a silent looping element plays while armed, because Web Audio alone is not enough on iOS", () => {
  const clock = fakeClock();
  const { env, log } = fakeEnv();
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => {} });

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

test("the rest shows up on the lock screen, and clears when it ends", () => {
  const clock = fakeClock();
  const { env } = fakeEnv();
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => {} });

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
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => {} });

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
  const alarm = createRestAlarm({ env, now: clock.now, onFire: () => (fires += 1) });

  alarm.arm(15);
  assert.equal(log.elements.length, 0);
  assert.equal(log.oscillators.length, 3, "the Web Audio keepalive and the tone still stand");

  clock.advance(15_000);
  assert.equal(alarm.reconcile(), true);
  assert.equal(fires, 1);
});
