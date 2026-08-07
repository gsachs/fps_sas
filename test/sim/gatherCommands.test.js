import { describe, expect, it, vi } from 'vitest';
import { gatherCommands } from '../../src/sim/gatherCommands.js';
import { LOCAL_PLAYER_ID } from '../../src/sim/entityIds.js';

// Builds a fake sim whose world.getEntity looks up a plain id->entity map --
// enough surface for gatherCommands (it only ever calls world.getEntity),
// without pulling in a real createSimulation/world.
function fakeSim(entitiesById) {
  return {
    world: {
      getEntity: (id) => entitiesById[id],
    },
  };
}

function fakeBotEntry(id, { active = true, sampleReturn = { tick: 0 } } = {}) {
  return {
    id,
    active,
    bot: { sample: vi.fn(() => sampleReturn) },
  };
}

describe('gatherCommands', () => {
  it("includes the local player's command, sourced from inputSampler.sample()", () => {
    const playerCommand = { tick: 1, moveX: 1 };
    const inputSampler = { sample: vi.fn(() => playerCommand) };
    const sim = fakeSim({ [LOCAL_PLAYER_ID]: { position: { x: 0, y: 0, z: 0 }, dead: false } });

    const commands = gatherCommands({ sim, bots: [], inputSampler });

    expect(inputSampler.sample).toHaveBeenCalledTimes(1);
    expect(commands.get(LOCAL_PLAYER_ID)).toBe(playerCommand);
  });

  it('gives an active, non-dead bot a command in the returned Map', () => {
    const botCommand = { tick: 1, moveX: -1 };
    const botEntry = fakeBotEntry('bot0', { active: true, sampleReturn: botCommand });
    const inputSampler = { sample: () => ({ tick: 0 }) };
    const sim = fakeSim({
      [LOCAL_PLAYER_ID]: { position: { x: 0, y: 0, z: 0 }, dead: false },
      bot0: { position: { x: 1, y: 0, z: 1 }, dead: false, health: 100, heldWeapon: 'machinegun' },
    });

    const commands = gatherCommands({ sim, bots: [botEntry], inputSampler });

    expect(commands.get('bot0')).toBe(botCommand);
    expect(botEntry.bot.sample).toHaveBeenCalledTimes(1);
  });

  it('gives an inactive bot (not yet ramped in) no command at all', () => {
    const botEntry = fakeBotEntry('bot0', { active: false });
    const inputSampler = { sample: () => ({ tick: 0 }) };
    const sim = fakeSim({
      [LOCAL_PLAYER_ID]: { position: { x: 0, y: 0, z: 0 }, dead: false },
      bot0: { position: { x: 1, y: 0, z: 1 }, dead: false, health: 100, heldWeapon: 'machinegun' },
    });

    const commands = gatherCommands({ sim, bots: [botEntry], inputSampler });

    expect(commands.has('bot0')).toBe(false);
    expect(botEntry.bot.sample).not.toHaveBeenCalled();
  });

  it('gives a dead bot no command', () => {
    const botEntry = fakeBotEntry('bot0', { active: true });
    const inputSampler = { sample: () => ({ tick: 0 }) };
    const sim = fakeSim({
      [LOCAL_PLAYER_ID]: { position: { x: 0, y: 0, z: 0 }, dead: false },
      bot0: { position: { x: 1, y: 0, z: 1 }, dead: true, health: 0, heldWeapon: 'machinegun' },
    });

    const commands = gatherCommands({ sim, bots: [botEntry], inputSampler });

    expect(commands.has('bot0')).toBe(false);
    expect(botEntry.bot.sample).not.toHaveBeenCalled();
  });

  it('threads targetAlive=false into an active bot\'s sample() when the player is dead (U4)', () => {
    const botEntry = fakeBotEntry('bot0', { active: true });
    const inputSampler = { sample: () => ({ tick: 0 }) };
    const playerPosition = { x: 5, y: 0, z: 5 };
    const botPosition = { x: 1, y: 0, z: 1 };
    const sim = fakeSim({
      [LOCAL_PLAYER_ID]: { position: playerPosition, dead: true },
      bot0: { position: botPosition, dead: false, health: 42, heldWeapon: 'machinegun' },
    });

    gatherCommands({ sim, bots: [botEntry], inputSampler });

    expect(botEntry.bot.sample).toHaveBeenCalledWith(botPosition, playerPosition, 42, 'machinegun', false);
  });

  it('threads targetAlive=true into an active bot\'s sample() when the player is alive', () => {
    const botEntry = fakeBotEntry('bot0', { active: true });
    const inputSampler = { sample: () => ({ tick: 0 }) };
    const playerPosition = { x: 5, y: 0, z: 5 };
    const botPosition = { x: 1, y: 0, z: 1 };
    const sim = fakeSim({
      [LOCAL_PLAYER_ID]: { position: playerPosition, dead: false },
      bot0: { position: botPosition, dead: false, health: 42, heldWeapon: 'machinegun' },
    });

    gatherCommands({ sim, bots: [botEntry], inputSampler });

    expect(botEntry.bot.sample).toHaveBeenCalledWith(botPosition, playerPosition, 42, 'machinegun', true);
  });
});
