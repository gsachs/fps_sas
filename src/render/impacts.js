import * as THREE from 'three';

// What a shot looks like where it lands. Without this a bullet that hits a
// wall and one that hits nothing at all look identical, so the player has no
// way to correct their aim except by watching a health bar that only moves
// on the shots that already worked.
//
// A spark burst rather than a decal: the simulation resolves hitscans with
// castRay, which yields a hit position but no surface normal, and a decal
// with no normal cannot be laid flat against the wall it is supposed to mark.
// Sparks are also transient, so they cannot accumulate the way decals would.
const IMPACT_LIFETIME_SECONDS = 0.18;
const START_RADIUS = 0.04;
const END_RADIUS = 0.2;
// Every entity now holds the held-fire machine gun (weapon.js), so a firing
// entity lands ~30 shots/second rather than the retired pistol's ~1.3, and
// an unbounded pool would grow without limit during a busy fight. Oldest is
// recycled rather than dropping the new one, since the newest impact is the
// one the player is looking at -- but recycling a spark before it has lived
// out IMPACT_LIFETIME_SECONDS pops it off the wall early, so the cap has to
// clear the peak concurrent count. The player plus two or three bots in
// earshot land roughly 120 shots/second, which over a 0.18s life is about
// 22 alive at once; 48 keeps headroom for a heavier fight.
export const MAX_ACTIVE_IMPACTS = 48;

const IMPACT_COLORS = {
  surface: 0xffd9a0,
  body: 0xff6a4a,
};

// Shared for the same reason the tracer beam is: impacts spawn as often as
// shots do, and per-impact geometry is what stops renderer.info.memory from
// plateauing over a long match.
const SPARK_GEOMETRY = new THREE.IcosahedronGeometry(1, 0);

// Which shooters landed a shot on someone this tick. The simulation pushes a
// 'fire' event and then, for the same shooter in the same tick, a 'hit' event
// when that shot connected -- so a shooter present in both is a shooter whose
// shot landed. Derived here in the render layer rather than asking the
// simulation to label its own events, which would be a sim change for a
// purely cosmetic distinction. Pure, so it is testable without a renderer.
export function shooterIdsThatHit(events) {
  const hits = new Set();
  for (const event of events) {
    if (event.type === 'hit' && event.shooterId) hits.add(event.shooterId);
  }
  return hits;
}

export function createImpactSystem(scene) {
  const active = [];

  function retire(index) {
    const entry = active[index];
    scene.remove(entry.spark);
    entry.spark.material.dispose(); // geometry is shared; see SPARK_GEOMETRY
    active.splice(index, 1);
  }

  function spawn(point, kind = 'surface') {
    if (active.length >= MAX_ACTIVE_IMPACTS) retire(0);

    const material = new THREE.MeshBasicMaterial({
      color: IMPACT_COLORS[kind] ?? IMPACT_COLORS.surface,
      transparent: true,
      depthWrite: false,
    });
    const spark = new THREE.Mesh(SPARK_GEOMETRY, material);
    spark.position.set(point.x, point.y, point.z);
    spark.scale.setScalar(START_RADIUS);
    scene.add(spark);
    active.push({ spark, remaining: IMPACT_LIFETIME_SECONDS });
  }

  function update(deltaSeconds) {
    for (let i = active.length - 1; i >= 0; i--) {
      const entry = active[i];
      entry.remaining -= deltaSeconds;
      if (entry.remaining <= 0) {
        retire(i);
        continue;
      }
      // Expand while fading, so the burst reads as a flash of debris rather
      // than a shrinking dot.
      const elapsed = 1 - entry.remaining / IMPACT_LIFETIME_SECONDS;
      entry.spark.scale.setScalar(START_RADIUS + (END_RADIUS - START_RADIUS) * elapsed);
      entry.spark.material.opacity = 1 - elapsed;
    }
  }

  return { spawn, update };
}
