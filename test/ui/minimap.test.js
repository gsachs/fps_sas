import { describe, expect, it } from 'vitest';
import {
  projectToMap,
  computeMapTransform,
  computeMarkerPosition,
  findRoomAt,
  roomTint,
} from '../../src/ui/minimap.js';

const FLOOR_HALF_SIZE = 34; // matches the real arena (layout.js's FLOOR_HALF_SIZE)

describe('minimap: projectToMap (R3, KTD2 -- built on the sim forward basis)', () => {
  // Mirrors movement.js's own convention (forward = sin(yaw), cos(yaw)) and
  // the strafe-direction learning's rule: assert the actual screen-space
  // outcome, not that the formula is "internally consistent" with itself.
  // docs/solutions/logic-errors/strafe-direction-camera-basis-mismatch.md
  function aheadWorldPoint(playerPosition, yaw, distance) {
    return {
      x: playerPosition.x + Math.sin(yaw) * distance,
      z: playerPosition.z + Math.cos(yaw) * distance,
    };
  }

  it.each([
    ['facing +Z (yaw 0)', 0],
    ['facing +X (yaw pi/2)', Math.PI / 2],
    ['facing -Z (yaw pi)', Math.PI],
    ['an arbitrary yaw', 1.234],
  ])('covers AE2: a point directly ahead of the player projects above the marker, %s', (_label, yaw) => {
    const player = { x: 5, z: -8 };
    const ahead = aheadWorldPoint(player, yaw, 10);

    const projected = projectToMap(ahead, player, yaw, FLOOR_HALF_SIZE);

    expect(projected.x).toBeCloseTo(0, 6); // directly above the marker, not to either side
    expect(projected.y).toBeLessThan(0); // negative y is "up" in SVG's y-down convention
  });

  it('is a pure function of its inputs -- no smoothing or memory across calls with very different yaws', () => {
    const player = { x: 0, z: 0 };
    const point = { x: 10, z: 0 };
    const first = projectToMap(point, player, 0, FLOOR_HALF_SIZE);
    const second = projectToMap(point, player, Math.PI, FLOOR_HALF_SIZE); // large per-frame delta
    const secondAgain = projectToMap(point, player, Math.PI, FLOOR_HALF_SIZE);
    expect(second).toEqual(secondAgain); // same inputs -> same output, unaffected by the earlier call
    expect(second).not.toEqual(first); // and it did actually respond to the new yaw, not stick to the old one
  });
});

describe('minimap: diagonal-fit invariant (R2, KTD1)', () => {
  // A circular frame only needs to cover the floor's half-diagonal, not its
  // half-width, because rotation preserves distance-from-center -- satisfying
  // this at any one orientation satisfies it at all of them. mapScale is
  // chosen so a floor corner sits at exactly radius 1 in map space. Routed
  // through projectToMap (player at the arena's own origin, so the delta it
  // computes equals the raw corner position) rather than reimplementing the
  // rotation inline -- an independent reimplementation here is exactly how a
  // sign bug in the real rotation could hide behind a magnitude-only check.
  const ORIGIN = { x: 0, z: 0 };
  const corners = [
    { x: FLOOR_HALF_SIZE, z: FLOOR_HALF_SIZE },
    { x: -FLOOR_HALF_SIZE, z: FLOOR_HALF_SIZE },
    { x: FLOOR_HALF_SIZE, z: -FLOOR_HALF_SIZE },
    { x: -FLOOR_HALF_SIZE, z: -FLOOR_HALF_SIZE },
  ];

  it.each([0, Math.PI / 2, Math.PI, 2.71])('keeps all four floor corners within the frame at yaw %f', (yaw) => {
    for (const corner of corners) {
      const projected = projectToMap(corner, ORIGIN, yaw, FLOOR_HALF_SIZE);
      const distanceFromCenter = Math.hypot(projected.x, projected.y);
      expect(distanceFromCenter).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe('minimap: computeMapTransform (KTD1 -- CSS transform, no per-vertex recompute)', () => {
  it('rotates by the negative of the player yaw', () => {
    expect(computeMapTransform(0)).toBe('rotate(0rad)');
    expect(computeMapTransform(Math.PI / 2)).toBe(`rotate(${-Math.PI / 2}rad)`);
  });
});

describe('minimap: computeMarkerPosition', () => {
  it('stays within the frame for a player anywhere on the floor (by construction, same transform as the layout)', () => {
    const position = computeMarkerPosition({ x: FLOOR_HALF_SIZE, z: FLOOR_HALF_SIZE }, 1.1, FLOOR_HALF_SIZE);
    expect(Math.hypot(position.x, position.y)).toBeLessThanOrEqual(1 + 1e-9);
  });

  // AE1 by construction: the function's signature admits only the player's
  // own transform and the static floor size -- there is no bot parameter for
  // a bot's presence or position to influence, so the output cannot differ
  // based on it.
  it('is a pure function of player position/yaw only -- identical inputs always give identical output', () => {
    const a = computeMarkerPosition({ x: 12, z: -4 }, 0.7, FLOOR_HALF_SIZE);
    const b = computeMarkerPosition({ x: 12, z: -4 }, 0.7, FLOOR_HALF_SIZE);
    expect(a).toEqual(b);
  });
});

describe('minimap: findRoomAt / roomTint (R4, AE4)', () => {
  const ROOMS = [
    { id: 'nw', x: -26, z: 26, halfX: 8, halfZ: 8 },
    { id: 'central', x: 0, z: 0, halfX: 10, halfZ: 10 },
  ];

  it('covers AE4: returns the room containing the player, whose tint matches the palette', () => {
    const room = findRoomAt({ x: -30, z: 22 }, ROOMS);
    expect(room?.id).toBe('nw');
    expect(roomTint(room)).toBe('#e69f00');
  });

  // sw's accent (0x009e73) is the one ROOM_ACCENTS value whose hex string is
  // shorter than 6 digits before padding ('9e73') -- every other accent
  // already happens to produce 6 digits unpadded, so this is the only case
  // that actually exercises padStart's zero-padding.
  it('pads a leading-zero-byte accent to a full 6-digit hex color', () => {
    expect(roomTint({ id: 'sw' })).toBe('#009e73');
  });

  it('returns null, and a neutral tint, for a position in a corridor (outside every room)', () => {
    const room = findRoomAt({ x: 0, z: 26 }, ROOMS); // top corridor midpoint -- not inside any listed room
    expect(room).toBeNull();
    expect(roomTint(room)).toBe('#a89f8a');
  });

  it('returns a neutral tint for the central room -- no accent (R5)', () => {
    const room = findRoomAt({ x: 0, z: 0 }, ROOMS);
    expect(room?.id).toBe('central');
    expect(roomTint(room)).toBe('#a89f8a');
  });
});
