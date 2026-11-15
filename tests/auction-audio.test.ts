import assert from "node:assert/strict";
import { test } from "node:test";
import { AuctionAudioEngine, DEFAULT_SOUND_PREFERENCES, LiveAuctionSoundTracker, parseSoundPreferences, renderAuctionSound, type SoundActivity } from "../lib/auction-audio.ts";

const event = (id: string, at: number, type = "bid", text = "A bid was accepted."): SoundActivity => ({ id, at, type, text });

test("sound starts disabled with a restrained volume", () => {
  assert.deepEqual(parseSoundPreferences(null), { enabled: false, volume: 0.35 });
  assert.deepEqual(parseSoundPreferences("bad json"), DEFAULT_SOUND_PREFERENCES);
  assert.deepEqual(parseSoundPreferences('{"enabled":"yes","volume":"loud"}'), DEFAULT_SOUND_PREFERENCES);
  assert.equal(parseSoundPreferences('{"enabled":true,"volume":100}').volume, 1);
  assert.equal(parseSoundPreferences('{"enabled":true,"volume":-2}').volume, 0);
});

test("the initial room snapshot never plays historical bids or sales", () => {
  const tracker = new LiveAuctionSoundTracker();
  assert.deepEqual(tracker.observe("room", [event("one", 50), event("sale", 75, "sold")]), []);
  assert.deepEqual(tracker.observe("room", [event("one", 50), event("sale", 75, "sold"), event("two", 90)]), ["bid"]);
});

test("the same confirmed event does not replay on polling or duplicate delivery", () => {
  const tracker = new LiveAuctionSoundTracker();
  tracker.observe("room", []);
  const update = [event("one", 50)];
  assert.deepEqual(tracker.observe("room", update), ["bid"]);
  assert.deepEqual(tracker.observe("room", [...update]), []);
  assert.deepEqual(tracker.observe("room", [...update, ...update]), []);
});

test("history backfills and stale snapshots do not create phantom bids", () => {
  const tracker = new LiveAuctionSoundTracker();
  tracker.observe("room", [event("one", 100)]);
  assert.deepEqual(tracker.observe("room", [event("older-unseen", 10), event("one", 100)]), []);
  assert.deepEqual(tracker.observe("room", [event("another-old", 25)]), []);
  assert.deepEqual(tracker.observe("room", [event("one", 100), event("new", 150)]), ["bid"]);
});

test("distinct live events with identical timestamps are not discarded", () => {
  const tracker = new LiveAuctionSoundTracker();
  tracker.observe("room", [event("first", 100)]);
  assert.deepEqual(tracker.observe("room", [event("first", 100), event("second", 100)]), ["bid"]);
  assert.deepEqual(tracker.observe("room", [event("first", 100), event("second", 100)]), []);
});

test("reconnection baselines missed activity instead of replaying it", () => {
  const tracker = new LiveAuctionSoundTracker();
  tracker.observe("room", [event("one", 100)]);
  tracker.observe("room", [event("one", 100)], false);
  assert.deepEqual(tracker.observe("room", [event("one", 100), event("missed", 200, "sold")]), []);
  assert.deepEqual(tracker.observe("room", [event("one", 100), event("missed", 200, "sold"), event("live", 300)]), ["bid"]);
});

test("joining a different room never announces that room's existing activity", () => {
  const tracker = new LiveAuctionSoundTracker();
  tracker.observe("first", []);
  assert.deepEqual(tracker.observe("first", [event("one", 200)]), ["bid"]);
  assert.deepEqual(tracker.observe("second", [event("two", 1000, "sold")]), []);
  assert.deepEqual(tracker.observe("second", [event("two", 1000, "sold"), event("three", 1200)]), ["bid"]);
});

test("locks and confirmed sales have distinct cues; chat never plays a sale cue", () => {
  const tracker = new LiveAuctionSoundTracker();
  tracker.observe("room", []);
  assert.deepEqual(tracker.observe("room", [event("chat", 10, "chat", "Sold! Bidding locked.")]), []);
  assert.deepEqual(tracker.observe("room", [event("locked", 20, "auction", "Bidding locked. No further bids are accepted.")]), ["lock"]);
  assert.deepEqual(tracker.observe("room", [event("sale", 30, "sold")]), ["sold"]);
});

test("a delayed batch plays one cue, prioritizing the final confirmed sale", () => {
  const tracker = new LiveAuctionSoundTracker();
  tracker.observe("room", []);
  const batch = [event("one", 10), event("two", 20), event("three", 30, "lock"), event("four", 40, "sold")];
  assert.deepEqual(tracker.observe("room", batch), ["sold"]);
  assert.deepEqual(tracker.observe("room", batch), []);
});

test("old IDs remain silent after bounded deduplication history rolls over", () => {
  const tracker = new LiveAuctionSoundTracker();
  tracker.observe("room", []);
  tracker.observe("room", Array.from({ length: 800 }, (_, index) => event(`id-${index}`, index)));
  assert.deepEqual(tracker.observe("room", [event("id-0", 0)]), []);
});

test("the audio engine cannot autoplay before a gesture has opened a context", async () => {
  const engine = new AuctionAudioEngine();
  engine.setPreferences({ enabled: true, volume: 0.4 });
  assert.equal(engine.play("bid"), false);
  assert.equal(await engine.unlock(), false); // Server environments do not construct audio.
  engine.dispose();
});

test("all four stereo cues have bounded peaks, audible content and click-free boundaries", () => {
  for (const rate of [44100, 48000]) {
    for (const cue of ["bid", "sold", "lock", "navigate"] as const) {
      const rendered = renderAuctionSound(cue, rate);
      assert.equal(rendered.channels.length, 2);
      assert.ok(rendered.channels[0].length / rate < 2);
      for (const channel of rendered.channels) {
        assert.equal(channel[0], 0);
        assert.ok(Math.abs(channel[channel.length - 1]) === 0);
        let energy = 0;
        for (const sample of channel) {
          assert.ok(Number.isFinite(sample));
          assert.ok(Math.abs(sample) < 0.9, "Every cue reserves mastering headroom.");
          energy += sample * sample;
        }
        assert.ok(energy / channel.length > 0.000001, "A cue must contain audible material.");
      }
    }
  }
});

test("sales have a stereo applause tail while routine interactions stay brief and quiet", () => {
  const energy = (channel: Float32Array, from = 0) => channel.slice(from).reduce((sum, value) => sum + value * value, 0);
  const sale = renderAuctionSound("sold");
  const bid = renderAuctionSound("bid");
  const navigation = renderAuctionSound("navigate");
  assert.ok(energy(sale.channels[0], 48000 * 0.3) / energy(sale.channels[0]) > 0.05);
  assert.notDeepEqual(sale.channels[0], sale.channels[1]);
  assert.notDeepEqual(navigation.channels[0], navigation.channels[1]);
  assert.ok(energy(navigation.channels[0]) < energy(bid.channels[0]));
  assert.ok(energy(bid.channels[0], 48000 * 0.2) / energy(bid.channels[0]) < 0.001);
});

test("rendered foley is deterministic and rejects invalid sample rates", () => {
  assert.deepEqual(renderAuctionSound("bid"), renderAuctionSound("bid"));
  for (const rate of [0, -1, NaN, Infinity, 500000]) assert.throws(() => renderAuctionSound("sold", rate), RangeError);
});

test("playback caps overlapping voices, respects mute and zero volume, and releases sources", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const sources: { onended: (() => void) | null; disconnected: boolean; stopped: boolean }[] = [];
  const parameter = () => ({ value: 0, setTargetAtTime() {} });
  const contexts: FakeContext[] = [];
  let renderedBuffers = 0;
  class FakeContext {
    state = "suspended";
    currentTime = 1;
    sampleRate = 48000;
    destination = {};
    constructor() { contexts.push(this); }
    createGain() { return { gain: parameter(), connect() {} }; }
    createDynamicsCompressor() { return { threshold: parameter(), knee: parameter(), ratio: parameter(), attack: parameter(), release: parameter(), connect() {} }; }
    createBuffer(channels: number, length: number) {
      renderedBuffers++;
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { getChannelData: (index: number) => data[index] };
    }
    createBufferSource() {
      const source = { buffer: null, onended: null as (() => void) | null, disconnected: false, stopped: false, connect() {}, start() {}, disconnect() { this.disconnected = true; }, stop() { this.stopped = true; this.onended?.(); } };
      sources.push(source);
      return source;
    }
    async resume() { this.state = "running"; }
    async close() { this.state = "closed"; }
  }
  Object.defineProperty(globalThis, "window", { value: { AudioContext: FakeContext }, configurable: true });
  const engine = new AuctionAudioEngine();
  try {
    assert.equal(await engine.unlock(), false, "Disabled sound must not create a context.");
    engine.setPreferences({ enabled: true, volume: 0.4 });
    assert.equal(await engine.unlock(), true);
    assert.equal(renderedBuffers, 0, "Unlocking sound does not synthesize unused effects.");
    const context = contexts[0];
    for (let index = 0; index < 6; index++) { context!.currentTime += 0.2; assert.equal(engine.play("sold"), true); }
    assert.equal(renderedBuffers, 1, "Repeated effects reuse one cached sample.");
    context!.currentTime += 0.2;
    assert.equal(engine.play("sold"), false);
    sources[0].onended?.();
    assert.equal(sources[0].disconnected, true);
    assert.equal(engine.play("bid"), true);
    assert.equal(renderedBuffers, 2, "The second cue is rendered only when first played.");
    engine.setPreferences({ enabled: false, volume: 0.4 });
    assert.equal(engine.play("navigate"), false);
    engine.setPreferences({ enabled: true, volume: 0 });
    assert.equal(engine.play("navigate"), false);
    engine.dispose();
    assert.equal(context!.state, "closed");
    assert.ok(sources.slice(1).every(source => source.stopped && source.disconnected));
  } finally {
    engine.dispose();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
