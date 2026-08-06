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
const PISTOL_NATIVE_LENGTH = 2.75;
const PISTOL_VIEW_LENGTH = 0.34; // roughly the placeholder box it replaces, which read at the right size

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

// Gunshot samples. Several, because one sample repeating at this fire rate
// reads as a buzzer rather than a weapon; the player cycles through them.
export const GUNSHOT_PATHS = [
  'assets/audio/gunshot-000.ogg',
  'assets/audio/gunshot-001.ogg',
  'assets/audio/gunshot-002.ogg',
];

// First-person weapon. Static (non-skinned) by requirement: the skinned
// pistol in this pack cannot survive loadPropModel's plain clone, which is
// why the viewmodel stayed a grey box for so long.
export const WEAPON_MODEL = {
  path: 'assets/weapons/quaternius-pistol-static.glb',
  scale: PISTOL_VIEW_LENGTH / PISTOL_NATIVE_LENGTH,
  // The model's geometry sits off its own origin; this recentres it on the
  // weapon group so recoil pivots around the weapon rather than swinging it.
  // weaponView treats this z as the rest position and animates recoil on top.
  offset: { x: 0, y: -0.027, z: 0.112 },
};

// Panel/composite detail map shared by every arena surface -- walls, floor,
// and pillars all multiply their existing `color` over this one map (KTD6),
// so accent hues survive the pass untouched by construction. `metersPerTile`
// is a scale, not a fixed pixel repeat: arenaMesh.js divides each surface's
// real size by it, so the tiling stays correct even if the arena's
// dimensions ever change.
export const ARENA_SURFACE_TEXTURE = {
  colorPath: 'assets/textures/panel-metal-color.jpg',
  metersPerTile: ARENA_TEXTURE_METERS_PER_TILE,
};
