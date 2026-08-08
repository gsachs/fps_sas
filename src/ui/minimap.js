// A player-only, player-up-rotating top-down map (R1-R4, R7, R8). Mirrors
// feedback.js's SVG + CSS-rotation precedent (KTD1) -- no canvas 2D exists in
// this codebase and this doesn't add one. Shows the entire fixed arena at
// all times (R2/KD4 -- no fog-of-war), rotating around its own center as the
// player turns, rather than panning to re-center on them: a "diagonal-fit"
// circular frame that always contains the whole floor only works cleanly
// when the rotation pivots on a fixed point (rotation preserves
// distance-from-center; panning to follow the player would need a frame
// sized for the worst-case corner-to-corner distance instead).
import { ROOM_ACCENTS, NEUTRAL_ACCENT_COLOR, WALL_THICKNESS, findRoomAt } from '../arena/layout.js';

export { findRoomAt };

const NEUTRAL_CELL_COLOR = `#${NEUTRAL_ACCENT_COLOR.toString(16).padStart(6, '0')}`;

const FRAME_DIAMETER_PX = 160;
const FRAME_MARGIN_PX = 16;
const MARKER_HALF_WIDTH = 0.045;
const MARKER_HALF_LENGTH = 0.06;

// A wall stroke drawn at the wall's real world thickness, converted into map
// space -- not a fixed map-space width. Map space is normalised to the floor
// diagonal, so a fixed width silently fattens as the arena grows: at the
// retired 34-unit floor 0.02 map units happened to equal about one world
// unit, but at this arena's 56.5 it drew walls 60% overweight and ate most
// of a 2-unit corridor's channel. Derived, it reads true at any arena size.
function wallStrokeWidth(scale) {
  return WALL_THICKNESS * 2 * scale;
}

// A circular frame must contain the whole square floor at every rotation.
// Rotation preserves distance-from-center, so sizing the frame to the
// floor's half-diagonal (not just its half-width) satisfies this for every
// orientation at once -- the diagonal-fit invariant (R2, KTD1).
function mapScale(floorHalfSize) {
  return 1 / (floorHalfSize * Math.SQRT2);
}

// World -> static map-space, arena-centered and unrotated: the shape every
// wall/room-cell is built from once. -worldZ because SVG's y axis increases
// downward while this codebase's forward convention increases z
// (movement.js) -- without the flip, "further along +Z" would render below
// centre instead of above it.
function toMapSpace(worldPoint, scale) {
  return { x: worldPoint.x * scale, y: -worldPoint.z * scale };
}

// R3/KTD2: rotates the whole map so the player's own facing always points up
// on screen, without recomputing every static wall/cell each frame -- one
// CSS transform on the group that contains them (mirrors feedback.js's
// `el.style.transform = 'rotate(...)'`, just with no translate: the frame is
// arena-centered, not player-centered, so nothing needs re-centering).
// Rotating by -yaw (not +yaw) is what makes this work: as the player turns
// right, the world must appear to turn left relative to them, the opposite
// direction -- verified against every quarter-turn in this module's test
// file, not just asserted from the algebra.
export function computeMapTransform(playerYaw) {
  return `rotate(${-playerYaw}rad)`;
}

// toMapSpace already flips z (y = -z*scale) to account for SVG's y-down
// axis; composing that flip with a rotation is not the same as rotating a
// plain (x, z) pair with the textbook matrix -- this is the corrected form,
// verified against the "ahead point ends up above the marker" case in this
// module's test file (an earlier version had the v-terms' signs flipped and
// only the magnitude-preserving diagonal-fit test happened to still pass).
function rotateMapPoint(point, playerYaw) {
  const cos = Math.cos(playerYaw);
  const sin = Math.sin(playerYaw);
  return { x: cos * point.x + sin * point.y, y: -sin * point.x + cos * point.y };
}

// The player's own marker position within the rotating frame -- the same
// toMapSpace + rotate pipeline the static layout uses, so it always lands
// exactly where the (rotated) layout says the player's room is. Kept as a
// sibling of the rotating SVG group, not a child of it, on purpose: a child
// would inherit the group's rotation on its own drawn shape too, making the
// marker's arrow spin with the map instead of always pointing up.
export function computeMarkerPosition(playerPosition, playerYaw, floorHalfSize) {
  const scale = mapScale(floorHalfSize);
  return rotateMapPoint(toMapSpace(playerPosition, scale), playerYaw);
}

// R3/KTD2: where a world point ends up on screen relative to the player --
// built on the sim forward basis (sin/cos of yaw), the same convention
// movement.js decodes commands with and entityMesh.js's camera corrects for
// (docs/solutions/logic-errors/strafe-direction-camera-basis-mismatch.md).
// Mathematically the delta between two points transforms identically
// whether computed this way or via the full arena-centered pipeline above
// (both are linear in the same rotation), so this stays the right function
// for screen-space assertions like AE2 even though production rendering
// itself never recenters on the player.
export function projectToMap(worldPoint, playerPosition, playerYaw, floorHalfSize) {
  const scale = mapScale(floorHalfSize);
  const delta = { x: worldPoint.x - playerPosition.x, z: worldPoint.z - playerPosition.z };
  return rotateMapPoint(toMapSpace(delta, scale), playerYaw);
}

// R4: a room's map-cell tint -- the same palette world accents use
// (layout.js's ROOM_ACCENTS, KTD6), neutral for corridors and the landmark
// room (R5).
export function roomTint(room) {
  if (!room) return NEUTRAL_CELL_COLOR;
  const hue = ROOM_ACCENTS[room.id];
  return hue === undefined ? NEUTRAL_CELL_COLOR : `#${hue.toString(16).padStart(6, '0')}`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

// KTD6: mounts the minimap alongside the HUD (R7 -- present whenever normal
// play HUD is), built once from the layout descriptors and updated per
// frame by the caller. R8: the returned update() admits only the player's
// own transform, so there is no parameter through which any other entity's
// position could reach the map.
export function createMinimap(container, layout) {
  const scale = mapScale(layout.floorHalfSize);

  const wrapper = document.createElement('div');
  wrapper.style.cssText =
    `position:absolute;right:${FRAME_MARGIN_PX}px;bottom:${FRAME_MARGIN_PX}px;` +
    `width:${FRAME_DIAMETER_PX}px;height:${FRAME_DIAMETER_PX}px;border-radius:50%;overflow:hidden;` +
    'pointer-events:none;border:2px solid rgba(255,255,255,0.55);background:#1c1c1c;';
  container.appendChild(wrapper);

  const svg = svgEl('svg', { viewBox: '-1 -1 2 2', width: '100%', height: '100%' });
  wrapper.appendChild(svg);

  const rotatingGroup = svgEl('g', {});
  rotatingGroup.style.transformOrigin = '0px 0px';
  // No CSS transition on the transform (KTD1): easing would add lag at flick
  // speeds, and the whole point of player-up rotation is that it matches
  // what's in front of the player right now.
  svg.appendChild(rotatingGroup);

  // Room cells first (under the walls), corridors/landmark left untinted (R4/R5).
  for (const room of layout.rooms) {
    const centre = toMapSpace(room, scale);
    const halfW = room.halfX * scale;
    const halfH = room.halfZ * scale;
    rotatingGroup.appendChild(
      svgEl('rect', {
        x: centre.x - halfW,
        y: centre.y - halfH,
        width: halfW * 2,
        height: halfH * 2,
        fill: roomTint(room),
      })
    );
  }

  // Wall segments as line strokes -- corridors have no room descriptor of
  // their own, so this is what draws their topology on the map at all.
  for (const wall of layout.walls) {
    const centre = toMapSpace(wall, scale);
    const alongX = wall.halfX > wall.halfZ;
    const halfLength = (alongX ? wall.halfX : wall.halfZ) * scale;
    const [x1, y1, x2, y2] = alongX
      ? [centre.x - halfLength, centre.y, centre.x + halfLength, centre.y]
      : [centre.x, centre.y - halfLength, centre.x, centre.y + halfLength];
    rotatingGroup.appendChild(
      svgEl('line', {
        x1,
        y1,
        x2,
        y2,
        stroke: '#3a3a3a',
        'stroke-width': wallStrokeWidth(scale),
        'stroke-linecap': 'round',
      })
    );
  }

  // The marker: a fixed-shape, always-up-pointing triangle. Not a child of
  // rotatingGroup (see computeMarkerPosition's doc comment) -- its own
  // position is recomputed every frame instead, through the same rotation.
  const marker = svgEl('polygon', {
    points: `0,${-MARKER_HALF_LENGTH} ${MARKER_HALF_WIDTH},${MARKER_HALF_LENGTH} ${-MARKER_HALF_WIDTH},${MARKER_HALF_LENGTH}`,
    fill: '#ffffff',
  });
  svg.appendChild(marker);

  function update(playerPosition, playerYaw) {
    rotatingGroup.style.transform = computeMapTransform(playerYaw);
    const markerPos = computeMarkerPosition(playerPosition, playerYaw, layout.floorHalfSize);
    marker.setAttribute('transform', `translate(${markerPos.x}, ${markerPos.y})`);
  }

  // Same reason as the viewmodel's: the minimap is the player's instrument,
  // and there is no player at the start screen.
  function setVisible(visible) {
    wrapper.style.display = visible ? 'block' : 'none';
  }

  return { update, setVisible };
}
