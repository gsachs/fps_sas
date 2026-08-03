// Resolves entity movement via Rapier's kinematic character controller.
// The controller only resolves collide-and-slide (autostep, snap-to-ground,
// slope limit); velocity, gravity, and jump are integrated here (KTD1).
// Rapier is a physics dependency, not a rendering one, so importing it here
// does not violate the sim module's Three.js-free guard.
import RAPIER from '@dimforge/rapier3d-compat';

const GRAVITY = -9.81;
const JUMP_SPEED = 5;
const MOVE_SPEED = 4;
const CONTROLLER_OFFSET = 0.01;
const CAPSULE_HALF_HEIGHT = 0.5;
const CAPSULE_RADIUS = 0.3;

// Height above the rigid body's origin (its capsule center, not its feet)
// for both the render camera and the hitscan ray -- so shots land exactly
// where the crosshair appears to point.
export const EYE_HEIGHT = 0.6;

export function createMovementSystem(rapierWorld) {
  const controller = rapierWorld.createCharacterController(CONTROLLER_OFFSET);
  controller.enableAutostep(0.3, 0.1, true);
  controller.enableSnapToGround(0.2);
  controller.setMaxSlopeClimbAngle((60 * Math.PI) / 180);

  const characters = new Map(); // entityId -> { rigidBody, collider, verticalVelocity, grounded }
  const entityIdByColliderHandle = new Map(); // collider.handle -> entityId, for hit-to-entity lookup

  function addCharacter(entityId, position) {
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      position.x,
      position.y,
      position.z
    );
    const rigidBody = rapierWorld.createRigidBody(bodyDesc);
    const collider = rapierWorld.createCollider(
      RAPIER.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS),
      rigidBody
    );
    characters.set(entityId, { rigidBody, collider, verticalVelocity: 0, grounded: false });
    entityIdByColliderHandle.set(collider.handle, entityId);
  }

  function getCollider(entityId) {
    return characters.get(entityId)?.collider;
  }

  function getEntityIdForCollider(collider) {
    return entityIdByColliderHandle.get(collider.handle);
  }

  // Mutates entity.position in place; does not commit the physics world
  // (see commit()) so multiple characters resolve against consistent
  // per-tick state before Rapier advances them together.
  function resolveMovement(entity, command, dt) {
    const state = characters.get(entity.id);
    if (!state) return;

    const yaw = command.yaw;
    const forward = { x: Math.sin(yaw), z: Math.cos(yaw) };
    const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    const moveX = forward.x * command.moveZ + right.x * command.moveX;
    const moveZ = forward.z * command.moveZ + right.z * command.moveX;

    if (state.grounded && command.buttons.jump) {
      state.verticalVelocity = JUMP_SPEED;
    } else {
      state.verticalVelocity += GRAVITY * dt;
    }

    const desired = {
      x: moveX * MOVE_SPEED * dt,
      y: state.verticalVelocity * dt,
      z: moveZ * MOVE_SPEED * dt,
    };

    controller.computeColliderMovement(state.collider, desired);
    const movement = controller.computedMovement();
    state.grounded = controller.computedGrounded();
    if (state.grounded && state.verticalVelocity < 0) state.verticalVelocity = 0;

    const pos = state.rigidBody.translation();
    const next = { x: pos.x + movement.x, y: pos.y + movement.y, z: pos.z + movement.z };
    state.rigidBody.setNextKinematicTranslation(next);

    entity.position.x = next.x;
    entity.position.y = next.y;
    entity.position.z = next.z;
  }

  function teleport(entityId, position) {
    const state = characters.get(entityId);
    if (!state) return;
    state.rigidBody.setTranslation(position, true);
    state.verticalVelocity = 0;
    state.grounded = false;
  }

  // Advances Rapier once per tick, after every character's next kinematic
  // translation has been set -- not per-entity, so same-tick collisions
  // between characters resolve against consistent state.
  function commit() {
    rapierWorld.step();
  }

  return { addCharacter, resolveMovement, teleport, commit, controller, getCollider, getEntityIdForCollider };
}
