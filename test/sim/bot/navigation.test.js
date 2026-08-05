import { describe, expect, it } from 'vitest';
import {
  buildGraph,
  findPath,
  nearestNodeId,
  createPathFollower,
  createNavigator,
  createPatrolPicker,
  GRAPH,
  ROOM_IDS,
  edgeKey,
} from '../../../src/sim/bot/navigation.js';

describe('buildGraph', () => {
  it('connects a room only to its own doorways and doorways on the same corridor to each other', () => {
    const rooms = [
      { id: 'a', x: -10, z: 0 },
      { id: 'b', x: 10, z: 0 },
    ];
    const doorways = [
      { id: 'a-door', x: -2, z: 0, connects: ['a', 'corridor'] },
      { id: 'b-door', x: 2, z: 0, connects: ['b', 'corridor'] },
    ];
    const graph = buildGraph(rooms, doorways);

    expect([...graph.edges.get('a').keys()]).toEqual(['a-door']);
    expect([...graph.edges.get('b').keys()]).toEqual(['b-door']);
    expect(graph.edges.get('a-door').has('b-door')).toBe(true); // same corridor -> mutual edge
  });
});

describe('findPath', () => {
  it('returns the shortest room sequence between any two rooms in the shipped graph', () => {
    const path = findPath(GRAPH, 'nw', 'se');
    expect(path[0].id).toBe('nw');
    expect(path[path.length - 1].id).toBe('se');
    // nw and se are diagonally opposite: the shortest route must pass
    // through the graph, never teleport directly between unconnected rooms.
    expect(path.length).toBeGreaterThan(2);
  });

  it('covers R6: every room reaches every other room in the shipped graph', () => {
    // The single nw->se check above only proves one diagonal pair; buildGraph
    // derives edges algorithmically from layout.js's doorway `connects` data,
    // so a bug there (a doorway pointing at the wrong corridor id, a room
    // dropped from a spoke) could leave some other room unreachable from
    // most others while nw->se still happens to succeed via the outer loop.
    for (const startId of ROOM_IDS) {
      for (const goalId of ROOM_IDS) {
        if (startId === goalId) continue;
        expect(() => findPath(GRAPH, startId, goalId)).not.toThrow();
      }
    }
  });

  it('prefers a shorter direct route over a longer detour', () => {
    const rooms = [
      { id: 'a', x: 0, z: 0 },
      { id: 'b', x: 100, z: 0 },
      { id: 'c', x: 50, z: 50 },
    ];
    const doorways = [
      { id: 'ab', x: 50, z: 0, connects: ['a', 'b'] }, // pretend direct corridor, short
      { id: 'ac', x: 25, z: 25, connects: ['a', 'c'] },
      { id: 'cb', x: 75, z: 25, connects: ['c', 'b'] },
    ];
    const graph = buildGraph(rooms, doorways);
    const path = findPath(graph, 'a', 'b');
    expect(path.map((n) => n.id)).toEqual(['a', 'ab', 'b']);
  });

  it('throws rather than returning null when no path exists', () => {
    const graph = buildGraph(
      [
        { id: 'island-a', x: 0, z: 0 },
        { id: 'island-b', x: 1000, z: 1000 },
      ],
      []
    );
    expect(() => findPath(graph, 'island-a', 'island-b')).toThrow();
  });

  it('throws on an unknown start or goal id', () => {
    expect(() => findPath(GRAPH, 'not-a-node', 'nw')).toThrow();
    expect(() => findPath(GRAPH, 'nw', 'not-a-node')).toThrow();
  });
});

describe('nearestNodeId', () => {
  it('finds the closest node to an arbitrary position', () => {
    const nwRoomCenter = GRAPH.nodes.get('nw');
    expect(nearestNodeId(GRAPH, { x: nwRoomCenter.x + 0.1, z: nwRoomCenter.z - 0.1 })).toBe('nw');
  });
});

describe('createPathFollower', () => {
  const path = [
    { id: 'start', x: 0, z: 0 },
    { id: 'mid', x: 10, z: 0 },
    { id: 'end', x: 20, z: 0 },
  ];

  it('advances the subgoal once within arrival radius, and not before', () => {
    const follower = createPathFollower(path);
    follower.advanceIfArrived({ x: 0, z: 0 });
    expect(follower.subgoal().id).toBe('mid'); // path[0] is the start position itself -- skipped immediately

    follower.advanceIfArrived({ x: 5, z: 0 }); // halfway to mid, not yet arrived
    expect(follower.subgoal().id).toBe('mid');

    follower.advanceIfArrived({ x: 10, z: 0 }); // arrived at mid
    expect(follower.subgoal().id).toBe('end');
  });

  it('is done only once the final node has actually been reached', () => {
    const follower = createPathFollower(path);
    follower.advanceIfArrived({ x: 0, z: 0 });
    follower.advanceIfArrived({ x: 10, z: 0 });
    expect(follower.isDone()).toBe(false); // at "mid", not "end" yet

    follower.advanceIfArrived({ x: 20, z: 0 });
    expect(follower.isDone()).toBe(true);
  });
});

describe('createPatrolPicker', () => {
  it('never picks the current room', () => {
    const picker = createPatrolPicker(['a', 'b', 'c']);
    for (let tick = 0; tick < 10; tick++) {
      expect(picker.pickNext('a', tick)).not.toBe('a');
    }
  });

  it('rotates across every room before repeating', () => {
    const roomIds = ['a', 'b', 'c', 'd'];
    const picker = createPatrolPicker(roomIds);
    const picks = [];
    let current = null;
    for (let tick = 0; tick < roomIds.length; tick++) {
      current = picker.pickNext(current, tick);
      picks.push(current);
    }
    expect(new Set(picks).size).toBe(roomIds.length); // all distinct -- full rotation, no early repeat
  });
});

describe('createNavigator', () => {
  it('produces subgoal positions leading toward the goal', () => {
    const navigator = createNavigator();
    const start = GRAPH.nodes.get('nw');
    navigator.navigateTo('ne', { x: start.x, z: start.z });
    const { subgoalPosition } = navigator.tick({ x: start.x, z: start.z });
    expect(subgoalPosition).not.toEqual({ x: start.x, z: start.z }); // moved off the start node already
  });

  it('is done immediately when the goal is the room already stood in', () => {
    const navigator = createNavigator();
    const start = GRAPH.nodes.get('nw');
    navigator.navigateTo('nw', { x: start.x, z: start.z });
    navigator.tick({ x: start.x, z: start.z });
    expect(navigator.isDone()).toBe(true);
  });

  // KTD9: a doorway that stays blocked long enough reads as "blocked", not
  // "slow" -- the navigator repaths via the loop's alternate route instead
  // of waiting forever at the same doorway.
  it('repaths via an alternate route once stuck at a doorway past the threshold', () => {
    const navigator = createNavigator();
    const nw = GRAPH.nodes.get('nw');
    const nwTop = GRAPH.nodes.get('nw-top');
    const nwLeft = GRAPH.nodes.get('nw-left');
    navigator.navigateTo('ne', { x: nw.x, z: nw.z });

    // First subgoal off the room centre is the direct route's first doorway.
    let result = navigator.tick({ x: nw.x, z: nw.z });
    expect(result.subgoalPosition.x).toBeCloseTo(nwTop.x);
    expect(result.subgoalPosition.z).toBeCloseTo(nwTop.z);

    // Stand still well past the stuck threshold -- same doorway, no progress.
    for (let i = 0; i < 60; i++) {
      result = navigator.tick({ x: nw.x, z: nw.z });
    }

    // The repath must not send the bot back at the same blocked doorway.
    expect(result.subgoalPosition.x).toBeCloseTo(nwLeft.x);
    expect(result.subgoalPosition.z).toBeCloseTo(nwLeft.z);
  });

  it('does not carry a blocked edge over into a later, unrelated journey (regression)', () => {
    // A doorway jammed on one trip through a room must not stay excluded
    // forever -- blockedEdges is scoped per journey (KTD9's "resolve THIS
    // contention", not a permanent map edit), or a bot whose lifetime hits
    // stuck-repaths at both of a room's doorways on two separate later
    // trips would exclude every edge out of that room and crash the next
    // path search through it (found by adversarial code review).
    const navigator = createNavigator();
    const nw = GRAPH.nodes.get('nw');
    const nwTop = GRAPH.nodes.get('nw-top');

    navigator.navigateTo('ne', { x: nw.x, z: nw.z });
    for (let i = 0; i < 60; i++) navigator.tick({ x: nw.x, z: nw.z }); // blocks nw|nw-top this journey

    // A brand new journey starting fresh from the same room.
    navigator.navigateTo('ne', { x: nw.x, z: nw.z });
    const result = navigator.tick({ x: nw.x, z: nw.z });
    expect(result.subgoalPosition.x).toBeCloseTo(nwTop.x); // nw-top is viable again
    expect(result.subgoalPosition.z).toBeCloseTo(nwTop.z);
  });

  it('recovers instead of throwing when one journey blocks every exit from the current room (regression)', () => {
    // Standing still long enough at successive subgoals can trip the
    // stuck-repath threshold twice in the same journey; nw has exactly two
    // doorways, so this exhausts every edge out of it. Before the fallback,
    // the next repath's findPath call threw uncaught (found by adversarial
    // code review) -- an unrecoverable freeze, since nothing in the call
    // chain up to the render loop catches it.
    const navigator = createNavigator();
    const nw = GRAPH.nodes.get('nw');
    navigator.navigateTo('ne', { x: nw.x, z: nw.z });

    expect(() => {
      for (let i = 0; i < 120; i++) navigator.tick({ x: nw.x, z: nw.z });
    }).not.toThrow();
  });
});

describe('edgeKey', () => {
  it('is order-independent', () => {
    expect(edgeKey('a', 'b')).toBe(edgeKey('b', 'a'));
  });
});

describe('shipped graph', () => {
  it('has a node for every room in the map', () => {
    for (const roomId of ROOM_IDS) {
      expect(GRAPH.nodes.has(roomId)).toBe(true);
    }
  });
});
