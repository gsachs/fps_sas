// What happens after the last kill: the mothership comes in, its escorts
// settle over the site, and anything still standing gets cleared from the
// air. It is the answer to the brief the player was given at the start --
// hold the site so the landing can come down -- played out instead of
// asserted.
//
// Entirely a cutscene. The simulation has stopped by the time this runs, so
// nothing here is a real kill: no damage is applied, no score changes, no
// collider moves. It reuses the same tracer, impact and body systems the
// match itself uses, so a strike looks like every other kill the player has
// seen, but the match is already decided and this only shows it.
//
// Directed here rather than in main.js because the ordering is the whole
// content -- who fires, at what, in what order, and how long after the last
// one. That is a thing worth reading in one place.

// Long enough for the escorts to be overhead and the mothership to be
// visibly inbound before anything is shot, so the sequence reads as arrival
// first and mop-up second.
const FIRST_STRIKE_DELAY_SECONDS = 3.2;
// Paced like an execution rather than a firefight. One at a time, unhurried.
const STRIKE_INTERVAL_SECONDS = 1.15;
// The bearing the mothership comes in on. Fixed rather than random so the
// shot composes the same way every time.
const MOTHERSHIP_BEARING = Math.PI * 0.72;

function nearest(points, target) {
  let best = null;
  let bestDistance = Infinity;
  for (const point of points) {
    const distance = Math.hypot(point.x - target.x, point.z - target.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  return best;
}

export function createVictorySequence({ mothership, dropships, tracers, impacts, corpses, onDefenderDown }) {
  let running = false;
  let elapsed = 0;
  let struck = 0;
  let pending = [];

  // `survivors` is every defender still standing when the match ended:
  // { id, position, yaw }. Plain data at this boundary (KTD7) -- the director
  // never touches an entity or a mesh, it reports a hit and lets the caller
  // deal with its own bots.
  function begin({ centre, survivors }) {
    running = true;
    elapsed = 0;
    struck = 0;
    // Farthest first, so the camera's own orbit tends to sweep across the
    // strikes rather than watching them all happen in one corner.
    pending = [...survivors].sort(
      (a, b) =>
        Math.hypot(b.position.x - centre.x, b.position.z - centre.z) -
        Math.hypot(a.position.x - centre.x, a.position.z - centre.z)
    );
    mothership.arrive(centre, MOTHERSHIP_BEARING);
    dropships.beginVictoryFlight(centre);
  }

  function strike(defender) {
    // From whichever escort is actually closest; the mothership itself only
    // fires if the escorts have not arrived yet, which is possible on the
    // very first strike.
    const origin = nearest(dropships.escortPositions(), defender.position) ?? mothership.position();
    if (!origin) return;

    const target = { x: defender.position.x, y: defender.position.y + 0.9, z: defender.position.z };
    tracers.spawn(origin, target);
    impacts.spawn(target, 'body');
    corpses.spawn({ position: defender.position, yaw: defender.yaw ?? 0 });
    onDefenderDown(defender.id);
  }

  function update(deltaSeconds) {
    if (!running) return;
    elapsed += deltaSeconds;
    mothership.update(deltaSeconds);

    const due = Math.floor((elapsed - FIRST_STRIKE_DELAY_SECONDS) / STRIKE_INTERVAL_SECONDS) + 1;
    while (struck < pending.length && struck < due) {
      strike(pending[struck]);
      struck += 1;
    }
  }

  function reset() {
    running = false;
    elapsed = 0;
    struck = 0;
    pending = [];
    mothership.reset();
    dropships.endVictoryFlight();
  }

  return { begin, update, reset, isRunning: () => running, remaining: () => pending.length - struck };
}
