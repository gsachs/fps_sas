---
title: Bot obstacle avoidance reversed bots into cover instead of sliding past it
date: 2026-08-03
category: logic-errors
module: bot-steering
problem_type: logic_error
component: service_object
symptoms:
  - A bot chasing the player behind cover would stop short of an obstacle, flip roughly 180 degrees, re-approach, hit the same obstacle again, and flip again -- oscillating in place indefinitely instead of routing around the cover box.
  - The code review that caught this measured a 60-second, 4-bot simulation run where 5471 of 5480 avoidance deflections (99.8%) reversed the bot by more than 90 degrees instead of sliding it past the obstacle.
  - The same review's reproduction had a bot spawned at a corner cover-box position stay stuck for the entire 50-second test window, never closing to within 18.26 units of the player or gaining line of sight.
  - avoidObstacles reversed the bot instead of deflecting it sideways for any approach within about 48 degrees of head-on, since dot(desiredDirection + hitNormal * 1.5, desiredDirection) goes negative in that range.
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [bot-ai, steering, obstacle-avoidance, vector-rejection, tangent-projection, rapier-physics, code-review-catch, regression-test]
related_components: [bot-fsm, rapier-physics-world]
---

# Bot obstacle avoidance reversed bots into cover instead of sliding past it

## Problem

Bot obstacle avoidance in `src/sim/bot/steering.js` reversed bots into the very cover they were approaching instead of routing them around it. `avoidObstacles` casts a short ray along a bot's desired movement direction and, on a hit, is supposed to deflect the bot sideways past the obstacle; instead, for almost every realistic approach angle, it sent the bot backward — defeating, in the fix commit's own words, this unit's goal of bots that "take positions and fight believably."

## Symptoms

- A bot chasing the player behind cover would stop short of the obstacle, flip roughly 180 degrees, re-approach, hit the obstacle again, and flip again — oscillating in place instead of sliding past it.
- The code review that caught this instrumented a 60-second, 4-bot simulation with a moving player and measured 5471 of 5480 avoidance deflections (99.8%) reversing the bot by more than 90 degrees from its intended direction. (These figures are recorded here from that review's own measurements; they don't appear in any commit message or tracked file, so treat them as provenance-attributed rather than independently re-derivable from the repo.)
- The same reproduction had a bot spawned at a corner cover-box position stay permanently stuck for the entire 50-second test window — never closing distance below 18.26 units to the player, never acquiring line of sight. (60Hz × 50s is 3000 ticks, consistent with this project's tick rate, though "3000-tick" itself isn't stated verbatim anywhere.)
- The behavior directly contradicted `avoidObstacles`'s own doc comment (`src/sim/bot/steering.js:34-37`), which describes deflecting "using the hit surface normal so bots route around cover instead of parking against it."

## What Didn't Work

- **Reading the formula in isolation.** The buggy line, `normalize(desiredDirection + hitNormal * 1.5)`, looks like a plausible steering-deflection formula at a glance — it matches a commonly-seen pattern from simple steering-behavior tutorials ("blend in the normal to push away from the wall"). A casual code read did not surface anything wrong with it, and it shipped through the original feature commit (`5b3dd27`) unnoticed.
- **What it took instead:** the bug was only caught because two independent reviewers (a "correctness" reviewer and an "adversarial" reviewer, in an automated multi-agent code review) each went past reading the code and did concrete verification:
  1. Hand vector algebra for a head-on hit: the raycast hit normal is exactly anti-parallel to the desired direction (`normal ≈ -desired`), so `desired + normal * K` for `K > 1` collapses to `desired * (1 - K)` — a *negative* scalar multiple of `desired`, i.e. pointing backward, not sideways.
  2. An executed scratch reproduction against the real Rapier physics world — not just reasoning about it — measuring `dot(result, desiredDirection)` for a head-on and an oblique approach against the actual pre-fix code. This produced unambiguous negative numbers (the fix commit records them directly: measured dot -1.0 head-on, -0.22 oblique).
  3. One reviewer additionally ran a full simulated match (60s, 4 bots, moving player), instrumenting every `avoidObstacles` call and tallying how often the result reversed the bot — turning "this looks wrong" into the hard measured rate of 99.8%.
- The lesson that generalizes: a steering/deflection bug like this can look completely reasonable on a code read. It only became visible once someone did the vector algebra explicitly for a concrete angle, or executed the function against real geometry and measured the resulting direction against the intended one.

## Solution

The fix (`src/sim/bot/steering.js:38-72`) keeps the same raycast setup and replaces only the deflection math. The ray cast and clear-path bailout are unchanged:

```js
// src/sim/bot/steering.js:39-49
const origin = { x: position.x, y: position.y, z: position.z };
const direction = { x: desiredDirection.x, y: 0, z: desiredDirection.z };
const hit = rapierWorld.castRayAndGetNormal(
  new RAPIER.Ray(origin, direction),
  AVOIDANCE_LOOKAHEAD,
  true,
  undefined,
  undefined,
  excludeCollider
);
if (!hit) return desiredDirection;
```

The deflection itself (`src/sim/bot/steering.js:58-71`):

```js
const alongNormal = desiredDirection.x * hit.normal.x + desiredDirection.z * hit.normal.z;
const tangent = {
  x: desiredDirection.x - hit.normal.x * alongNormal,
  z: desiredDirection.z - hit.normal.z * alongNormal,
};
const normalizedTangent = normalize(tangent);
if (normalizedTangent.x === 0 && normalizedTangent.z === 0) {
  // Exactly head-on: the tangential component vanishes (normalize()'s own
  // near-zero-length convention), so there's no "which way past it" signal
  // to slide along. Pick a fixed perpendicular to the surface normal as a
  // deterministic (not reversing) escape.
  return normalize({ x: -hit.normal.z, z: hit.normal.x });
}
return normalizedTangent;
```

Walking through it:

1. `alongNormal` (`steering.js:58`) is `dot(desiredDirection, hit.normal)`.
2. `tangent` (`steering.js:59-62`) is the standard vector-rejection formula: subtracting the projection of `desiredDirection` onto `hit.normal` leaves only the component of `desiredDirection` that lies *along* the obstacle's surface — "slide sideways past it" rather than "bounce off it."
3. `normalize(tangent)` (`steering.js:63`, using the module's own helper at `steering.js:12-16`) returns exactly `{x: 0, z: 0}` only in the genuine head-on singularity, where the tangential component is truly zero, not merely small.
4. In that one degenerate case, `steering.js:69` falls back to a fixed vector perpendicular to the hit normal (`{x: -hit.normal.z, z: hit.normal.x}`) — not a reversal, just directionless-but-safe. The very next tick, the bot's shifted position makes the angle no longer exactly head-on, and the tangent-slide (step 2) takes back over. Otherwise (`steering.js:71`) the normalized tangent is returned directly.

The fix commit (`c094f90`) records the end-to-end validation: the bot that had been permanently stuck at a corner cover box for the full 50-second test window "now escapes and closes on the player in ~2.5s."

## Why This Works

Any vector `v` can be split, relative to a unit normal `n`, into a component parallel to `n` (`(v · n) * n`) and a component perpendicular to it (`v - (v · n) * n`). The perpendicular component is exactly the "tangent to the surface" direction a sliding/deflecting object should follow — the same identity used generally in real-time collision response and constraint solvers (e.g. "remove the component of velocity along the collision normal"), not something specific to this codebase. `tangent` at `steering.js:59-62` is precisely this perpendicular component, with `hit.normal` as `n` and `desiredDirection` as `v`.

Concretely, using the oblique regression test's own numbers (`test/sim/bot/steering.test.js:82-93`): from `fromPosition = {x:-1.5, z:3}` toward `target = {x:0, z:5}`, `desired = seek(...) = {x:0.6, z:0.8}`. The ray lands on the wall's flat front face (`test/sim/bot/steering.test.js:49-59` builds a wall wide enough to guarantee this) with normal `{x:0, z:-1}`. Then:

- `alongNormal = 0.6·0 + 0.8·(-1) = -0.8`
- `tangent = {x: 0.6 - 0·(-0.8), z: 0.8 - (-1)·(-0.8)} = {x: 0.6, z: 0}`
- normalized: `{x: 1, z: 0}` — purely sideways along the wall's face
- `dot(result, desired) = 0.6·1 + 0.8·0 = 0.6` — positive: genuine forward progress, not a reversal.

Contrast with the old formula. The in-code comment at `steering.js:51-57` documents the bug directly in the source it replaced: `normalize(desired + normal * 1.5)` reversed the bot instead for any approach within ~48 degrees of head-on, since `dot(desired + normal * K, desired)` goes negative there. The mechanism: for a near-head-on hit, `normal ≈ -desired`, so

```
desired + normal * K ≈ desired + (-desired) * K = desired * (1 - K)
```

For the old `K = 1.5`, that's `desired * -0.5` — a negative scalar multiple of `desired`. Normalizing a negative scalar multiple of a vector just flips its sign, so the result is (close to) `-desired`: the bot is sent back the way it came. Because the reversal threshold is ~48 degrees either side of dead-on, it covers nearly every realistic chase-and-corner-a-target angle — which is exactly why the measured reversal rate came out at 99.8%, not some smaller edge-case fraction.

The exact head-on case is the interesting edge in the *fixed* code too (`test/sim/bot/steering.test.js:69-80`): `desired = {x:0, z:1}`, `normal = {x:0, z:-1}` gives `alongNormal = -1`, so `tangent = {x:0, z:0}` exactly — there is genuinely no sideways direction to slide along on a perfectly perpendicular hit; it's a mathematical singularity, not an implementation gap. The fallback at `steering.js:69` resolves to `{x:1, z:0}` here, giving `dot(result, desired) = 0`: perpendicular, not reversed.

## Prevention

- Two regression tests now exercise `avoidObstacles` directly in `test/sim/bot/steering.test.js`:
  - `'does not reverse a head-on approach into the obstacle (regression)'` (`test/sim/bot/steering.test.js:69-80`), asserting `expect(dot(result, desired)).toBeGreaterThan(-0.5)` (line 79).
  - `'deflects an oblique approach with genuine forward progress, not a reversal (regression)'` (`test/sim/bot/steering.test.js:82-93`), asserting `expect(dot(result, desired)).toBeGreaterThan(0)` (line 92).
- Before the fix commit, `test/sim/bot/steering.test.js` did not exist at all — its entire history is the single fix commit `c094f90`, whose own message states it plainly: "Added test/sim/bot/steering.test.js (previously no test file existed for seek/flee/wander/avoidObstacles at all)." The only test coverage anywhere near this feature before the fix was `test/sim/botAI.test.js` (added in the original feature commit `5b3dd27`), which exercises the higher-level bot FSM and never calls or inspects `seek`/`flee`/`wander`/`avoidObstacles` directly. The reversed-direction bug shipped in `5b3dd27` and was invisible to the existing suite for as long as it existed.
- General guardrail for future steering/deflection code in this codebase, or any raycast-based avoidance system: any "compute a deflected/bounced direction from a hit normal" function should carry a direct unit test asserting the output's dot product with the *intended* direction is non-negative (or strictly positive, excluding the exact head-on/degenerate case). That single assertion shape catches this entire bug class immediately and costs almost nothing to write:

```js
// desired: the direction the mover wants to go; obstacle placed directly ahead
const result = avoidFn(world, position, desired, /* ... */);
expect(dot(result, desired)).toBeGreaterThan(0); // or >= 0 for the exact head-on case
```

## Related Issues

`docs/solutions/` did not exist in this repo before this entry — this was the first captured learning here (no GitHub issue tracker is in active use on this solo project; `gh` CLI is unavailable in this environment). A second entry was added shortly after; see below.

Two thematically-adjacent bugs surfaced in the same bot-AI subsystem, from the same code-review pass — neither is a duplicate of or a cause of this one, but they're worth knowing about if you're working in this area:

- **`docs/solutions/logic-errors/bot-retreat-survives-death.md`** — bot retreat state (`src/sim/bot/fsm.js`) surviving a bot's death, stranding respawned bots fleeing at full health. Full root cause and fix (`8755d58` refined by `b74a5d8`) are covered there.
- **`744f7de`**, extracted into a named, tested helper by **`aadeb8c`** — "Fix ramp reinforcement able to spawn exactly on top of the player" (`src/main.js`) — a ramp-in reinforcement bot's spawn-selection excluded the live player from its occupied-position list, so a reinforcement could spawn exactly on top of the player. `744f7de` fixed the list to include every live entity; a follow-up review pass (`aadeb8c`) extracted that logic into a named `buildOccupiedPositions` helper (`src/shell/botRamp.js`, called as `src/main.js:174`) and added its first direct test coverage.
