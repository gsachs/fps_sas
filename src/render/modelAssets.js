// Which external asset files the game ships, and the per-asset quirks needed
// to use each one correctly. Source models are authored to nobody's convention but
// their own -- native height, forward axis, origin, and animation clip names
// all vary per pack -- and every one of those quirks used to live as a loose
// literal at the call site in main.js, or worse, as a module constant inside
// mixer.js that silently assumed one specific rig. Collecting them here means
// swapping an asset is an edit to one descriptor, not a hunt across files.

// Measured from each GLB's posed bind pose, not guessed: load the model,
// `new THREE.Box3().setFromObject(scene)`, read the height. Re-measure when
// swapping the file, since a replacement almost never matches.
const HUMANOID_RENDER_HEIGHT = 1.605; // what the previous humanoid rig rendered at (1.783 native x 0.9)
const ROBOT_NATIVE_HEIGHT = 4.634;
// Box3().setFromObject on the loaded scene, longest axis -- barrel-to-stock.
const MACHINEGUN_NATIVE_LENGTH = 8.854;
// The MG's placeholder box (weaponView.js's registerVisual) is z: 0.55;
// matching it here means the model swap doesn't also change how big the gun
// reads.
const MACHINEGUN_VIEW_LENGTH = 0.55;

// Measured by eye against the arena's real floor footprint (layout.js's
// FLOOR_HALF_SIZE*2 -- arenaMesh.js reads the same value off the live arena
// it's building, not this constant, so the two can never drift apart): 2
// metres reads as a human-scale wall/floor panel -- half of WALL_HEIGHT (4),
// so a wall shows two tile-rows floor to ceiling -- without looking
// stretched across the floor or noisy-dense on a pillar face.
const ARENA_TEXTURE_METERS_PER_TILE = 2;

// Bot avatar. Scaled to the on-screen height the humanoid rig used, so the
// swap changes what a bot looks like without changing how big it reads.
export const BOT_MODEL = {
  path: 'assets/characters/quaternius-robot.glb',
  scale: HUMANOID_RENDER_HEIGHT / ROBOT_NATIVE_HEIGHT,
  // This rig's forward faces -Z; entity yaw=0 faces +Z.
  yawOffset: Math.PI,
  // This pack names clips 'RobotArmature|Robot_*' where the humanoid rig used
  // 'Rig|*' -- the exact mismatch that makes a naive model swap render a
  // motionless bind pose. It has no shoot animation, so the firing reaction
  // borrows its melee swing, which reads as an attack at this distance.
  clips: {
    idle: 'RobotArmature|Robot_Idle',
    moving: 'RobotArmature|Robot_Running',
    dead: 'RobotArmature|Robot_Death',
    fire: 'RobotArmature|Robot_Punch',
  },
};

// The machine gun's own fire samples. Several, because one sample repeating
// at this fire rate reads as a buzzer rather than a weapon; the player
// cycles through them.
export const MACHINEGUN_GUNSHOT_PATHS = [
  'assets/audio/machinegun-000.ogg',
  'assets/audio/machinegun-001.ogg',
  'assets/audio/machinegun-002.ogg',
];

// The grenade explosion's own sample. One variant: explosions are infrequent
// enough (one grenade at a time, not automatic fire) that a repeating sample
// doesn't read as a buzzer the way gunfire would.
export const EXPLOSION_PATHS = ['assets/audio/explosion-000.ogg'];

// First-person machine gun, replacing weaponView.js's placeholder box
// through the setModel(model, transform, 'machinegun') seam. Static
// (non-skinned) by requirement -- a skinned model in this pack cannot
// survive loadPropModel's plain clone. Offset here is -center * scale for
// the box measured below, not eyeballed; this exact model has not been
// rendered in this sandbox (no WebGL context available), so the offset's
// *orientation* correctness (does the muzzle actually point down -Z) is a
// defensible assumption from the pack's shared convention, not a confirmed
// visual measurement -- flag for the live play-check.
export const MACHINEGUN_MODEL = {
  path: 'assets/weapons/quaternius-rifle-static.glb',
  scale: MACHINEGUN_VIEW_LENGTH / MACHINEGUN_NATIVE_LENGTH,
  offset: { x: 0, y: -0.035, z: 0.134 },
};

// Ground pickup props (replacing pickupMeshes.js's placeholder boxes): a
// *real-world*-scale target, not a camera-relative viewmodel one, since
// these sit in the world at arm's length instead of fixed in front of the
// camera. pickupMeshes.js positions each by its own measured bounding-box
// *bottom*, not its origin -- these packs centre their meshes near the
// geometric middle, not the base, so a floor placement needs a ground
// offset the same way MACHINEGUN_MODEL's viewmodel offset needed a
// recentring one above.
//
// Measured the same way as BOT_MODEL/MACHINEGUN_MODEL above:
// load the model, `new THREE.Box3().setFromObject(scene)`, read size/
// centre/min. Grenade native bbox: size (0.1785, 0.3033, 0.1447), centre
// (-0.0036, -0.0039, ~0), min.y -0.1556 -- authored standing upright on its
// long (Y) axis, origin near centre, not base.
const GRENADE_NATIVE_HEIGHT = 0.3033;
// A real fragmentation grenade (e.g. M67) stands roughly 9-14cm tall
// including the safety lever -- about a ninth of a person's height.
// Calibrated off this file's own HUMANOID_RENDER_HEIGHT rather than a raw
// guess; this scifi-styled grenade reads a little chunkier, landing near the
// top of that real-world range.
const GRENADE_RENDER_HEIGHT = HUMANOID_RENDER_HEIGHT / 9; // ~0.178m

export const GRENADE_MODEL = {
  path: 'assets/props/grenade.glb',
  scale: GRENADE_RENDER_HEIGHT / GRENADE_NATIVE_HEIGHT,
  // offset.x/z = -centre*scale recentres the model over the pickup point;
  // offset.y = -min.y*scale lifts its lowest vertex (not its near-centre
  // origin) to the floor. Computed from the measured bbox above, not
  // eyeballed -- same approach as MACHINEGUN_MODEL's own offset comment.
  offset: { x: 0.002, y: 0.091, z: 0 },
};

// U5: calm-horizon equirectangular sky (KTD5), used by scene.js as
// scene.background via loadSkyBackground. 2048x1024 -- plenty of resolution
// for a background the player never approaches, at a fraction of the
// source's 8192x4096 file size.
export const SKY_TEXTURE_PATH = 'assets/environment/sky.jpg';

// Panel/composite detail map shared by every arena surface -- walls, floor,
// and pillars all multiply their existing `color` over this one map (KTD6),
// so accent hues survive the pass untouched by construction. `metersPerTile`
// is a scale, not a fixed pixel repeat: arenaMesh.js divides each surface's
// real size by it, so the tiling stays correct even if the arena's
// dimensions ever change.
export const ARENA_SURFACE_TEXTURE = {
  colorPath: 'assets/textures/panel-composite-color.jpg',
  metersPerTile: ARENA_TEXTURE_METERS_PER_TILE,
};
