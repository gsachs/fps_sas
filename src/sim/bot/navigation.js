// Bot navigation (KTD1, KTD2): a layer above steering, never a change to
// it. This module only ever produces the next locally-reachable subgoal
// position for a bot to seek toward; src/sim/bot/steering.js's seek and
// avoidObstacles turn that into an actual move direction, unchanged. Pure
// graph math and position bookkeeping only -- no Rapier, no Three.js (the
// sim purity guard covers the latter automatically).
import { ROOMS, DOORWAYS } from '../../arena/layout.js';

const ARRIVAL_RADIUS = 1.5;
// A bot genuinely blocked at a doorway (KTD9's two-bots-one-doorway case)
// sits near-motionless tick after tick; a bot merely navigating normally
// never does. ~0.75s at 60Hz before concluding "blocked", not "slow".
const STUCK_EPS = 0.01;
const STUCK_TICKS_BEFORE_REPATH = 45;

export function edgeKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// Builds the waypoint graph from the map's own room/doorway data (KTD2)
// rather than a second, hand-typed edge list that could drift from it.
// Every room is a hub connected only to its own doorways (no diagonal
// shortcut through the room that skips its centre); every doorway on the
// same corridor or spoke is mutually reachable directly, since that space
// is one open, convex room-free area.
export function buildGraph(rooms, doorways) {
  const nodes = new Map();
  // A room's nav point is usually its geometric centre, unless that centre
  // is occupied by landmark geometry a bot can't stand inside of
  // (layout.js's navPoint override) -- see layout.js's NAV_POINT_OVERRIDES.
  for (const r of rooms) {
    const point = r.navPoint ?? { x: r.x, z: r.z };
    nodes.set(r.id, { id: r.id, x: point.x, z: point.z });
  }
  for (const d of doorways) nodes.set(d.id, { id: d.id, x: d.x, z: d.z });

  const edges = new Map();
  function addEdge(a, b) {
    if (a === b) return;
    const dist = Math.hypot(nodes.get(a).x - nodes.get(b).x, nodes.get(a).z - nodes.get(b).z);
    if (!edges.has(a)) edges.set(a, new Map());
    if (!edges.has(b)) edges.set(b, new Map());
    edges.get(a).set(b, dist);
    edges.get(b).set(a, dist);
  }

  const roomIds = new Set(rooms.map((r) => r.id));
  const doorwaysBySpace = new Map(); // non-room space id -> doorway ids on it
  for (const d of doorways) {
    for (const spaceId of d.connects) {
      if (roomIds.has(spaceId)) {
        addEdge(spaceId, d.id);
      } else {
        if (!doorwaysBySpace.has(spaceId)) doorwaysBySpace.set(spaceId, []);
        doorwaysBySpace.get(spaceId).push(d.id);
      }
    }
  }
  for (const doorwayIds of doorwaysBySpace.values()) {
    for (let i = 0; i < doorwayIds.length; i++) {
      for (let j = i + 1; j < doorwayIds.length; j++) addEdge(doorwayIds[i], doorwayIds[j]);
    }
  }

  return { nodes, edges };
}

export const GRAPH = buildGraph(ROOMS, DOORWAYS);
export const ROOM_IDS = ROOMS.map((r) => r.id);

function neighborsOf(graph, nodeId, blockedEdges) {
  const all = graph.edges.get(nodeId) ?? new Map();
  if (blockedEdges.size === 0) return all;
  const open = new Map();
  for (const [neighborId, dist] of all) {
    if (!blockedEdges.has(edgeKey(nodeId, neighborId))) open.set(neighborId, dist);
  }
  return open;
}

function heuristic(graph, a, b) {
  const na = graph.nodes.get(a);
  const nb = graph.nodes.get(b);
  return Math.hypot(na.x - nb.x, na.z - nb.z);
}

// A* over the waypoint graph, optionally excluding a set of blocked edges
// (KTD9's repath). Throws on an unreachable goal rather than returning null
// (Core Invariant) -- every room in the shipped graph is reachable from
// every other, so this only fires for a genuine misconfiguration or a
// repath that has excluded every route.
export function findPath(graph, startId, goalId, blockedEdges = new Set()) {
  if (!graph.nodes.has(startId)) throw new Error(`findPath: unknown start node "${startId}"`);
  if (!graph.nodes.has(goalId)) throw new Error(`findPath: unknown goal node "${goalId}"`);

  const open = new Set([startId]);
  const cameFrom = new Map();
  const gScore = new Map([[startId, 0]]);
  const fScore = new Map([[startId, heuristic(graph, startId, goalId)]]);

  while (open.size > 0) {
    let current = null;
    let bestF = Infinity;
    for (const id of open) {
      const f = fScore.get(id) ?? Infinity;
      if (f < bestF) {
        bestF = f;
        current = id;
      }
    }
    if (current === goalId) {
      const path = [current];
      while (cameFrom.has(path[0])) path.unshift(cameFrom.get(path[0]));
      return path.map((id) => graph.nodes.get(id));
    }
    open.delete(current);
    for (const [neighborId, dist] of neighborsOf(graph, current, blockedEdges)) {
      const tentativeG = gScore.get(current) + dist;
      if (tentativeG < (gScore.get(neighborId) ?? Infinity)) {
        cameFrom.set(neighborId, current);
        gScore.set(neighborId, tentativeG);
        fScore.set(neighborId, tentativeG + heuristic(graph, neighborId, goalId));
        open.add(neighborId);
      }
    }
  }
  throw new Error(`findPath: no path from "${startId}" to "${goalId}"`);
}

export function nearestNodeId(graph, position) {
  let bestId = null;
  let bestDist = Infinity;
  for (const node of graph.nodes.values()) {
    const d = Math.hypot(node.x - position.x, node.z - position.z);
    if (d < bestDist) {
      bestDist = d;
      bestId = node.id;
    }
  }
  return bestId;
}

// Mutable path-follower: advances to the next node once within arrival
// radius; isDone becomes true once the final node has also been reached.
export function createPathFollower(path) {
  let index = 0;
  let lastPosition = null;
  return {
    subgoal: () => path[index],
    // The edge currently being walked -- degenerates to [path[0], path[0]]
    // before the first advance, which is never a real graph edge and so is
    // harmless if ever passed to a blocked-edge check.
    currentEdge: () => [path[Math.max(index - 1, 0)].id, path[index].id],
    isDone: () => index >= path.length - 1 && lastPosition !== null && withinArrival(path[index], lastPosition),
    advanceIfArrived(position) {
      lastPosition = position;
      while (index < path.length - 1 && withinArrival(path[index], position)) index += 1;
    },
  };

  function withinArrival(node, position) {
    return Math.hypot(node.x - position.x, node.z - position.z) <= ARRIVAL_RADIUS;
  }
}

// Stateful wrapper (mirrors fsm.js's pure-core/stateful-wrapper split):
// owns one bot's current path and blocked-edge memory across ticks. tick()
// returns the next subgoal position for the caller to seek toward -- it
// never calls seek/avoidObstacles itself (KTD1).
export function createNavigator({ graph = GRAPH } = {}) {
  let goalId = null;
  let goalPoint = null; // optional exact point beyond goalId (search's last-seen point)
  let follower = null;
  const blockedEdges = new Set();
  let lastPosition = null;
  let stuckTicks = 0;

  function planPath(fromPosition) {
    const startId = nearestNodeId(graph, fromPosition);
    const nodePath = findPath(graph, startId, goalId, blockedEdges);
    const path = goalPoint ? [...nodePath, { id: '__exact-goal__', x: goalPoint.x, z: goalPoint.z }] : nodePath;
    follower = createPathFollower(path);
    stuckTicks = 0;
    lastPosition = null;
  }

  // blockedEdges is cleared on every fresh goal, not just on reset(): it
  // exists to route around contention encountered *while pursuing this one
  // journey* (KTD9), not as a permanent map edit. A doorway jammed on a
  // bot's last trip through a room may well be clear by its next one --
  // without this, a bot whose lifetime happens to hit stuck-repaths at both
  // of a room's doorways (on two unrelated later trips) would exclude every
  // edge out of that room and crash the next path search through it.
  function navigateTo(newGoalId, fromPosition) {
    goalId = newGoalId;
    goalPoint = null;
    blockedEdges.clear();
    planPath(fromPosition);
  }

  // Like navigateTo, but the destination is an arbitrary point (e.g. a
  // last-seen sighting) rather than a graph node: routes to the nearest
  // node to that point, then one final direct leg to the exact point.
  function navigateToPoint(point, fromPosition) {
    goalId = nearestNodeId(graph, point);
    goalPoint = point;
    blockedEdges.clear();
    planPath(fromPosition);
  }

  // Abandons the current path. isDone() reads true afterward, so the next
  // caller (patrol or search) picks a fresh goal instead of continuing a
  // route computed from a now-stale position (KTD5: death/match-reset).
  function reset() {
    goalId = null;
    goalPoint = null;
    follower = null;
    blockedEdges.clear();
    lastPosition = null;
    stuckTicks = 0;
  }

  function tick(position) {
    if (!follower) throw new Error('createNavigator: call navigateTo before tick');

    if (lastPosition) {
      const displacement = Math.hypot(position.x - lastPosition.x, position.z - lastPosition.z);
      stuckTicks = displacement < STUCK_EPS ? stuckTicks + 1 : 0;
    }
    // A snapshot, not a reference: callers commonly pass a mutable
    // entity.position that a movement system updates in place tick to
    // tick -- storing the reference itself would compare that object
    // against its own later-mutated self and always read zero displacement.
    lastPosition = { x: position.x, z: position.z };

    if (stuckTicks >= STUCK_TICKS_BEFORE_REPATH && !follower.isDone()) {
      blockedEdges.add(edgeKey(...follower.currentEdge()));
      try {
        planPath(position);
      } catch {
        // Blocking that edge left no route to the goal from here (only
        // possible if this journey has already accumulated more than one
        // blocked edge around the same room). Rather than let a real map
        // configuration error and "every alternate route happens to be
        // contested right now" crash the bot identically, give up on
        // avoiding prior contention and replan the direct way -- the map
        // itself is always fully connected (R3), so this always succeeds.
        blockedEdges.clear();
        planPath(position);
      }
    }

    follower.advanceIfArrived(position);
    return { subgoalPosition: follower.subgoal(), arrived: follower.isDone() };
  }

  return { navigateTo, navigateToPoint, tick, reset, isDone: () => follower?.isDone() ?? true };
}

// Picks the least-recently-visited room so patrolling bots spread across
// the map instead of converging on whichever room a naive rule favors (R7).
export function createPatrolPicker(roomIds) {
  const lastVisitedTick = new Map(roomIds.map((id) => [id, -Infinity]));
  return {
    pickNext(currentRoomId, tick) {
      let bestId = null;
      let bestTick = Infinity;
      for (const id of roomIds) {
        if (id === currentRoomId) continue;
        const visitedAt = lastVisitedTick.get(id);
        if (visitedAt < bestTick) {
          bestTick = visitedAt;
          bestId = id;
        }
      }
      lastVisitedTick.set(bestId, tick);
      return bestId;
    },
  };
}
