import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createAnimatedCharacter } from '../../src/render/mixer.js';

function makeClip(name, duration = 1) {
  return new THREE.AnimationClip(name, duration, []);
}

function buildClips() {
  return [
    makeClip('Rig|Idle_Loop'),
    makeClip('Rig|Jog_Fwd_Loop'),
    makeClip('Rig|Death01', 0.6),
    makeClip('Rig|Pistol_Shoot', 0.2),
  ];
}

// The mapping is the caller's to supply, so these names are just this test's
// fixture rig -- not a rig the game still ships.
const CLIPS = {
  idle: 'Rig|Idle_Loop',
  moving: 'Rig|Jog_Fwd_Loop',
  dead: 'Rig|Death01',
  fire: 'Rig|Pistol_Shoot',
};

describe('createAnimatedCharacter: base-hint clip selection', () => {
  it('plays the clip matching each base hint', () => {
    const character = createAnimatedCharacter(new THREE.Group(), buildClips(), CLIPS);

    character.setBaseHint('idle');
    expect(character.getActiveClipName()).toBe('Rig|Idle_Loop');

    character.setBaseHint('moving');
    expect(character.getActiveClipName()).toBe('Rig|Jog_Fwd_Loop');

    character.setBaseHint('dead');
    expect(character.getActiveClipName()).toBe('Rig|Death01');
  });
});

describe('createAnimatedCharacter: death-clip detection uses the mapped name, not a substring', () => {
  it('clamps a mapped dead clip whose name does not contain "Death"', () => {
    const clips = [
      makeClip('Rig|Idle_Loop'),
      makeClip('Rig|Jog_Fwd_Loop'),
      makeClip('Rig|Perish', 0.6),
      makeClip('Rig|Pistol_Shoot', 0.2),
    ];
    const clipNames = {
      idle: 'Rig|Idle_Loop',
      moving: 'Rig|Jog_Fwd_Loop',
      dead: 'Rig|Perish',
      fire: 'Rig|Pistol_Shoot',
    };
    const character = createAnimatedCharacter(new THREE.Group(), clips, clipNames);

    character.setBaseHint('dead');

    expect(character.getActiveClipName()).toBe('Rig|Perish');
    expect(character.getActiveActionLoopMode()).toEqual({
      loop: THREE.LoopOnce,
      clampWhenFinished: true,
    });
  });

  it('does not clamp an unrelated clip that merely happens to contain "Death"', () => {
    // 'Rig|DeathMatch_Taunt' contains the substring "Death" but is mapped to
    // the 'moving' hint here, not 'dead' -- it must not get the one-shot/
    // clamp treatment just because of its name.
    const clips = [
      makeClip('Rig|Idle_Loop'),
      makeClip('Rig|DeathMatch_Taunt', 0.4),
      makeClip('Rig|Perish', 0.6),
      makeClip('Rig|Pistol_Shoot', 0.2),
    ];
    const clipNames = {
      idle: 'Rig|Idle_Loop',
      moving: 'Rig|DeathMatch_Taunt',
      dead: 'Rig|Perish',
      fire: 'Rig|Pistol_Shoot',
    };
    const character = createAnimatedCharacter(new THREE.Group(), clips, clipNames);

    character.setBaseHint('moving');

    expect(character.getActiveClipName()).toBe('Rig|DeathMatch_Taunt');
    expect(character.getActiveActionLoopMode()).toEqual({
      loop: THREE.LoopRepeat,
      clampWhenFinished: false,
    });
  });
});

describe('createAnimatedCharacter: fire reaction', () => {
  it('plays the fire clip immediately and reverts to the base hint after it elapses', () => {
    const character = createAnimatedCharacter(new THREE.Group(), buildClips(), CLIPS);
    character.setBaseHint('moving');

    character.playFireReaction();
    expect(character.getActiveClipName()).toBe('Rig|Pistol_Shoot');

    for (let i = 0; i < 20; i++) character.update(1 / 60); // ~0.33s, past the 0.3s reaction window

    expect(character.getActiveClipName()).toBe('Rig|Jog_Fwd_Loop');
  });

  it('does not let a base-hint change interrupt an in-progress fire reaction', () => {
    const character = createAnimatedCharacter(new THREE.Group(), buildClips(), CLIPS);
    character.setBaseHint('idle');
    character.playFireReaction();

    character.setBaseHint('moving'); // should be deferred, not applied immediately
    expect(character.getActiveClipName()).toBe('Rig|Pistol_Shoot');

    for (let i = 0; i < 20; i++) character.update(1 / 60);
    expect(character.getActiveClipName()).toBe('Rig|Jog_Fwd_Loop'); // the deferred hint applies once the reaction ends
  });
});
