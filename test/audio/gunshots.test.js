import { describe, expect, it, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import {
  audioContextAction,
  nextVariantIndex,
  resolveSoundSet,
  pickVariantForSet,
  WEAPON_SOUND_SETS,
  EXPLOSION_SOUND,
  BUFFER_LOAD_TIMEOUT_MS,
  createGunshotAudio,
} from '../../src/audio/gunshots.js';
import { InitTimeoutError } from '../../src/shell/initTimeout.js';

// The real audio context needs a browser, but THREE.AudioContext.setContext
// lets a Web-Audio-API-shaped plain object stand in for it -- enough surface
// for AudioListener/Audio/PositionalAudio to run their real code paths (gain
// nodes, panners, buffer sources) without ever touching `window`. That's
// what the "createGunshotAudio: playExplosion" block below uses to exercise
// the explosion voice for real; everything above it is pure logic that
// needs none of this and is tested directly.

function fakeGainNode() {
  const node = { connect: () => {}, disconnect: () => {} };
  // A real GainNode's value only reflects a setTargetAtTime ramp once it
  // settles on the audio thread; the fake applies it synchronously since
  // these tests only care about the target volume, not ramp timing.
  node.gain = {
    value: 1,
    setTargetAtTime: (value) => {
      node.gain.value = value;
    },
  };
  return node;
}
function fakePannerNode() {
  return {
    connect: () => {},
    disconnect: () => {},
    panningModel: '',
    refDistance: 1,
    rolloffFactor: 1,
    distanceModel: 'inverse',
    maxDistance: 10000,
    setPosition: () => {},
    setOrientation: () => {},
  };
}
function fakeBufferSourceNode() {
  return {
    buffer: null,
    loop: false,
    loopStart: 0,
    loopEnd: 0,
    onended: null,
    connect: () => {},
    disconnect: () => {},
    start: () => {},
    stop: () => {},
    playbackRate: { setTargetAtTime: () => {} },
  };
}
THREE.AudioContext.setContext({
  currentTime: 0,
  destination: {},
  state: 'running',
  resume: () => Promise.resolve(),
  suspend: () => Promise.resolve(),
  createGain: fakeGainNode,
  createPanner: fakePannerNode,
  createBufferSource: fakeBufferSourceNode,
});
// Stands in for the network+decode step AudioLoader normally does -- each
// fake buffer carries the url it "loaded" from, so a test can tell which of
// the already-loaded samples a voice ended up playing without needing a real
// decoded AudioBuffer.
THREE.AudioLoader.prototype.load = (url, onLoad) => onLoad({ url });

// The machine gun's own pool and the explosion's own pool are two disjoint
// URL lists by default -- every test using this helper can tell which pool a
// played buffer came from by its URL, the same way the real per-set buffer
// pools in gunshots.js do. Callers that want to exercise the "a set's own
// pool hasn't loaded" fallback path pass e.g. `{ machinegunUrls: [] }` to
// blank out just that set.
async function createLoadedGunshotAudio({
  machinegunUrls = ['mg-a.ogg', 'mg-b.ogg', 'mg-c.ogg'],
  explosionUrls = ['boom-000.ogg'],
} = {}) {
  const camera = new THREE.PerspectiveCamera();
  const scene = new THREE.Scene();
  const gunshots = createGunshotAudio({
    camera,
    scene,
    soundSetUrls: { machinegun: machinegunUrls, explosion: explosionUrls },
  });
  // Flushes the Promise.all(...).then(...) chain createGunshotAudio kicks off
  // to load buffers and build its voices -- two microtask turns covers it,
  // but a macrotask tick is the robust way to guarantee that regardless of
  // how many promises are chained internally.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { gunshots, scene };
}

function positionalAudioChildren(scene) {
  return scene.children.filter((child) => child instanceof THREE.PositionalAudio);
}

// The audio context and THREE's Audio nodes need a real browser, so what is
// tested here is the logic that fails *silently* in one: a stuck context
// (no sound at all) and a variant picker that repeats (fire that sounds like
// a buzzer). Both look identical to "audio was never wired up".

describe('nextVariantIndex', () => {
  it('never repeats the sample just played', () => {
    for (let previous = 0; previous < 3; previous++) {
      for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
        expect(nextVariantIndex(previous, 3, roll)).not.toBe(previous);
      }
    }
  });

  it('can reach every variant across the range of rolls', () => {
    const reachable = new Set();
    for (let previous = 0; previous < 3; previous++) {
      for (const roll of [0, 0.5, 0.999]) reachable.add(nextVariantIndex(previous, 3, roll));
    }
    expect(reachable).toEqual(new Set([0, 1, 2]));
  });

  it('can pick any variant on the first shot, when nothing has played yet', () => {
    expect(nextVariantIndex(-1, 3, 0)).toBe(0);
    expect(nextVariantIndex(-1, 3, 0.5)).toBe(1);
    expect(nextVariantIndex(-1, 3, 0.999)).toBe(2);
  });

  it('stays in range at the top of the roll', () => {
    for (const count of [1, 2, 3, 5]) {
      for (let previous = -1; previous < count; previous++) {
        const index = nextVariantIndex(previous, count, 1);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(count);
      }
    }
  });

  it('has nowhere to go with a single sample', () => {
    expect(nextVariantIndex(0, 1, 0.9)).toBe(0);
  });
});

describe('resolveSoundSet (KTD8: named per-weapon sound sets)', () => {
  it('selects the machine-gun set by weapon id', () => {
    expect(resolveSoundSet('machinegun')).toBe('machinegun');
  });

  it('falls back to the default set for an unknown id or no id at all', () => {
    expect(resolveSoundSet('unknown-weapon')).toBe('machinegun');
    expect(resolveSoundSet(undefined)).toBe('machinegun');
  });

  it('plays the machine gun at its own sample\'s natural rate', () => {
    expect(WEAPON_SOUND_SETS.machinegun.playbackRate).toBe(1);
  });
});

describe('pickVariantForSet', () => {
  it('tracks an independent cursor per set id, never repeating within the same set even when calls interleave', () => {
    const cursors = new Map();
    let lastMg = null;
    let lastExplosion = null;
    for (let i = 0; i < 20; i++) {
      const mgIndex = pickVariantForSet(cursors, 'machinegun', 3, Math.random());
      if (lastMg !== null) expect(mgIndex).not.toBe(lastMg);
      lastMg = mgIndex;

      const explosionIndex = pickVariantForSet(cursors, 'explosion', 3, Math.random());
      if (lastExplosion !== null) expect(explosionIndex).not.toBe(lastExplosion);
      lastExplosion = explosionIndex;
    }
  });
});

describe('audioContextAction', () => {
  it('resumes a suspended context when the game is running', () => {
    expect(audioContextAction('suspended', true)).toBe('resume');
  });

  it('suspends a running context when the game is not', () => {
    expect(audioContextAction('running', false)).toBe('suspend');
  });

  it('does nothing when the context already matches the run state', () => {
    expect(audioContextAction('running', true)).toBeNull();
    expect(audioContextAction('suspended', false)).toBeNull();
  });
});

describe('EXPLOSION_SOUND (real sample, natural playback rate)', () => {
  it('plays at its own sample\'s natural rate -- the 0.45x pitched-placeholder trick is gone', () => {
    expect(EXPLOSION_SOUND.playbackRate).toBe(1);
  });
});

describe('createGunshotAudio: setRunning stops retrying a failing resume() (#11)', () => {
  it('does not re-issue resume() on every frame once it has already failed, and reports the failure', async () => {
    const resume = vi.fn(() => Promise.reject(new Error('resume rejected')));
    const onError = vi.fn();
    const previousContext = THREE.AudioContext.getContext();
    THREE.AudioContext.setContext({
      currentTime: 0,
      destination: {},
      state: 'suspended',
      resume,
      suspend: () => Promise.resolve(),
      createGain: fakeGainNode,
      createPanner: fakePannerNode,
      createBufferSource: fakeBufferSourceNode,
    });

    try {
      const camera = new THREE.PerspectiveCamera();
      const scene = new THREE.Scene();
      const gunshots = createGunshotAudio({ camera, scene, soundSetUrls: { machinegun: ['a.ogg'] }, onError });

      gunshots.unlock();
      await Promise.resolve(); // let unlock's own resume() rejection settle

      // Five simulated animation frames, each calling setRunning(true) the
      // way main.js's onFrame does every frame while unlocked.
      for (let i = 0; i < 5; i++) {
        gunshots.setRunning(true);
        await Promise.resolve(); // let this frame's rejection (if any) settle before the next
      }

      // At most two real attempts: unlock's own call, plus setRunning's
      // first attempt before it learns resume is failing. The old code
      // issued one resume() call per setRunning(true) call (5 more, forever)
      // with every rejection silently discarded.
      expect(resume.mock.calls.length).toBeLessThanOrEqual(2);
      expect(onError).toHaveBeenCalled();
    } finally {
      THREE.AudioContext.setContext(previousContext);
    }
  });
});

describe('createGunshotAudio: unlock() reports its own resume() failure (U23)', () => {
  it('calls onError when the unlock gesture\'s own resume() rejects, with no setRunning() call involved', async () => {
    const resume = vi.fn(() => Promise.reject(new Error('resume rejected')));
    const onError = vi.fn();
    const previousContext = THREE.AudioContext.getContext();
    THREE.AudioContext.setContext({
      currentTime: 0,
      destination: {},
      state: 'suspended',
      resume,
      suspend: () => Promise.resolve(),
      createGain: fakeGainNode,
      createPanner: fakePannerNode,
      createBufferSource: fakeBufferSourceNode,
    });

    try {
      const camera = new THREE.PerspectiveCamera();
      const scene = new THREE.Scene();
      const gunshots = createGunshotAudio({ camera, scene, soundSetUrls: { machinegun: ['a.ogg'] }, onError });

      gunshots.unlock();
      await Promise.resolve(); // let unlock's own resume() rejection settle

      expect(resume).toHaveBeenCalledTimes(1); // unlock's own attempt, no setRunning() call yet
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    } finally {
      THREE.AudioContext.setContext(previousContext);
    }
  });
});

describe('createGunshotAudio: a stalled buffer load times out instead of hanging the whole session (U28)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops the stalled URL, reports a distinguishable timeout error, and still loads the rest', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const originalLoad = THREE.AudioLoader.prototype.load;
    // 'stuck.ogg' never calls back at all -- neither onLoad nor onError --
    // the exact shape of a stalled connection or a silently-dropped proxy
    // response that the explicit-failure path below can't see.
    THREE.AudioLoader.prototype.load = (url, onLoad) => {
      if (url === 'stuck.ogg') return; // never settles
      onLoad({ url });
    };

    try {
      const camera = new THREE.PerspectiveCamera();
      const scene = new THREE.Scene();
      createGunshotAudio({
        camera,
        scene,
        soundSetUrls: { machinegun: ['a.ogg', 'stuck.ogg', 'b.ogg'] },
        onError,
      });

      // Advance past the per-URL timeout. Against the unfixed code nothing
      // schedules a timer for the stalled URL at all, so this settles
      // immediately without the whole-session Promise.all ever resolving --
      // the assertions below then fail fast on the resulting empty state
      // instead of the test hanging on a promise that never settles.
      await vi.advanceTimersByTimeAsync(BUFFER_LOAD_TIMEOUT_MS * 2);

      expect(onError).toHaveBeenCalledWith(expect.any(InitTimeoutError));
      // The two good URLs still load and voices get built -- one stalled
      // sample no longer sinks the entire session's audio.
      expect(positionalAudioChildren(scene).length).toBeGreaterThan(0);
    } finally {
      THREE.AudioLoader.prototype.load = originalLoad;
    }
  }, 5000);
});

describe('createGunshotAudio: sound sets settle and build voices independently, not gated on each other', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // A code-review regression: voice construction used to run inside one
  // Promise.all over every set, gated on DEFAULT_SOUND_SET_ID's own pool
  // specifically -- so a failed load in one set silenced a sibling set that
  // loaded fine right alongside it.
  it('still builds voices and plays a healthy machine-gun set when the explosion set comes up empty', async () => {
    const camera = new THREE.PerspectiveCamera();
    const scene = new THREE.Scene();
    const gunshots = createGunshotAudio({
      camera,
      scene,
      soundSetUrls: { machinegun: ['mg-a.ogg'], explosion: [] },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    gunshots.playAt({ x: 0, y: 0, z: 0 }, 'machinegun');

    const [voice] = positionalAudioChildren(scene).filter((v) => v.isPlaying);
    expect(voice).toBeDefined();
    expect(voice.buffer.url).toBe('mg-a.ogg');
  });

  // The other half of the same regression: one Promise.all spanning every
  // set meant a slow/stalled URL in a non-default set held up voice
  // construction -- and therefore playback -- for a set that had already
  // loaded fine.
  it('does not wait on a stalled sibling set before playing an already-loaded set', async () => {
    vi.useFakeTimers();
    const originalLoad = THREE.AudioLoader.prototype.load;
    THREE.AudioLoader.prototype.load = (url, onLoad) => {
      if (url === 'boom-stuck.ogg') return; // never settles within this test
      onLoad({ url });
    };

    try {
      const camera = new THREE.PerspectiveCamera();
      const scene = new THREE.Scene();
      const gunshots = createGunshotAudio({
        camera,
        scene,
        soundSetUrls: { machinegun: ['mg-a.ogg'], explosion: ['boom-stuck.ogg'] },
      });
      // Flushes only the already-resolved machine-gun load's microtask
      // chain -- well short of BUFFER_LOAD_TIMEOUT_MS, so the explosion set
      // is still pending when this assertion runs.
      await vi.advanceTimersByTimeAsync(0);

      gunshots.playAt({ x: 0, y: 0, z: 0 }, 'machinegun');
      const [voice] = positionalAudioChildren(scene).filter((v) => v.isPlaying);
      expect(voice).toBeDefined();
      expect(voice.buffer.url).toBe('mg-a.ogg');
    } finally {
      THREE.AudioLoader.prototype.load = originalLoad;
    }
  });
});

describe('createGunshotAudio: playExplosion', () => {
  it('does nothing before buffers have loaded (no explosion voice exists yet)', () => {
    const camera = new THREE.PerspectiveCamera();
    const scene = new THREE.Scene();
    const gunshots = createGunshotAudio({ camera, scene, soundSetUrls: { machinegun: ['a.ogg'] } });

    expect(() => gunshots.playExplosion({ x: 0, y: 0, z: 0 })).not.toThrow();
    expect(positionalAudioChildren(scene)).toHaveLength(0);
  });

  it('plays a positional voice at the blast center, picked from the explosion\'s own real buffer pool -- not the gunshot pool', async () => {
    const { gunshots, scene } = await createLoadedGunshotAudio();

    gunshots.playExplosion({ x: 5, y: 1, z: -2 });

    const playing = positionalAudioChildren(scene).filter((voice) => voice.isPlaying);
    expect(playing).toHaveLength(1);
    const [voice] = playing;
    expect(voice.position).toEqual(new THREE.Vector3(5, 1, -2));
    // Its own pool (`explosionUrls` in the helper above), disjoint from the
    // gunshot pool -- a real, separate sample, not the gunshot buffers
    // pitched down, so a buffer picked from the gunshot list here would
    // itself be a regression.
    expect(voice.buffer.url).toBe('boom-000.ogg');
    expect(voice.getPlaybackRate()).toBe(EXPLOSION_SOUND.playbackRate);
  });

  it('is louder and farther-reaching than a regular gunshot voice (R11)', async () => {
    const { gunshots, scene } = await createLoadedGunshotAudio();

    gunshots.playAt({ x: 0, y: 0, z: 0 }, 'machinegun');
    // Untouched pooled voices still have buffer === null (never played) --
    // guard with ?. rather than assuming every voice has one by this point.
    const [gunshotVoice] = positionalAudioChildren(scene).filter((voice) =>
      ['mg-a.ogg', 'mg-b.ogg', 'mg-c.ogg'].includes(voice.buffer?.url)
    );

    gunshots.playExplosion({ x: 0, y: 0, z: 0 });
    const [explosionVoice] = positionalAudioChildren(scene).filter((voice) => voice.buffer?.url === 'boom-000.ogg');

    expect(explosionVoice.getVolume()).toBeGreaterThan(gunshotVoice.getVolume());
    expect(explosionVoice.getRefDistance()).toBeGreaterThan(gunshotVoice.getRefDistance());
    expect(explosionVoice.getMaxDistance()).toBeGreaterThan(gunshotVoice.getMaxDistance());
  });

  it('KTD8: is a single dedicated voice, never cycled from the pooled gunshot voices', async () => {
    const { gunshots, scene } = await createLoadedGunshotAudio();

    // Both the pooled gunshot voices and the dedicated explosion voice are
    // built once at load time (mirroring how positionalVoices itself is
    // pre-built, not allocated lazily) -- so "unpooled" isn't about when the
    // voice is created, it's about whether playAt's round-robin ever reaches
    // it. Firing exactly one shot per pooled voice, with none left over to
    // wrap the cursor back around, plays every pooled voice once and no more.
    const allVoices = positionalAudioChildren(scene);
    const poolSize = allVoices.length - 1; // the pool, plus the one dedicated explosion voice
    for (let i = 0; i < poolSize; i++) gunshots.playAt({ x: i, y: 0, z: 0 }, 'machinegun');

    const untouchedByGunfire = allVoices.filter((voice) => !voice.isPlaying);
    expect(untouchedByGunfire).toHaveLength(1); // exactly the explosion voice -- playAt's cursor never reached it

    const [explosionVoice] = untouchedByGunfire;
    gunshots.playExplosion({ x: 999, y: 999, z: 999 });
    expect(explosionVoice.isPlaying).toBe(true);
    expect(explosionVoice.position).toEqual(new THREE.Vector3(999, 999, 999));

    // Every pooled voice still sits exactly where its own gunshot left it --
    // none of them was silently repurposed as the explosion's voice.
    for (let i = 0; i < poolSize; i++) {
      const pooledVoice = allVoices.find((voice) => voice !== explosionVoice && voice.position.x === i);
      expect(pooledVoice).toBeDefined();
    }
  });
});

describe('createGunshotAudio: per-weapon-set buffer pools (R3/R4)', () => {
  it('falls back to the default (machine-gun) pool for the explosion when its own sample has not loaded', async () => {
    // No entry for 'explosion' in soundSetUrls at all -- the shape a caller
    // gets before main.js is wired to pass real explosion sample URLs, or if
    // that load fails/times out. playExplosion must still produce sound
    // (R18: a load failure leaves the game silent but playable) rather than
    // picking from an empty pool.
    const { gunshots, scene } = await createLoadedGunshotAudio({ explosionUrls: [] });

    gunshots.playExplosion({ x: 0, y: 0, z: 0 });

    const [voice] = positionalAudioChildren(scene).filter((v) => v.isPlaying);
    expect(['mg-a.ogg', 'mg-b.ogg', 'mg-c.ogg']).toContain(voice.buffer.url);
  });

  // Regression: DEFAULT_SOUND_SET_ID now resolves to the machine gun itself
  // (today's only weapon), so a failed MG load has no sibling weapon pool
  // left to fall back to the way a failed pistol load once did. This must
  // degrade to R18's baseline -- silent, never a crash -- not throw when
  // the player or a bot fires while the MG's own samples never arrived.
  it("degrades to silence without throwing when the machine gun's own samples fail to load, even with a healthy sibling set", async () => {
    const originalLoad = THREE.AudioLoader.prototype.load;
    THREE.AudioLoader.prototype.load = (url, onLoad, onProgress, onLoadError) => {
      if (url.startsWith('mg-')) return onLoadError(new Error('mg sample failed'));
      onLoad({ url });
    };

    try {
      const { gunshots, scene } = await createLoadedGunshotAudio();

      expect(() => gunshots.playAt({ x: 0, y: 0, z: 0 }, 'machinegun')).not.toThrow();
      expect(() => gunshots.playLocal('machinegun')).not.toThrow();
      // No MG sample ever loaded, so nothing plays a real MG buffer.
      expect(positionalAudioChildren(scene).every((v) => v.buffer?.url !== 'mg-a.ogg')).toBe(true);
      // The explosion set -- a real sibling pool, unaffected by the MG's
      // own failure -- still works.
      gunshots.playExplosion({ x: 1, y: 1, z: 1 });
      expect(positionalAudioChildren(scene).some((v) => v.isPlaying && v.buffer?.url === 'boom-000.ogg')).toBe(true);
    } finally {
      THREE.AudioLoader.prototype.load = originalLoad;
    }
  });
});
