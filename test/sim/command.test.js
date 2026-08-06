import { describe, expect, it } from 'vitest';
import { createCommand, createFireLatch } from '../../src/sim/command.js';

describe('createCommand', () => {
  it('returns a fully-populated command with sensible defaults', () => {
    const command = createCommand();
    expect(command).toEqual({
      tick: 0,
      moveX: 0,
      moveZ: 0,
      yaw: 0,
      pitch: 0,
      buttons: { fire: false, fireHeld: false, jump: false, throwGrenade: false },
    });
  });

  it('applies overrides on top of the defaults', () => {
    const command = createCommand({ moveX: 1, buttons: { fire: true } });
    expect(command.moveX).toBe(1);
    expect(command.buttons.fire).toBe(true);
    expect(command.moveZ).toBe(0);
  });
});

describe('createFireLatch', () => {
  it('consumes exactly one shot per press, regardless of tick count', () => {
    const latch = createFireLatch();
    latch.press();

    expect(latch.consume()).toBe(true);
    expect(latch.consume()).toBe(false);
    expect(latch.consume()).toBe(false);
  });

  it('queues multiple presses so each is consumed by its own tick', () => {
    const latch = createFireLatch();
    latch.press();
    latch.press();
    latch.press();

    expect(latch.consume()).toBe(true);
    expect(latch.consume()).toBe(true);
    expect(latch.consume()).toBe(true);
    expect(latch.consume()).toBe(false);
  });

  it('returns false when nothing is pending', () => {
    const latch = createFireLatch();
    expect(latch.consume()).toBe(false);
  });

  it('clear() drops any pending presses so a later consume() finds nothing (U16)', () => {
    const latch = createFireLatch();
    latch.press();
    latch.press();

    latch.clear();

    expect(latch.consume()).toBe(false);
  });
});
