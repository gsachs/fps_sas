import * as THREE from 'three';
import { ROOM_ACCENTS, NEUTRAL_ACCENT_COLOR, findRoomAt } from '../arena/layout.js';

// Low-poly meshes matching the arena's Rapier colliders (ground, walls,
// landmark pillars); callers add the returned group to their scene. Walls
// and pillars are built straight off arena.walls/arena.pillars (KTD6) --
// one mesh per collider, so mesh count can never drift from collider count
// the way the old fixed-4-wall layout could.
//
// The geometry stays deliberately simple -- box silhouettes are not what
// makes an untextured arena read as unfinished. What sells it as a place is
// shadow, so every surface here participates in shadow casting or receiving,
// and the colours are unchanged from when they were placeholders (R16).

// Wall trim geometry (KTD3, R5/R6). The U1 spike found that trim flush on a
// wall's own face is invisible from a straight corridor -- a sightline
// through an open doorway gap never grazes the jamb, it passes clean through
// to whatever's beyond. Overhanging every room-boundary wall's trim past its
// own footprint (longways past its ends, and outward past its face) means a
// doorway-adjacent segment's trim encroaches into the doorway opening itself,
// which is what actually sits in a corridor sightline. Purely decorative
// (no collider), so the overhang narrows the visual opening slightly without
// narrowing the real passable doorway.
const TRIM_LONG_OVERHANG = 0.5;
const TRIM_THIN_OVERHANG = 0.15;
const TRIM_HALF_HEIGHT = 0.8;
const TRIM_CENTER_Y = 1.6; // roughly standing eye height (movement.js's EYE_HEIGHT + CAPSULE_GROUND_OFFSET)

function buildTrimMesh(wall, material) {
  // A wall's long axis is whichever half-extent is larger -- WALL_THICKNESS
  // (layout.js) is always the thinner of the two for any real wall entry.
  const alongX = wall.halfX > wall.halfZ;
  const halfX = alongX ? wall.halfX + TRIM_LONG_OVERHANG : wall.halfX + TRIM_THIN_OVERHANG;
  const halfZ = alongX ? wall.halfZ + TRIM_THIN_OVERHANG : wall.halfZ + TRIM_LONG_OVERHANG;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(halfX * 2, TRIM_HALF_HEIGHT * 2, halfZ * 2), material);
  mesh.position.set(wall.x, TRIM_CENTER_Y, wall.z);
  mesh.name = 'trim';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildArenaMeshes(arena) {
  const group = new THREE.Group();
  group.name = 'arena';

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(arena.floorHalfSize * 2, arena.floorHalfSize * 2),
    new THREE.MeshStandardMaterial({ color: 0x6b8f5a, roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.name = 'ground';
  // Receives only: a flat plane has nothing to cast onto anything else, and
  // including it as a caster only costs shadow-map resolution.
  ground.receiveShadow = true;
  group.add(ground);

  const wallMaterial = new THREE.MeshStandardMaterial({ color: NEUTRAL_ACCENT_COLOR, roughness: 0.9 });
  const accentMaterials = new Map(); // KTD3: one material per accented room, reused across its walls/pillars/trim
  function accentMaterialFor(roomId) {
    const hue = ROOM_ACCENTS[roomId];
    if (hue === undefined) return null;
    if (!accentMaterials.has(roomId)) {
      accentMaterials.set(roomId, new THREE.MeshStandardMaterial({ color: hue, roughness: 0.85 }));
    }
    return accentMaterials.get(roomId);
  }

  for (const wall of arena.walls) {
    const material = accentMaterialFor(wall.spaceId) || wallMaterial;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(wall.halfX * 2, wall.halfY * 2, wall.halfZ * 2),
      material
    );
    mesh.position.set(wall.x, wall.halfY, wall.z);
    mesh.name = 'wall';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    if (accentMaterials.has(wall.spaceId)) {
      group.add(buildTrimMesh(wall, material));
    }
  }

  const pillarMaterial = new THREE.MeshStandardMaterial({ color: 0x8a6a4f, roughness: 0.85 });
  for (const pillar of arena.pillars) {
    const owner = findRoomAt(pillar, arena.rooms);
    const material = (owner && accentMaterialFor(owner.id)) || pillarMaterial;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(pillar.halfX * 2, pillar.halfY * 2, pillar.halfZ * 2),
      material
    );
    mesh.position.set(pillar.x, pillar.halfY, pillar.z);
    mesh.name = 'pillar';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  return group;
}
