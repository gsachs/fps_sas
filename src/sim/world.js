// The entity store and per-tick mutation entry point. Pure and Three.js-free
// so it can run headlessly in tests and, later, authoritatively for
// multiplayer. Movement, combat, and AI resolution are added by later units
// as steps inside step(), not as separate loops -- this stays the one
// mutation path (KTD2).
import { DEFAULT_WEAPON_ID } from './weapon.js';
import { MAX_HEALTH } from './health.js';

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Shortest-path angle interpolation so a yaw wrap (e.g. 179deg -> -179deg)
// doesn't spin the long way around.
function lerpAngle(a, b, t) {
  const twoPi = Math.PI * 2;
  let diff = (b - a) % twoPi;
  diff = ((diff + Math.PI) % twoPi) - Math.PI;
  return a + diff * t;
}

function cloneTransform(entity) {
  return { position: { ...entity.position }, yaw: entity.yaw, pitch: entity.pitch };
}

function createEntity(id, overrides = {}) {
  return {
    id,
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    health: MAX_HEALTH,
    dead: false,
    score: 0,
    animHint: 'idle',
    heldWeapon: DEFAULT_WEAPON_ID, // per-weapon foundation (KTD1): every entity starts on the infinite pistol
    ammo: null, // null means infinite (the pistol); a finite weapon (the machine gun) sets a count
    grenadeCount: 0,
    ...overrides,
  };
}

export function createWorld({ physics, combat, pickups, grenades } = {}) {
  const entities = new Map();
  const prevTransforms = new Map();

  // A minimal entity accessor passed to the injected combat system, so
  // health.js can read/mutate entities without needing a self-reference to
  // the not-yet-constructed world object below.
  const entityAccessor = {
    getEntity: (id) => entities.get(id),
    allEntities: () => Array.from(entities.values()),
  };

  function snapshotPrev() {
    for (const [id, entity] of entities) {
      prevTransforms.set(id, cloneTransform(entity));
    }
  }

  function addEntity(id, overrides) {
    const entity = createEntity(id, overrides);
    entities.set(id, entity);
    prevTransforms.set(id, cloneTransform(entity));
    return entity;
  }

  function getEntity(id) {
    return entities.get(id);
  }

  function allEntities() {
    return Array.from(entities.values());
  }

  function step(commandsByEntityId, dt) {
    snapshotPrev();
    const events = [];
    for (const [id, command] of commandsByEntityId) {
      const entity = entities.get(id);
      if (!entity || entity.dead) continue;

      entity.yaw = command.yaw;
      entity.pitch = command.pitch;

      if (physics) {
        // Rapier character-controller resolution (movement.js); mutates
        // entity.position via collide-and-slide against the arena.
        physics.resolveMovement(entity, command, dt);
      } else {
        // No physics system injected (e.g. plain unit tests): fall back to
        // an unobstructed kinematic placeholder so the seam is still
        // exercisable headlessly without an arena.
        const speed = 4;
        entity.position.x += command.moveX * speed * dt;
        entity.position.z += command.moveZ * speed * dt;
      }

      entity.animHint = command.moveX !== 0 || command.moveZ !== 0 ? 'moving' : 'idle';

      // Collection reads this tick's actual (post-movement) position, and
      // runs before combat so an entity that just picked up the MG this
      // tick can fire it the same tick. Dead/parked entities never reach
      // here at all -- they have no command in commandsByEntityId, or were
      // skipped by the dead-entity guard above -- which is what excludes
      // them from collection "by construction" (KTD7), not a liveness
      // check inside pickups.js itself.
      if (pickups) pickups.tryCollect(entity);

      // Throw reads a different command field (throwGrenade) than combat's
      // fire fields below, so their relative order here doesn't matter
      // (KTD3).
      if (grenades) {
        const thrown = grenades.tryThrow(entity, command);
        if (thrown) events.push({ type: 'grenadeThrown', ...thrown });
      }

      if (combat) {
        const fireResult = combat.resolveFire(entity, command);
        if (fireResult.fired) {
          events.push({
            type: 'fire',
            shooterId: id,
            origin: fireResult.origin,
            endPoint: fireResult.endPoint,
          });
        }
        if (fireResult.hitEntityId) {
          const hitEvent = combat.applyHit(
            entityAccessor,
            fireResult.hitEntityId,
            id,
            fireResult.damage,
            fireResult.weapon
          );
          if (hitEvent) events.push({ type: 'hit', ...hitEvent });
        }
      }
    }
    if (physics) physics.commit();
    if (combat) {
      const occupiedPositions = allEntities()
        .filter((entity) => !entity.dead)
        .map((entity) => entity.position);
      combat.tickRespawns(entityAccessor, occupiedPositions);
    }
    if (pickups) pickups.tick();
    // World-scope, unconditional, same as pickups.tick() above -- every
    // in-flight grenade burns fuse and integrates regardless of which
    // entities had commands this tick. Concatenated into this same step()
    // call's events, not deferred, so a blast's kills are visible to
    // callers (e.g. match-end) in the call that produced them.
    if (grenades) events.push(...grenades.tick(entityAccessor, dt));

    // R13: death strips the carrier's machine gun and ammo -- bot or player,
    // regardless of damage source. Applied once over every 'hit' event this
    // step produced (hitscan, from the per-entity loop above, and blast,
    // from grenades.tick() above) rather than inline per source, so a second
    // damage path can never silently bypass it the way an inline-only
    // version once did. The grenade pocket (grenadeCount) is untouched here,
    // it survives death, and so does the taken pickup's own respawn
    // countdown (KD6): that countdown started the instant the pickup was
    // taken and runs independent of what later happens to the taker, so
    // death must never reach into pickups.js at all, only reset the dying
    // entity's own weapon fields.
    for (const event of events) {
      if (event.type !== 'hit' || !event.killed) continue;
      const target = entityAccessor.getEntity(event.targetId);
      if (target) {
        target.heldWeapon = DEFAULT_WEAPON_ID;
        target.ammo = null;
      }
    }

    return events;
  }

  // Per-entity render state: position/yaw/pitch interpolated between the
  // two most recent sim states by `alpha`, plus `latest` (the current,
  // un-interpolated transform) so the render layer can draw the local
  // player's camera from latest state instead of interpolated state.
  function getRenderState(alpha) {
    const result = [];
    for (const [id, entity] of entities) {
      const prev = prevTransforms.get(id) ?? cloneTransform(entity);
      result.push({
        id,
        position: {
          x: lerp(prev.position.x, entity.position.x, alpha),
          y: lerp(prev.position.y, entity.position.y, alpha),
          z: lerp(prev.position.z, entity.position.z, alpha),
        },
        yaw: lerpAngle(prev.yaw, entity.yaw, alpha),
        pitch: lerp(prev.pitch, entity.pitch, alpha),
        latest: cloneTransform(entity),
        health: entity.health,
        dead: entity.dead,
        animHint: entity.animHint,
        score: entity.score,
        // Armory fields (KTD1): discrete state, not continuous motion, so
        // they pass through as-is rather than lerping like position/yaw.
        heldWeapon: entity.heldWeapon,
        ammo: entity.ammo,
        grenadeCount: entity.grenadeCount,
      });
    }
    return result;
  }

  return { addEntity, getEntity, allEntities, step, getRenderState };
}
