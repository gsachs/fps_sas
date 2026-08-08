// The end-of-match cutscene's ordering. Worth its own tests because the
// ordering IS the content -- who fires, at what, in what order, and how long
// after the last one -- and because it is the one system that fires tracers
// and leaves bodies without a single real kill behind any of it.
import { describe, expect, it, vi } from 'vitest';
import { createVictorySequence } from '../../src/render/victorySequence.js';

const CENTRE = { x: 0, z: 0 };

function harness({ escorts = [{ x: 0, y: 17, z: 0 }] } = {}) {
  const calls = { tracers: [], impacts: [], corpses: [], down: [] };
  const mothership = {
    arrive: vi.fn(),
    update: vi.fn(),
    reset: vi.fn(),
    position: () => ({ x: 0, y: 27, z: 0 }),
  };
  const dropships = {
    beginVictoryFlight: vi.fn(),
    endVictoryFlight: vi.fn(),
    escortPositions: () => escorts,
  };
  const sequence = createVictorySequence({
    mothership,
    dropships,
    tracers: { spawn: (origin, target) => calls.tracers.push({ origin, target }) },
    impacts: { spawn: (point, kind) => calls.impacts.push({ point, kind }) },
    corpses: { spawn: (body) => calls.corpses.push(body) },
    onDefenderDown: (id) => calls.down.push(id),
  });
  return { sequence, calls, mothership, dropships };
}

const defender = (id, x, z) => ({ id, position: { x, y: 1, z }, yaw: 0.5 });
const run = (sequence, seconds) => {
  for (let i = 0; i < Math.round(seconds * 60); i += 1) sequence.update(1 / 60);
};

describe('victory sequence', () => {
  it('does nothing at all until the match is won', () => {
    const { sequence, calls, mothership } = harness();

    run(sequence, 30);

    expect(mothership.arrive).not.toHaveBeenCalled();
    expect(calls.tracers).toHaveLength(0);
  });

  it('brings the landing in and launches its escorts', () => {
    const { sequence, mothership, dropships } = harness();

    sequence.begin({ centre: CENTRE, survivors: [] });

    expect(mothership.arrive).toHaveBeenCalled();
    expect(dropships.beginVictoryFlight).toHaveBeenCalledWith(CENTRE);
  });

  it('holds fire while the landing is still arriving', () => {
    const { sequence, calls } = harness();
    sequence.begin({ centre: CENTRE, survivors: [defender('bot0', 10, 0)] });

    run(sequence, 2);

    // Arrival first, mop-up second: shooting on the opening frame would read
    // as the match still going rather than as it being over.
    expect(calls.down).toHaveLength(0);
  });

  it('clears every defender still standing, one at a time', () => {
    const { sequence, calls } = harness();
    const survivors = [defender('bot0', 10, 0), defender('bot1', -20, 5), defender('bot2', 4, 30)];
    sequence.begin({ centre: CENTRE, survivors });

    run(sequence, 5);
    const partway = calls.down.length;
    run(sequence, 20);

    expect(partway).toBeGreaterThan(0);
    expect(partway).toBeLessThan(survivors.length); // paced, not all at once
    expect(calls.down.sort()).toEqual(['bot0', 'bot1', 'bot2']);
  });

  it('never strikes the same defender twice, however long it runs', () => {
    const { sequence, calls } = harness();
    sequence.begin({ centre: CENTRE, survivors: [defender('bot0', 10, 0), defender('bot1', 12, 0)] });

    run(sequence, 120);

    expect(new Set(calls.down).size).toBe(calls.down.length);
    expect(calls.down).toHaveLength(2);
  });

  it('fires from the escort nearest the target, not from wherever', () => {
    const near = { x: 40, y: 17, z: 0 };
    const { sequence, calls } = harness({ escorts: [{ x: -40, y: 17, z: 0 }, near] });
    sequence.begin({ centre: CENTRE, survivors: [defender('bot0', 38, 2)] });

    run(sequence, 6);

    expect(calls.tracers[0].origin).toEqual(near);
  });

  it('falls back to the mothership when no escort has arrived yet', () => {
    const { sequence, calls, mothership } = harness({ escorts: [] });
    sequence.begin({ centre: CENTRE, survivors: [defender('bot0', 10, 0)] });

    run(sequence, 6);

    expect(calls.tracers[0].origin).toEqual(mothership.position());
  });

  it('leaves a body where each defender fell, like any other kill', () => {
    const { sequence, calls } = harness();
    sequence.begin({ centre: CENTRE, survivors: [defender('bot0', 10, -4)] });

    run(sequence, 6);

    expect(calls.corpses[0].position).toEqual({ x: 10, y: 1, z: -4 });
    expect(calls.corpses[0].yaw).toBe(0.5);
    expect(calls.impacts[0].kind).toBe('body');
  });

  it('shuts down completely on a match reset', () => {
    const { sequence, calls, mothership, dropships } = harness();
    sequence.begin({ centre: CENTRE, survivors: [defender('bot0', 10, 0)] });

    sequence.reset();
    run(sequence, 30);

    expect(mothership.reset).toHaveBeenCalled();
    expect(dropships.endVictoryFlight).toHaveBeenCalled();
    expect(calls.down).toHaveLength(0);
    expect(sequence.isRunning()).toBe(false);
  });
});
