import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createImpactSystem,
  shooterIdsThatHit,
  MAX_ACTIVE_IMPACTS,
} from '../../src/render/impacts.js';

describe('shooterIdsThatHit', () => {
  it('reports the shooter of a shot that landed', () => {
    const events = [
      { type: 'fire', shooterId: 'player', origin: {}, endPoint: {} },
      { type: 'hit', shooterId: 'player', targetId: 'bot0' },
    ];

    expect(shooterIdsThatHit(events)).toEqual(new Set(['player']));
  });

  it('reports nothing for a shot that missed', () => {
    const events = [{ type: 'fire', shooterId: 'player', origin: {}, endPoint: {} }];

    expect(shooterIdsThatHit(events)).toEqual(new Set());
  });

  it('separates shooters when several fire in the same tick and only some connect', () => {
    const events = [
      { type: 'fire', shooterId: 'player' },
      { type: 'fire', shooterId: 'bot0' },
      { type: 'hit', shooterId: 'bot0', targetId: 'player' },
      { type: 'fire', shooterId: 'bot1' },
      { type: 'hit', shooterId: 'bot1', targetId: 'player' },
    ];

    expect(shooterIdsThatHit(events)).toEqual(new Set(['bot0', 'bot1']));
  });
});

describe('createImpactSystem', () => {
  it('adds a spark at the impact point', () => {
    const scene = new THREE.Scene();
    const impacts = createImpactSystem(scene);

    impacts.spawn({ x: 1, y: 2, z: 3 });

    expect(scene.children.length).toBe(1);
    expect(scene.children[0].position).toEqual(new THREE.Vector3(1, 2, 3));
  });

  it('distinguishes a hit on a body from a hit on a surface', () => {
    const scene = new THREE.Scene();
    const impacts = createImpactSystem(scene);

    impacts.spawn({ x: 0, y: 0, z: 0 }, 'surface');
    impacts.spawn({ x: 0, y: 0, z: 0 }, 'body');

    const [surface, body] = scene.children;
    expect(surface.material.color.getHex()).not.toBe(body.material.color.getHex());
  });

  it('expands and fades the spark, then removes it', () => {
    const scene = new THREE.Scene();
    const impacts = createImpactSystem(scene);

    impacts.spawn({ x: 0, y: 0, z: 0 });
    const spark = scene.children[0];
    const initialScale = spark.scale.x;

    impacts.update(0.09); // about halfway through
    expect(spark.scale.x).toBeGreaterThan(initialScale);
    expect(spark.material.opacity).toBeLessThan(1);
    expect(scene.children.length).toBe(1);

    impacts.update(0.2);
    expect(scene.children.length).toBe(0);
  });

  // Several bots firing ~30 shots/second each would grow an unbounded pool
  // for the length of a match, which is exactly what the memory-plateau bar
  // rules out. Read against the live cap, not a copy of it: a stale copy here
  // is what would let a future retune pass while the pool actually regressed.
  it('caps how many sparks can be alive at once', () => {
    const scene = new THREE.Scene();
    const impacts = createImpactSystem(scene);

    for (let i = 0; i < 200; i++) impacts.spawn({ x: i, y: 0, z: 0 });

    expect(scene.children.length).toBeLessThanOrEqual(MAX_ACTIVE_IMPACTS);
  });

  it('keeps the newest spark when the cap forces a recycle', () => {
    const scene = new THREE.Scene();
    const impacts = createImpactSystem(scene);

    for (let i = 0; i < 30; i++) impacts.spawn({ x: i, y: 0, z: 0 });

    const newest = scene.children[scene.children.length - 1];
    expect(newest.position.x).toBe(29);
  });
});
