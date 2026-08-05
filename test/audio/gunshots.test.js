import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  audioContextAction,
  nextVariantIndex,
  resolveSoundSet,
  pickVariantForSet,
  WEAPON_SOUND_SETS,
  EXPLOSION_SOUND,
  createGunshotAudio,
} from '../../src/audio/gunshots.js';

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

async function createLoadedGunshotAudio() {
  const camera = new THREE.PerspectiveCamera();
  const scene = new THREE.Scene();
  const gunshots = createGunshotAudio({ camera, scene, urls: ['a.ogg', 'b.ogg', 'c.ogg'] });
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

  it('falls back to the pistol set for the pistol id, an unknown id, or no id at all', () => {
    expect(resolveSoundSet('pistol')).toBe('pistol');
    expect(resolveSoundSet('unknown-weapon')).toBe('pistol');
    expect(resolveSoundSet(undefined)).toBe('pistol');
  });

  it('gives the machine-gun set a distinct playback rate from the pistol (placeholder pitch until an asset lands)', () => {
    expect(WEAPON_SOUND_SETS.machinegun.playbackRate).not.toBe(WEAPON_SOUND_SETS.pistol.playbackRate);
  });
});

describe('pickVariantForSet', () => {
  it('tracks an independent cursor per set id, never repeating within the same set even when calls interleave', () => {
    const cursors = new Map();
    let lastPistol = null;
    let lastMg = null;
    for (let i = 0; i < 20; i++) {
      const pistolIndex = pickVariantForSet(cursors, 'pistol', 3, Math.random());
      if (lastPistol !== null) expect(pistolIndex).not.toBe(lastPistol);
      lastPistol = pistolIndex;

      const mgIndex = pickVariantForSet(cursors, 'machinegun', 3, Math.random());
      if (lastMg !== null) expect(mgIndex).not.toBe(lastMg);
      lastMg = mgIndex;
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

describe('EXPLOSION_SOUND (KTD8: pitched-placeholder explosion set)', () => {
  it('pitches distinctly lower than every weapon set, so it reads as a boom, not a shot', () => {
    expect(EXPLOSION_SOUND.playbackRate).toBeLessThan(WEAPON_SOUND_SETS.pistol.playbackRate);
    expect(EXPLOSION_SOUND.playbackRate).toBeLessThan(WEAPON_SOUND_SETS.machinegun.playbackRate);
  });
});

describe('createGunshotAudio: playExplosion', () => {
  it('does nothing before buffers have loaded (no explosion voice exists yet)', () => {
    const camera = new THREE.PerspectiveCamera();
    const scene = new THREE.Scene();
    const gunshots = createGunshotAudio({ camera, scene, urls: ['a.ogg'] });

    expect(() => gunshots.playExplosion({ x: 0, y: 0, z: 0 })).not.toThrow();
    expect(positionalAudioChildren(scene)).toHaveLength(0);
  });

  it('plays a positional voice at the blast center, picked from the already-loaded gunshot buffers', async () => {
    const { gunshots, scene } = await createLoadedGunshotAudio();

    gunshots.playExplosion({ x: 5, y: 1, z: -2 });

    const playing = positionalAudioChildren(scene).filter((voice) => voice.isPlaying);
    expect(playing).toHaveLength(1);
    const [voice] = playing;
    expect(voice.position).toEqual(new THREE.Vector3(5, 1, -2));
    expect(['a.ogg', 'b.ogg', 'c.ogg']).toContain(voice.buffer.url);
    expect(voice.getPlaybackRate()).toBe(EXPLOSION_SOUND.playbackRate);
  });

  it('is louder and farther-reaching than a regular gunshot voice (R11)', async () => {
    const { gunshots, scene } = await createLoadedGunshotAudio();

    gunshots.playAt({ x: 0, y: 0, z: 0 }, 'pistol');
    const [gunshotVoice] = positionalAudioChildren(scene).filter(
      (voice) => voice.isPlaying && voice.getPlaybackRate() === WEAPON_SOUND_SETS.pistol.playbackRate
    );

    gunshots.playExplosion({ x: 0, y: 0, z: 0 });
    const [explosionVoice] = positionalAudioChildren(scene).filter(
      (voice) => voice.getPlaybackRate() === EXPLOSION_SOUND.playbackRate
    );

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
    for (let i = 0; i < poolSize; i++) gunshots.playAt({ x: i, y: 0, z: 0 }, 'pistol');

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
