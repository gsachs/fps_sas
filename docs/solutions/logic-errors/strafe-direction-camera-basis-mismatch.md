---
title: Strafe-right (D) moved the player toward the camera's visual left instead of right
date: 2026-08-05
category: logic-errors
module: movement
problem_type: logic_error
component: service_object
symptoms:
  - "Pressing D (strafe right) moved the player toward the camera's visual left on screen -- the opposite of the pressed key."
  - "Pressing A (strafe left) moved the player toward the camera's visual right on screen -- also the opposite of the pressed key."
  - "The inversion was present on every match for every player from the first frame of movement, not conditional on any game state, difficulty, or map."
  - "window.__debugCameraForward() showed the movement vector's dot product against the expected camera-visual-right was approximately -1 (opposed) before the fix and approximately +1 (aligned) after."
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [movement, strafe, camera-yaw, coordinate-convention, regression-test, live-play-bug, bot-fsm, control-scheme]
related_components: [bot-fsm, camera-yaw]
---

# Strafe-right (D) moved the player toward the camera's visual left instead of right

## Problem

The strafe-right key (D) moved the player toward the camera's visual *left* instead of visual right — the world-space `right` basis vector used to decode local movement commands in `src/sim/movement.js:82` (`resolveMovement`) was a mathematically valid perpendicular to `forward`, but the wrong-handed one relative to what the rendered camera actually shows on screen. Found live during playtesting of the new rooms-and-corridors arena.

## Symptoms

- Holding D (strafe right) visibly moved the player character to the left on screen, and by symmetry A (strafe left) moved right — inverted from every other left/right convention in the game (aim, hitscan, bot facing).
- Forward/backward movement (W/S) was unaffected — only the strafe axis was flipped.
- No test failure and no error/exception anywhere; the bug was purely a visually-observed direction mismatch, only detectable by watching the rendered game.
- Bots showed no corresponding visible misbehavior (patrol/chase/doorway-crossing looked normal), because `src/sim/bot/fsm.js`'s `sample()` encoded world-space intent using the identical wrong basis, so the encode and decode sides cancelled each other out consistently.

## What Didn't Work

Ordinary code review did not catch this because the pre-fix code was locally self-consistent and looked correct in isolation:

```js
// src/sim/movement.js, resolveMovement — pre-fix
const yaw = command.yaw;
const forward = { x: Math.sin(yaw), z: Math.cos(yaw) };
const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
```

`right` was exactly perpendicular to `forward` and formed a valid orthonormal basis — the variable name matched its apparent geometric role, the math was internally consistent, and `forward` itself was independently correct (it matched the aim/hitscan direction other code already relied on, via `src/render/entityMesh.js:56`'s `computeCameraYaw`). Nothing about reading the formula in isolation reveals which of the two perpendiculars to `forward` corresponds to the *camera's* rendered right — that requires cross-checking against the actual render-side yaw convention (the `+PI` offset in `computeCameraYaw`), not just internal vector-math self-consistency. There was no existing test asserting strafe direction against the rendered camera's basis — `test/sim/movement.test.js` had wall-collision and other physics-behavior tests, but nothing checked that `moveX: 1` (D held) actually moves the player toward what a player watching the screen would call right. The bug shipped and was only found live, by a human watching the screen.

## Solution

Per this repo's "bug reports start with a failing test" convention, a regression test was added to `test/sim/movement.test.js:33-72` *before* the fix, confirmed failing pre-fix and passing post-fix:

```js
describe('movement: strafe direction matches the rendered camera (regression)', () => {
  function visualRight(yaw) {
    return { x: -Math.cos(yaw), z: Math.sin(yaw) };
  }

  it('pressing the strafe-right key (D) moves the player toward the camera-visual-right direction, not left', () => {
    const { world, movement } = buildTestRig();
    world.addEntity('player', { position: { x: 0, y: 1, z: 0 } });
    movement.addCharacter('player', { x: 0, y: 1, z: 0 });

    const yaw = 0;
    const command = createCommand({ moveX: 1, moveZ: 0, yaw }); // D held, facing sim yaw 0
    for (let i = 0; i < 30; i++) {
      world.step(new Map([['player', command]]), 1 / 60);
    }

    const position = world.getEntity('player').position;
    const moved = { x: position.x, z: position.z };
    const distance = Math.hypot(moved.x, moved.z);
    expect(distance).toBeGreaterThan(0.1); // sanity: it actually moved
    const normalizedMoved = { x: moved.x / distance, z: moved.z / distance };

    const expectedRight = visualRight(yaw);
    const dot = normalizedMoved.x * expectedRight.x + normalizedMoved.z * expectedRight.z;
    expect(dot).toBeGreaterThan(0.9); // moved toward camera-visual-right, not away from it
  });
});
```

The fix itself (commit `a1ff49b`, "fix: strafe-right moved the camera-visual left, not right") flips the sign of `right`'s components in both files where this basis is used.

`src/sim/movement.js:74-82` (`resolveMovement`):

```js
// before
const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };

// after
const right = { x: -Math.cos(yaw), z: Math.sin(yaw) };
```

`src/sim/bot/fsm.js:329-330` (inside `createBotAI`'s `sample()`), the identical change, since this function encodes a bot's world-space movement intent back into the same local `moveX`/`moveZ` command shape `movement.js` decodes:

```js
// before
const forward = { x: Math.sin(yaw), z: Math.cos(yaw) };
const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };

// after
const forward = { x: Math.sin(yaw), z: Math.cos(yaw) };
const right = { x: -Math.cos(yaw), z: Math.sin(yaw) };
```

Both files had to change in the same commit — changing only `movement.js` would have fixed the player's strafe but made bots' AI-decided world-space direction get mis-encoded into the wrong local command, desyncing their actual movement from their own decision logic. This was validated with a live bot-movement sanity check post-fix (headless Playwright session, 8-second observation window): bots still patrolled, chased, and crossed doorways normally — not frozen, not moving in an unintended direction.

Live verification (headless Playwright + Chromium, using the project's pre-existing `window.__debugCameraForward()` debug hook) measured the dot product between actual movement direction and the expected camera-visual-right direction: before the fix, dot ≈ -1 (moving exactly opposite of intended); after the fix, dot ≈ +1 (moving exactly toward camera-visual-right).

## Why This Works

The root cause is a coordinate-convention mismatch between the simulation's internal yaw and the yaw Three.js actually renders the camera at. `src/render/entityMesh.js:56-58` (`computeCameraYaw`) applies a deliberate, load-bearing `+Math.PI` offset:

```js
export function computeCameraYaw(simYaw) {
  return simYaw + Math.PI;
}
```

The comment immediately above it (`entityMesh.js:45-55`) explains why: THREE cameras look down their local `-Z` axis by default, but every other convention in this codebase treats `+Z` as "front" for a given yaw, so `camera.rotation.y = simYaw` alone would face the camera 180 degrees from where the weapon actually fires. The `+PI` offset exists specifically to keep the rendered camera direction aligned with what `movement.js`'s `forward` vector and the hitscan direction already assume.

Working through the algebra of that `+PI` offset composed with THREE's standard Y-axis rotation of the camera's local forward `(0, 0, -1)` gives exactly `(sin(simYaw), cos(simYaw))` as the true world-space camera-forward direction — which is precisely `movement.js`'s pre-existing `forward` vector (`movement.js:75`). That's why `forward` was already correct and never needed to change: it happened to agree with the true camera-forward once the `+PI` offset is accounted for, and it had already been implicitly validated by aim/hitscan code relying on the same vector.

`right`, however, was derived as "whichever vector is perpendicular to `forward`" via a plain trigonometric rotation — `(cos(yaw), -sin(yaw))` is a perfectly valid unit vector orthogonal to `forward`, but it's *a* perpendicular, not *the* camera's-visual-right perpendicular. In a Y-up, right-handed scene, the camera's true visual-right is `forward × up`, which works out to `(-cos(yaw), sin(yaw))` — the sign-flipped version of the original. The original formula picked the mathematically-valid-but-oppositely-handed perpendicular because it was never independently cross-checked against the camera's own rotated basis; it was only checked for orthogonality to `forward`, which both candidates satisfy equally well.

`src/sim/bot/fsm.js`'s `sample()` had to change identically because it performs the inverse operation: it projects a bot's already-decided world-space `moveDirection` onto `forward`/`right` via dot products (`fsm.js:331-332`) to produce the same local `moveX`/`moveZ` shape that `movement.js:83-84` later decodes back into world space. The two files' basis vectors form an encode/decode pair — they only round-trip correctly (or incorrectly) as a matched set. Because both sides used the identical wrong formula before the fix, the bug was self-canceling for bots and produced no visible symptom on its own; it only became a live risk the moment one side changed independently of the other.

## Prevention

- The new regression test (`test/sim/movement.test.js:33-72`) is the direct guardrail: it asserts that a strafe-right command moves the player toward the algebraically-derived camera-visual-right direction, not merely toward *some* perpendicular of forward, so any future change to `movement.js`'s basis vectors that regresses handedness fails a fast, non-visual test instead of requiring a human to watch the screen again.
- The generalizable lesson: a local-to-world (or world-to-local) basis-vector pair is not validated by checking that its vectors are mutually orthonormal — that only confirms internal self-consistency, not that it agrees with whichever downstream consumer actually renders or interprets it (here, the camera/Three.js). Any time a `forward`/`right`/`up`-style basis is introduced or changed, cross-check it against the actual rendered or consuming side (e.g. a debug hook like `window.__debugCameraForward()`, or an explicit test asserting the real screen-space effect), not just against its own math.
- This basis is duplicated in exactly two places by necessity — `src/sim/movement.js` (decode: local command → world movement) and `src/sim/bot/fsm.js`'s `sample()` (encode: world intent → local command). Both carry comments cross-referencing each other and warning that they must match exactly. On any future yaw/basis convention change, grep for `Math.cos(yaw)` and `Math.sin(yaw)` (or `right = {`) across `src/sim/` to find both sides of this pair and update them together in the same commit — updating only one silently desyncs bot AI intent from actual bot movement, which is otherwise invisible until the two sides disagree.

## Related Issues

- Unrelated to the two other bot-AI docs in this category (`bot-retreat-survives-death.md`, `bot-obstacle-avoidance-reversal.md`) despite living in adjacent movement/steering/fsm code. The retreat doc is a clock-domain/stale-deadline bug in `transitionBotState`; the obstacle-avoidance doc is an angle-dependent deflection-formula singularity in `steering.js`. This bug is a systematic, angle-independent coordinate-convention mismatch in the local-to-world basis vectors — a distinct root-cause class from both.
