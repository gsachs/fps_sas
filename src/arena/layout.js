// The single source of truth for the rooms-and-corridors map (KTD6): walls,
// rooms, doorways, landmark pillars, and spawn points all live here, in one
// dataset, so physics (arena.js) and render (arenaMesh.js) can never drift
// out of sync the way the old arena's twice-derived boundary walls did.
//
// Four corner rooms plus a central landmark room, joined by a corridor loop
// with a spoke into the centre from each side (R1). Corner rooms share one
// footprint so the outer perimeter closes without a mitred-corner case per
// room pair; rooms are told apart by interior landmark geometry instead
// (KD4) -- proportions stay identical, pillars differ.

const GRID_OFFSET = 26; // corner room centre distance from the origin, each axis
const CORNER_HALF = 8; // 16x16 corner rooms
const CENTRAL_HALF = 10; // 20x20 landmark room, deliberately the biggest space
const CORRIDOR_HALF_WIDTH = 1.5; // 3-unit corridors and doorways -- above KTD9's 2-unit floor
const WALL_THICKNESS = 0.5; // half-thickness, matches the retired arena's convention
export const WALL_HEIGHT = 4;
const PILLAR_HALF_HEIGHT = WALL_HEIGHT / 2; // full-height landmarks, not peek-over cover

// Split [from, to] around zero or more gaps, returning the surviving
// sub-intervals. A doorway is a gap in exactly one wall run; a plain wall is
// the zero-gap case, returned unsplit.
function splitAroundGaps(from, to, gaps) {
  const sorted = [...gaps].sort((a, b) => a[0] - b[0]);
  const segments = [];
  let cursor = from;
  for (const [gapStart, gapEnd] of sorted) {
    if (gapStart > cursor) segments.push([cursor, gapStart]);
    cursor = Math.max(cursor, gapEnd);
  }
  if (cursor < to) segments.push([cursor, to]);
  return segments;
}

// A wall run along the X axis: fixed z, spanning x in [from, to], split
// around any doorway gaps.
function wallAlongX(z, from, to, gaps = []) {
  return splitAroundGaps(from, to, gaps).map(([x0, x1]) => ({
    x: (x0 + x1) / 2,
    z,
    halfX: (x1 - x0) / 2,
    halfZ: WALL_THICKNESS,
  }));
}

// A wall run along the Z axis: fixed x, spanning z in [from, to].
function wallAlongZ(x, from, to, gaps = []) {
  return splitAroundGaps(from, to, gaps).map(([z0, z1]) => ({
    x,
    z: (z0 + z1) / 2,
    halfX: WALL_THICKNESS,
    halfZ: (z1 - z0) / 2,
  }));
}

const DOOR_HALF = CORRIDOR_HALF_WIDTH;

const CORNERS = [
  { id: 'nw', sx: -1, sz: 1 },
  { id: 'ne', sx: 1, sz: 1 },
  { id: 'se', sx: 1, sz: -1 },
  { id: 'sw', sx: -1, sz: -1 },
];

// Rooms whose landmark pillar sits exactly at the room's geometric centre
// (PILLARS, below) need a navigation point offset away from it -- a bot can
// never arrive at a point buried inside solid geometry. Reuses each room's
// own spawn-point offset (already proven clear of its pillar) rather than
// inventing a second number that could drift from it.
const NAV_POINT_OVERRIDES = {
  nw: { x: -5, z: 3 },
  central: { x: -6, z: 6 },
};

export const ROOMS = [
  ...CORNERS.map((c) => ({
    id: c.id,
    x: c.sx * GRID_OFFSET,
    z: c.sz * GRID_OFFSET,
    halfX: CORNER_HALF,
    halfZ: CORNER_HALF,
  })),
  { id: 'central', x: 0, z: 0, halfX: CENTRAL_HALF, halfZ: CENTRAL_HALF },
].map((r) => {
  const offset = NAV_POINT_OVERRIDES[r.id];
  return offset ? { ...r, navPoint: { x: r.x + offset.x, z: r.z + offset.z } } : r;
});

function room(id) {
  const found = ROOMS.find((r) => r.id === id);
  if (!found) throw new Error(`Unknown room id: ${id}`);
  return found;
}

// One entry per doorway threshold: its centre point, width, and the two
// spaces (room or corridor) it joins. U3's waypoint graph reads positions
// straight off this list.
export const DOORWAYS = [
  { id: 'nw-top', x: -GRID_OFFSET + CORNER_HALF, z: room('nw').z, width: DOOR_HALF * 2, connects: ['nw', 'corridor-top'] },
  { id: 'nw-left', x: room('nw').x, z: -CORNER_HALF + GRID_OFFSET, width: DOOR_HALF * 2, connects: ['nw', 'corridor-left'] },
  { id: 'ne-top', x: GRID_OFFSET - CORNER_HALF, z: room('ne').z, width: DOOR_HALF * 2, connects: ['ne', 'corridor-top'] },
  { id: 'ne-right', x: room('ne').x, z: -CORNER_HALF + GRID_OFFSET, width: DOOR_HALF * 2, connects: ['ne', 'corridor-right'] },
  { id: 'se-right', x: room('se').x, z: CORNER_HALF - GRID_OFFSET, width: DOOR_HALF * 2, connects: ['se', 'corridor-right'] },
  { id: 'se-bottom', x: GRID_OFFSET - CORNER_HALF, z: room('se').z, width: DOOR_HALF * 2, connects: ['se', 'corridor-bottom'] },
  { id: 'sw-bottom', x: -GRID_OFFSET + CORNER_HALF, z: room('sw').z, width: DOOR_HALF * 2, connects: ['sw', 'corridor-bottom'] },
  { id: 'sw-left', x: room('sw').x, z: CORNER_HALF - GRID_OFFSET, width: DOOR_HALF * 2, connects: ['sw', 'corridor-left'] },
  { id: 'central-north', x: 0, z: CENTRAL_HALF, width: DOOR_HALF * 2, connects: ['central', 'spoke-north'] },
  { id: 'central-south', x: 0, z: -CENTRAL_HALF, width: DOOR_HALF * 2, connects: ['central', 'spoke-south'] },
  { id: 'central-east', x: CENTRAL_HALF, z: 0, width: DOOR_HALF * 2, connects: ['central', 'spoke-east'] },
  { id: 'central-west', x: -CENTRAL_HALF, z: 0, width: DOOR_HALF * 2, connects: ['central', 'spoke-west'] },
  // Spoke <-> loop-corridor junctions: the other end of each spoke.
  { id: 'spoke-north-top', x: 0, z: GRID_OFFSET - DOOR_HALF, width: DOOR_HALF * 2, connects: ['spoke-north', 'corridor-top'] },
  { id: 'spoke-south-bottom', x: 0, z: -GRID_OFFSET + DOOR_HALF, width: DOOR_HALF * 2, connects: ['spoke-south', 'corridor-bottom'] },
  { id: 'spoke-east-right', x: GRID_OFFSET - DOOR_HALF, z: 0, width: DOOR_HALF * 2, connects: ['spoke-east', 'corridor-right'] },
  { id: 'spoke-west-left', x: -GRID_OFFSET + DOOR_HALF, z: 0, width: DOOR_HALF * 2, connects: ['spoke-west', 'corridor-left'] },
];

function doorway(id) {
  const found = DOORWAYS.find((d) => d.id === id);
  if (!found) throw new Error(`Unknown doorway id: ${id}`);
  return found;
}

// The gap a wall run must cut for a given doorway, expressed on the wall's
// own axis (axisCenter is that wall's x or z coordinate at the doorway).
// Reads the doorway's own width rather than the module-level constant, so
// the room-side gap always matches whatever that doorway declares.
//
// The corridor/spoke *channel* each doorway opens into is a separate,
// currently-fixed-width system (every wallAlongX/Z(DOOR_HALF, ...) call for
// a corridor or spoke wall below uses the module-level DOOR_HALF directly,
// not any individual doorway's width) -- consistent today only because
// every DOORWAYS entry happens to share the same width. Widening one
// doorway's `width` field alone would open a gap wider or narrower than the
// hallway behind it; the channel geometry would need the same per-doorway
// treatment to actually support that.
function doorGap(doorwayId, axisCenter) {
  const halfWidth = doorway(doorwayId).width / 2;
  return [axisCenter - halfWidth, axisCenter + halfWidth];
}

const nw = room('nw');
const ne = room('ne');
const se = room('se');
const sw = room('sw');
const central = room('central');

const WALLS = [
  // Corner rooms: two solid outward walls, two inward walls gapped for a doorway.
  ...wallAlongX(nw.z + nw.halfZ, nw.x - nw.halfX, nw.x + nw.halfX), // nw north, solid
  ...wallAlongZ(nw.x - nw.halfX, nw.z - nw.halfZ, nw.z + nw.halfZ), // nw west, solid
  ...wallAlongZ(nw.x + nw.halfX, nw.z - nw.halfZ, nw.z + nw.halfZ, [doorGap('nw-top', nw.z)]), // nw east -> top corridor
  ...wallAlongX(nw.z - nw.halfZ, nw.x - nw.halfX, nw.x + nw.halfX, [doorGap('nw-left', nw.x)]), // nw south -> left corridor

  ...wallAlongX(ne.z + ne.halfZ, ne.x - ne.halfX, ne.x + ne.halfX), // ne north, solid
  ...wallAlongZ(ne.x + ne.halfX, ne.z - ne.halfZ, ne.z + ne.halfZ), // ne east, solid
  ...wallAlongZ(ne.x - ne.halfX, ne.z - ne.halfZ, ne.z + ne.halfZ, [doorGap('ne-top', ne.z)]), // ne west -> top corridor
  ...wallAlongX(ne.z - ne.halfZ, ne.x - ne.halfX, ne.x + ne.halfX, [doorGap('ne-right', ne.x)]), // ne south -> right corridor

  ...wallAlongX(se.z - se.halfZ, se.x - se.halfX, se.x + se.halfX), // se south, solid
  ...wallAlongZ(se.x + se.halfX, se.z - se.halfZ, se.z + se.halfZ), // se east, solid
  ...wallAlongX(se.z + se.halfZ, se.x - se.halfX, se.x + se.halfX, [doorGap('se-bottom', se.x)]), // se north -> right corridor
  ...wallAlongZ(se.x - se.halfX, se.z - se.halfZ, se.z + se.halfZ, [doorGap('se-right', se.z)]), // se west -> bottom corridor

  ...wallAlongX(sw.z - sw.halfZ, sw.x - sw.halfX, sw.x + sw.halfX), // sw south, solid
  ...wallAlongZ(sw.x - sw.halfX, sw.z - sw.halfZ, sw.z + sw.halfZ), // sw west, solid
  ...wallAlongZ(sw.x + sw.halfX, sw.z - sw.halfZ, sw.z + sw.halfZ, [doorGap('sw-bottom', sw.z)]), // sw east -> bottom corridor
  ...wallAlongX(sw.z + sw.halfZ, sw.x - sw.halfX, sw.x + sw.halfX, [doorGap('sw-left', sw.x)]), // sw north -> left corridor

  // Central landmark room: all four walls gapped, one doorway per spoke.
  ...wallAlongX(central.z + central.halfZ, central.x - central.halfX, central.x + central.halfX, [doorGap('central-north', 0)]),
  ...wallAlongX(central.z - central.halfZ, central.x - central.halfX, central.x + central.halfX, [doorGap('central-south', 0)]),
  ...wallAlongZ(central.x + central.halfX, central.z - central.halfZ, central.z + central.halfZ, [doorGap('central-east', 0)]),
  ...wallAlongZ(central.x - central.halfX, central.z - central.halfZ, central.z + central.halfZ, [doorGap('central-west', 0)]),

  // Loop corridors: one solid outward wall, one inward wall gapped for the spoke into the centre.
  ...wallAlongX(nw.z + DOOR_HALF, nw.x + nw.halfX, ne.x - ne.halfX), // top corridor, outward (north)
  ...wallAlongX(nw.z - DOOR_HALF, nw.x + nw.halfX, ne.x - ne.halfX, [doorGap('spoke-north-top', 0)]), // top corridor, inward (south) -> north spoke

  ...wallAlongZ(ne.x + DOOR_HALF, se.z + se.halfZ, ne.z - ne.halfZ), // right corridor, outward (east)
  ...wallAlongZ(ne.x - DOOR_HALF, se.z + se.halfZ, ne.z - ne.halfZ, [doorGap('spoke-east-right', 0)]), // right corridor, inward (west) -> east spoke

  ...wallAlongX(se.z - DOOR_HALF, sw.x + sw.halfX, se.x - se.halfX), // bottom corridor, outward (south)
  ...wallAlongX(se.z + DOOR_HALF, sw.x + sw.halfX, se.x - se.halfX, [doorGap('spoke-south-bottom', 0)]), // bottom corridor, inward (north) -> south spoke

  ...wallAlongZ(sw.x - DOOR_HALF, sw.z + sw.halfZ, nw.z - nw.halfZ), // left corridor, outward (west)
  ...wallAlongZ(sw.x + DOOR_HALF, sw.z + sw.halfZ, nw.z - nw.halfZ, [doorGap('spoke-west-left', 0)]), // left corridor, inward (east) -> west spoke

  // Spokes: two side walls each, open at both ends (room doorway <-> corridor gap).
  ...wallAlongZ(DOOR_HALF, central.halfZ, nw.z - DOOR_HALF), // north spoke, east side
  ...wallAlongZ(-DOOR_HALF, central.halfZ, nw.z - DOOR_HALF), // north spoke, west side

  ...wallAlongZ(DOOR_HALF, -(sw.z - DOOR_HALF), -central.halfZ), // south spoke, east side
  ...wallAlongZ(-DOOR_HALF, -(sw.z - DOOR_HALF), -central.halfZ), // south spoke, west side

  ...wallAlongX(DOOR_HALF, central.halfX, ne.x - DOOR_HALF), // east spoke, north side
  ...wallAlongX(-DOOR_HALF, central.halfX, ne.x - DOOR_HALF), // east spoke, south side

  ...wallAlongX(DOOR_HALF, -(sw.x - DOOR_HALF), -central.halfX), // west spoke, north side
  ...wallAlongX(-DOOR_HALF, -(sw.x - DOOR_HALF), -central.halfX), // west spoke, south side
].map((w) => ({ ...w, halfY: WALL_HEIGHT / 2 }));

export const PILLARS = [
  { id: 'nw-pillar', x: nw.x, z: nw.z, halfX: 2, halfZ: 2 },
  { id: 'ne-pillar-a', x: ne.x - 3, z: ne.z, halfX: 1, halfZ: 1 },
  { id: 'ne-pillar-b', x: ne.x + 3, z: ne.z, halfX: 1, halfZ: 1 },
  { id: 'sw-pillar', x: sw.x + 3, z: sw.z + 3, halfX: 1.5, halfZ: 1.5 },
  { id: 'central-pillar', x: 0, z: 0, halfX: 2.5, halfZ: 2.5 },
].map((p) => ({ ...p, halfY: PILLAR_HALF_HEIGHT }));

// Two per room, offset from both the room centre and its pillar(s).
export const SPAWN_POINTS = [
  { x: nw.x - 5, y: 1, z: nw.z + 3 },
  { x: nw.x + 5, y: 1, z: nw.z - 3 },
  { x: ne.x - 3, y: 1, z: ne.z + 5 },
  { x: ne.x + 3, y: 1, z: ne.z - 5 },
  { x: se.x - 4, y: 1, z: se.z + 4 },
  { x: se.x + 4, y: 1, z: se.z - 4 },
  { x: sw.x - 4, y: 1, z: sw.z + 4 },
  { x: sw.x + 4, y: 1, z: sw.z - 4 },
  { x: -6, y: 1, z: 6 },
  { x: 6, y: 1, z: -6 },
];

// One continuous floor: every corner room shares CORNER_HALF, so the outer
// perimeter is a clean square and this bound is exact, not a computed
// approximation (Dependencies/Assumptions: the map keeps one floor collider,
// so U5's PARK_POSITION at y=-100 stays clear of it either way).
export const FLOOR_HALF_SIZE = GRID_OFFSET + CORNER_HALF;

export const LAYOUT = {
  rooms: ROOMS,
  doorways: DOORWAYS,
  walls: WALLS,
  pillars: PILLARS,
  spawnPoints: SPAWN_POINTS,
  floorHalfSize: FLOOR_HALF_SIZE,
  wallHeight: WALL_HEIGHT,
};
