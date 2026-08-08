// The single source of truth for the asymmetric-districts map (KTD6): walls,
// districts, doorways, pillars/cover, spawn points, pickups, and the
// reserved flag site all live here, in one dataset, so physics (arena.js)
// and render (arenaMesh.js) can never drift out of sync.
//
// Six districts -- five outlying plus the landmark room -- joined by a
// corridor web of spokes (landmark to four of the five outlying districts),
// a perimeter chain linking every outlying district to its neighbours, and
// two straight cross-cuts, so no single ring circuit is the default way
// around (R1, R3). Each outlying district gets its own spatial grammar
// (R2): Yard (open, long sightlines), Hall (pillared), Maze (cover-block
// zigzag), Warren (tight chamber partitions), Bazaar (scattered cover) --
// distinguishable by structure alone, accent colour only a secondary cue.

const GRID_HALF = 1.5; // corridor/doorway half-width -- KTD5: uniform everywhere
// How far each spoke doorway sits off its room's centre-axis, on both the
// landmark end and the outlying district's end of the same spoke (the two
// must match -- a spoke is one straight corridor, so both of its doorways
// share this spoke's fixed cross-axis coordinate). This is what keeps a
// room's own doorway pair from lining up through its centre (see the
// DOORWAYS comment below) -- a single named constant so every one of its
// call sites can never drift out of sync with the others the way a
// hand-typed literal at each site could.
const SPOKE_OFFSET = 3;
// Half-thickness, matching the retired arena's convention. Exported because
// minimap.js draws walls as strokes and must size them from the real world
// thickness (KTD6's one-dataset principle) rather than carry its own copy.
export const WALL_THICKNESS = 0.5;
export const WALL_HEIGHT = 4;
const PILLAR_HALF_HEIGHT = WALL_HEIGHT / 2; // full-height landmarks, not peek-over cover

// Split [from, to] around zero or more gaps, returning the surviving
// sub-intervals. A doorway is a gap in exactly one wall run; a plain wall is
// the zero-gap case, returned unsplit.
function splitAroundGaps(from, to, gaps) {
  if (from >= to) throw new Error(`splitAroundGaps: reversed run, from ${from} >= to ${to}`);
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
// around any doorway gaps. spaceId (KTD4) is the room or corridor/spoke id
// this wall belongs to -- every resulting segment carries it, so a doorway
// gap never produces an unowned piece.
function wallAlongX(z, from, to, spaceId, gaps = []) {
  return splitAroundGaps(from, to, gaps).map(([x0, x1]) => ({
    x: (x0 + x1) / 2,
    z,
    halfX: (x1 - x0) / 2,
    halfZ: WALL_THICKNESS,
    spaceId,
  }));
}

// A wall run along the Z axis: fixed x, spanning z in [from, to].
function wallAlongZ(x, from, to, spaceId, gaps = []) {
  return splitAroundGaps(from, to, gaps).map(([z0, z1]) => ({
    x,
    z: (z0 + z1) / 2,
    halfX: WALL_THICKNESS,
    halfZ: (z1 - z0) / 2,
    spaceId,
  }));
}

// Two parallel side walls the full length of a straight corridor/spoke
// segment -- both ends stay fully open (no gap needed, no end cap): the
// segment's own width already equals a doorway's width, so an open end IS
// the doorway (the existing spoke convention).
function corridorAlongX(z, from, to, spaceId) {
  return [wallAlongX(z + GRID_HALF, from, to, spaceId), wallAlongX(z - GRID_HALF, from, to, spaceId)].flat();
}
function corridorAlongZ(x, from, to, spaceId) {
  return [wallAlongZ(x + GRID_HALF, from, to, spaceId), wallAlongZ(x - GRID_HALF, from, to, spaceId)].flat();
}

// splitAroundGaps rejects a reversed run, and a bend's legs run in whichever
// direction their district happens to lie.
function ascending(a, b) {
  return a < b ? [a, b] : [b, a];
}

// Where a corridor running out of `room` has to start: the OUTER face of the
// wall bounding that side, not the room boundary itself.
//
// The boundary is that wall's centreline -- wallAlongX/Z straddle it, half a
// thickness each way -- so a corridor whose side walls start at the boundary
// buries its first half-unit inside the room's own wall. Two boxes sharing a
// volume is invisible while they share a material, which is why the corridor
// web read fine against the neutral landmark, and z-fights the moment the
// room carries an accent: every junction with Hall, Yard, Maze, Warren and
// Bazaar flickered between the accent colour and the neutral one, in
// whatever pattern the depth buffer happened to resolve that frame.
const northFace = (room) => room.z + room.halfZ + WALL_THICKNESS;
const southFace = (room) => room.z - room.halfZ - WALL_THICKNESS;
const eastFace = (room) => room.x + room.halfX + WALL_THICKNESS;
const westFace = (room) => room.x - room.halfX - WALL_THICKNESS;

// A two-segment corridor bend (KTD4): one leg along Z and one along X,
// meeting at (bendX, bendZ) and running out to `zLegEnd` / `xLegEnd`. Only
// the INNER pair of walls stops at the inside corner -- the OUTER pair runs
// flush around the outside of the turn, the same mitre a room's own two
// perpendicular walls already make.
//
// The shape this replaces stopped BOTH pairs short of the bend, on the
// reasoning that a wall run to the corner would seal the turn shut. That is
// true of the inner pair only: pulling the outer pair back too left the
// outside of every turn open to the exterior, so the arena was not a closed
// volume and a player could walk out of the map (test/arena/layout.test.js
// now flood-fills from outside the floor to keep it closed).
function bentLink(bendX, bendZ, zLegEnd, xLegEnd, zLegSpaceId, xLegSpaceId) {
  const towardX = Math.sign(xLegEnd - bendX); // which side of the Z leg the X leg leaves from
  const towardZ = Math.sign(zLegEnd - bendZ);
  const outerX = bendX - towardX * GRID_HALF;
  const innerX = bendX + towardX * GRID_HALF;
  const outerZ = bendZ - towardZ * GRID_HALF;
  const innerZ = bendZ + towardZ * GRID_HALF;
  return [
    wallAlongZ(outerX, ...ascending(outerZ, zLegEnd), zLegSpaceId),
    wallAlongZ(innerX, ...ascending(innerZ, zLegEnd), zLegSpaceId),
    wallAlongX(outerZ, ...ascending(outerX, xLegEnd), xLegSpaceId),
    wallAlongX(innerZ, ...ascending(innerX, xLegEnd), xLegSpaceId),
  ].flat();
}

const DOOR_HALF = GRID_HALF;

// The gap a wall run must cut for a given doorway, expressed on the wall's
// own axis (axisCenter is that wall's x or z coordinate at the doorway).
// Reads the doorway's own width rather than the module-level constant, so
// the room-side gap always matches whatever that doorway declares.
function doorGap(doorwayId, axisCenter) {
  const halfWidth = doorway(doorwayId).width / 2;
  return [axisCenter - halfWidth, axisCenter + halfWidth];
}

// Rooms whose pillar/cover geometry sits exactly at the room's geometric
// centre need a navigation point offset away from it -- a bot can never
// arrive at a point buried inside solid geometry. Only the landmark room
// needs this: every outlying district's doorways are deliberately offset
// off-centre (see DOORWAYS below), so no other room's centre needs to double
// as a through-sightline blocker.
const NAV_POINT_OVERRIDES = {
  landmark: { x: 7, z: -7 },
};

// Axis-aligned footprints, each shaped for its own grammar (KTD4). Distances
// and sizes are hand-picked, not derived from a formula, the same way the
// original four-corner layout was.
export const ROOMS = [
  { id: 'landmark', x: 0, z: 0, halfX: 11, halfZ: 11 },
  { id: 'yard', x: -40, z: 0, halfX: 12, halfZ: 10 },
  { id: 'hall', x: 0, z: 42, halfX: 13, halfZ: 10 },
  { id: 'maze', x: 38, z: 0, halfX: 12, halfZ: 11 },
  { id: 'warren', x: 0, z: -36, halfX: 9, halfZ: 9 },
  { id: 'bazaar', x: 38, z: 42, halfX: 10, halfZ: 8 },
].map((r) => {
  const offset = NAV_POINT_OVERRIDES[r.id];
  return offset ? { ...r, navPoint: { x: r.x + offset.x, z: r.z + offset.z } } : r;
});

function room(id) {
  const found = ROOMS.find((r) => r.id === id);
  if (!found) throw new Error(`Unknown room id: ${id}`);
  return found;
}

// The room whose bounds contain a position, or null in a corridor/spoke.
// Shared by both render consumers (arenaMesh.js's per-room accents,
// minimap.js's room-cell lookup) so the point-in-room test can't drift
// between them the way two independently-written copies could (KTD6).
export function findRoomAt(position, rooms) {
  return (
    rooms.find(
      (r) => Math.abs(position.x - r.x) <= r.halfX && Math.abs(position.z - r.z) <= r.halfZ
    ) || null
  );
}

const landmark = room('landmark');
const yard = room('yard');
const hall = room('hall');
const maze = room('maze');
const warren = room('warren');
const bazaar = room('bazaar');

// One entry per doorway threshold: its centre point, width, and the two
// spaces (room or corridor) it joins. Every doorway is deliberately offset
// off its room's geometric centre (never at x=0/z=0 relative to the room)
// so that no pair of a room's doorways lines up through its centre into a
// single uninterrupted sightline -- the mechanism that keeps every long
// sightline ending inside its own district (R4) without needing a
// centre-blocking pillar in every room. U3's waypoint graph reads positions
// straight off this list.
export const DOORWAYS = [
  { id: 'landmark-north', x: SPOKE_OFFSET, z: landmark.z + landmark.halfZ, width: DOOR_HALF * 2, connects: ['landmark', 'spoke-north'] },
  { id: 'landmark-south', x: -SPOKE_OFFSET, z: landmark.z - landmark.halfZ, width: DOOR_HALF * 2, connects: ['landmark', 'spoke-south'] },
  { id: 'landmark-east', x: landmark.x + landmark.halfX, z: SPOKE_OFFSET, width: DOOR_HALF * 2, connects: ['landmark', 'spoke-east'] },
  { id: 'landmark-west', x: landmark.x - landmark.halfX, z: -SPOKE_OFFSET, width: DOOR_HALF * 2, connects: ['landmark', 'spoke-west'] },

  { id: 'yard-spoke', x: yard.x + yard.halfX, z: -SPOKE_OFFSET, width: DOOR_HALF * 2, connects: ['yard', 'spoke-west'] },
  { id: 'yard-north', x: -46, z: yard.z + yard.halfZ, width: DOOR_HALF * 2, connects: ['yard', 'link-yard-hall-v'] },
  { id: 'yard-south', x: -34, z: yard.z - yard.halfZ, width: DOOR_HALF * 2, connects: ['yard', 'link-warren-yard-v'] },

  { id: 'hall-spoke', x: SPOKE_OFFSET, z: hall.z - hall.halfZ, width: DOOR_HALF * 2, connects: ['hall', 'spoke-north'] },
  { id: 'hall-west', x: hall.x - hall.halfX, z: 35, width: DOOR_HALF * 2, connects: ['hall', 'link-yard-hall-h'] },
  { id: 'hall-east', x: hall.x + hall.halfX, z: 44, width: DOOR_HALF * 2, connects: ['hall', 'link-hall-bazaar'] },

  { id: 'maze-spoke', x: maze.x - maze.halfX, z: SPOKE_OFFSET, width: DOOR_HALF * 2, connects: ['maze', 'spoke-east'] },
  { id: 'maze-north', x: 42, z: maze.z + maze.halfZ, width: DOOR_HALF * 2, connects: ['maze', 'link-bazaar-maze'] },
  { id: 'maze-south', x: 32, z: maze.z - maze.halfZ, width: DOOR_HALF * 2, connects: ['maze', 'link-maze-warren-v'] },

  { id: 'warren-spoke', x: -SPOKE_OFFSET, z: warren.z + warren.halfZ, width: DOOR_HALF * 2, connects: ['warren', 'spoke-south'] },
  { id: 'warren-east', x: warren.x + warren.halfX, z: -30, width: DOOR_HALF * 2, connects: ['warren', 'link-maze-warren-h'] },
  { id: 'warren-west', x: warren.x - warren.halfX, z: -40, width: DOOR_HALF * 2, connects: ['warren', 'link-warren-yard-h'] },

  { id: 'bazaar-west', x: bazaar.x - bazaar.halfX, z: 44, width: DOOR_HALF * 2, connects: ['bazaar', 'link-hall-bazaar'] },
  { id: 'bazaar-south', x: 42, z: bazaar.z - bazaar.halfZ, width: DOOR_HALF * 2, connects: ['bazaar', 'link-bazaar-maze'] },

  // Bend junctions (KTD4's approach step 2): a corridor bend is two straight,
  // convex segments meeting at a shared doorway, never one L-shaped space.
  { id: 'link-yard-hall-bend', x: -46, z: 35, width: DOOR_HALF * 2, connects: ['link-yard-hall-v', 'link-yard-hall-h'] },
  { id: 'link-maze-warren-bend', x: 32, z: -30, width: DOOR_HALF * 2, connects: ['link-maze-warren-v', 'link-maze-warren-h'] },
  { id: 'link-warren-yard-bend', x: -34, z: -40, width: DOOR_HALF * 2, connects: ['link-warren-yard-h', 'link-warren-yard-v'] },
];

function doorway(id) {
  const found = DOORWAYS.find((d) => d.id === id);
  if (!found) throw new Error(`Unknown doorway id: ${id}`);
  return found;
}

const WALLS = [
  // Landmark: all four walls gapped, one doorway per spoke.
  ...wallAlongX(landmark.z + landmark.halfZ, landmark.x - landmark.halfX, landmark.x + landmark.halfX, 'landmark', [doorGap('landmark-north', SPOKE_OFFSET)]),
  ...wallAlongX(landmark.z - landmark.halfZ, landmark.x - landmark.halfX, landmark.x + landmark.halfX, 'landmark', [doorGap('landmark-south', -SPOKE_OFFSET)]),
  ...wallAlongZ(landmark.x + landmark.halfX, landmark.z - landmark.halfZ, landmark.z + landmark.halfZ, 'landmark', [doorGap('landmark-east', SPOKE_OFFSET)]),
  ...wallAlongZ(landmark.x - landmark.halfX, landmark.z - landmark.halfZ, landmark.z + landmark.halfZ, 'landmark', [doorGap('landmark-west', -SPOKE_OFFSET)]),

  // Yard: north, south, and east gapped; west solid (the yard's own
  // far wall, no route needs it).
  ...wallAlongX(yard.z + yard.halfZ, yard.x - yard.halfX, yard.x + yard.halfX, 'yard', [doorGap('yard-north', -46)]),
  ...wallAlongX(yard.z - yard.halfZ, yard.x - yard.halfX, yard.x + yard.halfX, 'yard', [doorGap('yard-south', -34)]),
  ...wallAlongZ(yard.x + yard.halfX, yard.z - yard.halfZ, yard.z + yard.halfZ, 'yard', [doorGap('yard-spoke', -SPOKE_OFFSET)]),
  ...wallAlongZ(yard.x - yard.halfX, yard.z - yard.halfZ, yard.z + yard.halfZ, 'yard'),

  // Hall: south, west, east gapped; north solid.
  ...wallAlongX(hall.z - hall.halfZ, hall.x - hall.halfX, hall.x + hall.halfX, 'hall', [doorGap('hall-spoke', SPOKE_OFFSET)]),
  ...wallAlongZ(hall.x - hall.halfX, hall.z - hall.halfZ, hall.z + hall.halfZ, 'hall', [doorGap('hall-west', 35)]),
  ...wallAlongZ(hall.x + hall.halfX, hall.z - hall.halfZ, hall.z + hall.halfZ, 'hall', [doorGap('hall-east', 44)]),
  ...wallAlongX(hall.z + hall.halfZ, hall.x - hall.halfX, hall.x + hall.halfX, 'hall'),

  // Maze: west, north, south gapped; east solid.
  ...wallAlongZ(maze.x - maze.halfX, maze.z - maze.halfZ, maze.z + maze.halfZ, 'maze', [doorGap('maze-spoke', SPOKE_OFFSET)]),
  ...wallAlongX(maze.z + maze.halfZ, maze.x - maze.halfX, maze.x + maze.halfX, 'maze', [doorGap('maze-north', 42)]),
  ...wallAlongX(maze.z - maze.halfZ, maze.x - maze.halfX, maze.x + maze.halfX, 'maze', [doorGap('maze-south', 32)]),
  ...wallAlongZ(maze.x + maze.halfX, maze.z - maze.halfZ, maze.z + maze.halfZ, 'maze'),

  // Warren: north, east, west gapped; south solid.
  ...wallAlongX(warren.z + warren.halfZ, warren.x - warren.halfX, warren.x + warren.halfX, 'warren', [doorGap('warren-spoke', -SPOKE_OFFSET)]),
  ...wallAlongZ(warren.x + warren.halfX, warren.z - warren.halfZ, warren.z + warren.halfZ, 'warren', [doorGap('warren-east', -30)]),
  ...wallAlongZ(warren.x - warren.halfX, warren.z - warren.halfZ, warren.z + warren.halfZ, 'warren', [doorGap('warren-west', -40)]),
  ...wallAlongX(warren.z - warren.halfZ, warren.x - warren.halfX, warren.x + warren.halfX, 'warren'),

  // Bazaar: west and south gapped; north and east solid.
  ...wallAlongZ(bazaar.x - bazaar.halfX, bazaar.z - bazaar.halfZ, bazaar.z + bazaar.halfZ, 'bazaar', [doorGap('bazaar-west', 44)]),
  ...wallAlongX(bazaar.z - bazaar.halfZ, bazaar.x - bazaar.halfX, bazaar.x + bazaar.halfX, 'bazaar', [doorGap('bazaar-south', 42)]),
  ...wallAlongX(bazaar.z + bazaar.halfZ, bazaar.x - bazaar.halfX, bazaar.x + bazaar.halfX, 'bazaar'),
  ...wallAlongZ(bazaar.x + bazaar.halfX, bazaar.z - bazaar.halfZ, bazaar.z + bazaar.halfZ, 'bazaar'),

  // Spokes: landmark to four of the five outlying districts (R1).
  ...corridorAlongZ(SPOKE_OFFSET, northFace(landmark), southFace(hall), 'spoke-north'),
  ...corridorAlongZ(-SPOKE_OFFSET, northFace(warren), southFace(landmark), 'spoke-south'),
  ...corridorAlongX(SPOKE_OFFSET, eastFace(landmark), westFace(maze), 'spoke-east'),
  ...corridorAlongX(-SPOKE_OFFSET, eastFace(yard), westFace(landmark), 'spoke-west'),

  // Straight cross-cuts (R3): Hall-Bazaar-Maze bypasses the landmark
  // entirely, giving real route choice at ground level, not just a
  // theoretical detour through the hub.
  ...corridorAlongX(44, eastFace(hall), westFace(bazaar), 'link-hall-bazaar'),
  ...corridorAlongZ(42, northFace(maze), southFace(bazaar), 'link-bazaar-maze'),

  // Perimeter chain, each a bent two-segment link (KTD4): Yard-Hall,
  // Maze-Warren, Warren-Yard. bentLink mitres each turn -- see its own
  // comment for why the outside of the turn must run flush.
  ...bentLink(-46, 35, northFace(yard), westFace(hall), 'link-yard-hall-v', 'link-yard-hall-h'),
  ...bentLink(32, -30, southFace(maze), eastFace(warren), 'link-maze-warren-v', 'link-maze-warren-h'),
  ...bentLink(-34, -40, southFace(yard), westFace(warren), 'link-warren-yard-v', 'link-warren-yard-h'),
].map((w) => ({ ...w, halfY: WALL_HEIGHT / 2 }));

// Interior cover/landmarks, one grammar-shaped cluster per district (KTD4).
// Every block is free-standing and convex, and every one is kept clear of
// each district's doorway-to-nav-point segments (validated in
// layout.test.js) -- no closed chambers, no deep concave pockets.
export const PILLARS = [
  // Landmark: a single central pillar, doubling as flag-site cover and the
  // reason this room needs a nav-point override.
  { id: 'landmark-pillar', x: 0, z: 0, halfX: 3, halfZ: 3 },

  // Hall: three pillars, off both the spoke-to-centre and the west/east
  // doorway-to-centre lines -- a grand room, not an obstacle course.
  { id: 'hall-pillar-a', x: -8, z: 34.5, halfX: 1.5, halfZ: 1.5 },
  { id: 'hall-pillar-b', x: 8, z: 34.5, halfX: 1.5, halfZ: 1.5 },
  { id: 'hall-pillar-c', x: 0, z: 50, halfX: 1.5, halfZ: 1.5 },

  // Maze: four cover blocks in the four off-axis quadrants around the
  // centre, forcing a zigzag path between any two doorways.
  { id: 'maze-block-a', x: 32, z: 5, halfX: 2, halfZ: 1.5 },
  { id: 'maze-block-b', x: 44, z: 5, halfX: 2, halfZ: 1.5 },
  { id: 'maze-block-c', x: 32, z: -5, halfX: 2, halfZ: 1.5 },
  { id: 'maze-block-d', x: 44, z: -5, halfX: 2, halfZ: 1.5 },

  // Warren: four small partition blocks in a pinwheel, breaking the room
  // into short zigzag chambers -- tightest sightlines of any district.
  { id: 'warren-block-a', x: 7, z: -29.5, halfX: 1, halfZ: 1 },
  { id: 'warren-block-b', x: -7, z: -29.5, halfX: 1, halfZ: 1 },
  { id: 'warren-block-c', x: 7, z: -42.5, halfX: 1, halfZ: 1 },
  { id: 'warren-block-d', x: -7, z: -42.5, halfX: 1, halfZ: 1 },

  // Bazaar: four scattered stalls, denser and more irregular than Hall's
  // pillars, more organic than Maze's structured zigzag.
  { id: 'bazaar-stall-a', x: 32, z: 47, halfX: 1.5, halfZ: 1 },
  { id: 'bazaar-stall-b', x: 44, z: 47, halfX: 1, halfZ: 1.5 },
  { id: 'bazaar-stall-c', x: 44, z: 36, halfX: 1.5, halfZ: 1 },
  { id: 'bazaar-stall-d', x: 32, z: 36, halfX: 1, halfZ: 1.5 },
].map((p) => ({ ...p, halfY: PILLAR_HALF_HEIGHT }));

// Two spawn points per district (twelve total), each clear of that
// district's own cover and doorway openings.
export const SPAWN_POINTS = [
  { x: 8, y: 1, z: -8 },
  { x: -8, y: 1, z: 8 },
  { x: -50, y: 1, z: 5 },
  { x: -50, y: 1, z: -5 },
  { x: -6, y: 1, z: 46 },
  { x: 6, y: 1, z: 34 },
  { x: 30, y: 1, z: 8 },
  { x: 46, y: 1, z: -8 },
  { x: 0, y: 1, z: -30 },
  { x: 0, y: 1, z: -42 },
  { x: 40, y: 1, z: 47 },
  { x: 32, y: 1, z: 38 },
];

// One grenade pickup per outlying district (R7), hand-placed clear of that
// district's cover and doorway openings.
export const PICKUPS = [
  { id: 'pickup-grenade-yard', type: 'grenade', x: -50, y: 1, z: 0, roomId: 'yard' },
  { id: 'pickup-grenade-hall', type: 'grenade', x: 0, y: 1, z: 46, roomId: 'hall' },
  { id: 'pickup-grenade-maze', type: 'grenade', x: 38, y: 1, z: 0, roomId: 'maze' },
  { id: 'pickup-grenade-warren', type: 'grenade', x: 0, y: 1, z: -36, roomId: 'warren' },
  { id: 'pickup-grenade-bazaar', type: 'grenade', x: 38, y: 1, z: 42, roomId: 'bazaar' },
];

// KTD3: a reserved coordinate only -- nothing renders and no minimap marker
// exists yet. Clearance-validated the same way a pickup is (clear of the
// landmark pillar and every landmark doorway opening); the flag pass adds
// the visible objective on top of this same descriptor.
export const FLAG_SITE = { id: 'flag-site-landmark', x: -7, y: 1, z: 7, roomId: 'landmark' };

// KTD1: the outer footprint stays one bigger square -- a single scalar
// computed as the bounding half-size over every wall segment, so districts
// can grow or move without this ever drifting out of sync or needing a
// hand-updated constant.
const WALL_MARGIN = 4; // clearance beyond the outermost wall face before the boundary floor/skybox
export const FLOOR_HALF_SIZE = Math.max(
  ...WALLS.map((w) => Math.max(Math.abs(w.x) + w.halfX, Math.abs(w.z) + w.halfZ))
) + WALL_MARGIN;

// Okabe-Ito colorblind-safe subset, no blue member (the fog is pale blue --
// R6): the original four hues plus yellow, the palette ceiling (KTD4) that
// caps this pass at five accented districts. Landmark and every corridor/
// spoke stay neutral (R5) and have no entry.
export const ROOM_ACCENTS = {
  yard: 0xe69f00,
  hall: 0xd55e00,
  maze: 0xcc79a7,
  warren: 0x009e73,
  bazaar: 0xf0e442,
};

// The neutral material/cell colour for corridors, spokes, and the landmark
// room -- shared for the same reason as ROOM_ACCENTS above (arenaMesh.js's
// wall material and minimap.js's neutral cell tint must agree, not carry two
// independently-hardcoded copies of the same value).
export const NEUTRAL_ACCENT_COLOR = 0xa89f8a;

export const LAYOUT = {
  rooms: ROOMS,
  doorways: DOORWAYS,
  walls: WALLS,
  pillars: PILLARS,
  spawnPoints: SPAWN_POINTS,
  pickups: PICKUPS,
  flagSite: FLAG_SITE,
  floorHalfSize: FLOOR_HALF_SIZE,
  wallHeight: WALL_HEIGHT,
};
