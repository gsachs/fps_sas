// The sim's first projectile (KTD3): a grenade is a hand-integrated
// ballistic point -- sim-owned position and velocity, gravity reused from
// the movement system, no dynamic Rapier body and no collider of its own.
// Wall contact is a swept raycast per tick, not continuous physics, so
// tunneling correctness comes from the sweep spanning the whole
// previous-to-next segment every tick, not from bounding the throw speed.
// The blast that follows a fuse (KTD4) is a pure world-scope query: 3D
// distance plus line-of-sight from the blast center, evaluated uniformly
// against every entity in the store, so the thrower, the dead, and parked
// bots all fall out of the same loop instead of special-cased branches.
import RAPIER from '@dimforge/rapier3d-compat';
import { GRAVITY, EYE_HEIGHT } from './movement.js';
import { hasLineOfSightFromBlastCenter } from './lineOfSight.js';

// Placeholder constants (U6 tunes these against real play) -- chosen here
// only to be clearly distinguishable from one another and to make this
// unit's own arc/fuse/blast tests legible, not balanced.
export const GRENADE_THROW_SPEED = 16; // units/sec
// Added to entity.pitch before the throw direction is built -- mirrors
// weapon.js's spread jitter (bias the input angle, never the already-built
// direction vector) -- so a level throw still arcs upward instead of flying
// flat into whatever's directly ahead.
export const GRENADE_PITCH_UPWARD_BIAS_RADIANS = 0.35;
export const GRENADE_FUSE_TICKS = 120; // 2s at a 60Hz tick rate
export const BLAST_RADIUS = 8; // units
export const BLAST_MAX_DAMAGE = 100;

// A landed grenade backs off the wall it hit by this much so it visually
// rests just short of the surface instead of clipping into it.
const LANDING_BACKOFF = 0.05;

let nextGrenadeId = 0;

// movementSystem is read-only here (getCollider lookups only) -- grenades.js
// still registers no Rapier body or collider of its own (KTD3). It's needed
// because EYE_HEIGHT (the throw origin) sits inside the thrower's own
// capsule (radius 0.4, half-height 0.5, centered on entity.position): the
// very first swept ray of a throw would otherwise immediately self-hit the
// thrower and land the grenade at their own feet -- the exact bug
// weapon.js's shooterCollider exclusion already exists to prevent for
// hitscan, reused here the same way.
export function createGrenadeSystem({ rapierWorld, healthSystem, movementSystem }) {
  // grenadeId -> { id, ownerId, position, velocity, fuseTicksRemaining, landed }
  const inFlight = new Map();

  // Consumes command.buttons.throwGrenade (the edge, already latched by the
  // sampler) and one pocket count; returns { throwerId, origin, velocity }
  // for world.js's grenadeThrown event, or null when nothing was thrown
  // this tick (no edge, or an empty pocket -- both are silent no-ops, not
  // errors).
  function tryThrow(entity, command) {
    if (!command.buttons.throwGrenade) return null;
    if (!(entity.grenadeCount > 0)) return null;

    entity.grenadeCount -= 1;

    // The verified yaw/pitch basis (weapon.js's hitscan direction formula),
    // reused unchanged -- only the pitch fed into it is biased upward
    // first, the same way weapon.js jitters yaw/pitch before building this
    // exact same direction vector for a shot.
    const throwPitch = entity.pitch + GRENADE_PITCH_UPWARD_BIAS_RADIANS;
    const direction = {
      x: Math.sin(entity.yaw) * Math.cos(throwPitch),
      y: Math.sin(throwPitch),
      z: Math.cos(entity.yaw) * Math.cos(throwPitch),
    };
    const origin = { x: entity.position.x, y: entity.position.y + EYE_HEIGHT, z: entity.position.z };
    const velocity = {
      x: direction.x * GRENADE_THROW_SPEED,
      y: direction.y * GRENADE_THROW_SPEED,
      z: direction.z * GRENADE_THROW_SPEED,
    };

    const id = `grenade${nextGrenadeId++}`;
    inFlight.set(id, {
      id,
      ownerId: entity.id,
      position: { ...origin },
      velocity,
      fuseTicksRemaining: GRENADE_FUSE_TICKS,
      landed: false,
    });

    return { throwerId: entity.id, origin, velocity };
  }

  // Applies the blast at grenade.position: every entity within BLAST_RADIUS
  // that also has line of sight to the blast center takes linear-falloff
  // damage -- the thrower included, with no special case, since it's just
  // another entry in allEntities(). Returns this blast's events (one 'hit'
  // per damaged entity, plus one 'explosion').
  function detonate(grenade, entityAccessor) {
    const blastEvents = [];
    for (const entity of entityAccessor.allEntities()) {
      const distance = Math.hypot(
        entity.position.x - grenade.position.x,
        entity.position.y - grenade.position.y,
        entity.position.z - grenade.position.z
      );
      if (distance > BLAST_RADIUS) continue;
      if (!hasLineOfSightFromBlastCenter(rapierWorld, grenade.position, entity.position)) continue;

      const damage = Math.max(BLAST_MAX_DAMAGE * (1 - distance / BLAST_RADIUS), 0);
      const hitEvent = healthSystem.applyHit(entityAccessor, entity.id, grenade.ownerId, damage, 'grenade');
      if (hitEvent) {
        // R11: damage-direction feedback for a blast points at the blast
        // center, never at the thrower's live position -- applyHit only
        // ever knows the shooter's own position, so this overrides the
        // returned event's damageOrigin rather than changing health.js's
        // signature.
        blastEvents.push({ type: 'hit', ...hitEvent, damageOrigin: { ...grenade.position } });
      }
    }
    blastEvents.push({ type: 'explosion', position: { ...grenade.position } });
    return blastEvents;
  }

  // Advances every in-flight grenade by one tick. Call once per
  // world.step(), unconditionally -- world scope, not per-entity, mirroring
  // pickups.tick()/combat.tickRespawns. Every grenade burns its fuse this
  // call, landed or not; a paused sim (one that simply never calls tick())
  // burns none, by construction. A still-flying grenade also integrates:
  // gravity applied to velocity.y first, then a swept raycast from its
  // current position to the resulting candidate position detects wall
  // contact across the whole segment, so tunneling can't hide between
  // ticks regardless of throw speed.
  function tick(entityAccessor, dt) {
    const events = [];
    for (const [id, grenade] of inFlight) {
      if (!grenade.landed) {
        grenade.velocity.y += GRAVITY * dt;
        const candidate = {
          x: grenade.position.x + grenade.velocity.x * dt,
          y: grenade.position.y + grenade.velocity.y * dt,
          z: grenade.position.z + grenade.velocity.z * dt,
        };
        const segment = {
          x: candidate.x - grenade.position.x,
          y: candidate.y - grenade.position.y,
          z: candidate.z - grenade.position.z,
        };
        const segmentDistance = Math.hypot(segment.x, segment.y, segment.z);

        if (segmentDistance > 1e-9) {
          const rayDirection = {
            x: segment.x / segmentDistance,
            y: segment.y / segmentDistance,
            z: segment.z / segmentDistance,
          };
          const ownerCollider = movementSystem?.getCollider(grenade.ownerId);
          const hit = rapierWorld.castRay(
            new RAPIER.Ray(grenade.position, rayDirection),
            segmentDistance,
            true,
            undefined,
            undefined,
            ownerCollider
          );
          // A character capsule is not "wall contact" -- only world geometry
          // (no entry in movementSystem's collider->entity map) stops the
          // arc. Passing through a body just continues the sweep to this
          // tick's candidate position rather than latching landed there.
          const hitEntityId = hit && movementSystem?.getEntityIdForCollider(hit.collider);
          if (hit && hitEntityId === undefined) {
            const contactDistance = Math.max(hit.timeOfImpact - LANDING_BACKOFF, 0);
            grenade.position = {
              x: grenade.position.x + rayDirection.x * contactDistance,
              y: grenade.position.y + rayDirection.y * contactDistance,
              z: grenade.position.z + rayDirection.z * contactDistance,
            };
            grenade.velocity = { x: 0, y: 0, z: 0 };
            grenade.landed = true;
          } else {
            grenade.position = candidate;
          }
        }
      }

      grenade.fuseTicksRemaining -= 1;
      if (grenade.fuseTicksRemaining <= 0) {
        events.push(...detonate(grenade, entityAccessor));
        inFlight.delete(id); // cleared -- blast applied once, never revisited
      }
    }
    return events;
  }

  // Read-only inspection for render (U5) and tests -- copies, not the live
  // records, so a caller mutating the result can't corrupt in-flight state.
  function getInFlightGrenades() {
    return Array.from(inFlight.values()).map((grenade) => ({
      ...grenade,
      position: { ...grenade.position },
      velocity: { ...grenade.velocity },
    }));
  }

  // Match reset's explicit clear hook (R8, KTD5): every in-flight grenade
  // and its pending blast vanish with no detonation. grenadeCount itself is
  // untouched here -- U3's reset loop already zeroes it; this is only the
  // projectiles.
  function resetAll() {
    inFlight.clear();
  }

  return { tryThrow, tick, getInFlightGrenades, resetAll };
}
