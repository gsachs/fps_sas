// Where the camera sits while nobody is playing.
//
// Before this, the render loop returned early whenever the simulation was not
// running, so the camera was never positioned at all and the start screen
// showed the scene from the renderer's default pose: the origin, at floor
// level. The ground plane is single-sided, so the bottom half of the very
// first thing anyone saw was the underside of the world -- sky where the
// floor should be.
//
// A slow orbit above the site instead. It doubles as the brief: the start
// screen tells you to secure this place, and behind the text you are looking
// at it.
//
// Pure and framework-free, so the path can be checked (stays inside the
// arena, clears the walls, actually goes round) without a renderer.
import { FLOOR_HALF_SIZE, WALL_HEIGHT } from '../arena/layout.js';

// The wall footprint is not centred on the origin -- the districts sprawl
// further north and east than south and west -- so the orbit is centred on
// the middle of the geometry rather than on (0,0), or one side of the map
// would sit off frame for half the loop.
const CENTRE = { x: -1, z: 3.5 };
const ORBIT_RADIUS = 38;
// Well above WALL_HEIGHT so the camera looks down into the districts rather
// than at the outside of a wall, and far enough below the drone release
// height that an arriving bot still reads as coming from above.
const ORBIT_HEIGHT = 15;
const LOOK_AT_HEIGHT = 1.5;
// Slow enough to read as a drift rather than a spin; long enough that nobody
// sees it loop before they click.
const ORBIT_PERIOD_SECONDS = 90;

export const ATTRACT_ORBIT = { CENTRE, ORBIT_RADIUS, ORBIT_HEIGHT, ORBIT_PERIOD_SECONDS };

// Camera pose for the attract orbit at `elapsedSeconds` into it. Plain
// numbers at the boundary (KTD7), promoted to THREE types by the caller.
export function attractCameraPose(elapsedSeconds) {
  const angle = ((elapsedSeconds % ORBIT_PERIOD_SECONDS) / ORBIT_PERIOD_SECONDS) * Math.PI * 2;
  return {
    position: {
      x: CENTRE.x + Math.sin(angle) * ORBIT_RADIUS,
      y: ORBIT_HEIGHT,
      z: CENTRE.z + Math.cos(angle) * ORBIT_RADIUS,
    },
    lookAt: { x: CENTRE.x, y: LOOK_AT_HEIGHT, z: CENTRE.z },
  };
}

// Exported for the test that keeps the orbit honest as the map changes.
export const ATTRACT_BOUNDS = { floorHalfSize: FLOOR_HALF_SIZE, wallHeight: WALL_HEIGHT };
