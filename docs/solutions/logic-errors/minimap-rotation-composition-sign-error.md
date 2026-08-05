---
title: Minimap rotation formula had a sign error from composing with the world-to-map z-flip
date: 2026-08-06
category: logic-errors
module: minimap
problem_type: logic_error
component: service_object
symptoms:
  - "The regression test 'covers AE2: a point directly ahead of the player projects above the marker' in test/ui/minimap.test.js failed at yaw values 0, pi/2, pi, and an arbitrary yaw, with assertion output like 'expected 0.20797258270192573 to be less than 0'."
  - "A world point directly ahead of the player projected to a positive (downward) y instead of the expected negative (upward, above-marker) y in SVG map-space coordinates, for every tested yaw."
  - "A separate 'diagonal-fit invariant' test in the same file (checking only that the four floor corners stay within the circular map frame's radius) passed both before and after the fix, since the buggy and corrected formulas are both magnitude-preserving and differ only in handedness."
  - "Only the sign on the two y-component terms distinguished the buggy rotateMapPoint from the corrected one: `- sin*point.y` -> `+ sin*point.y` and `- cos*point.y` -> `+ cos*point.y`."
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [minimap, rotation-math, coordinate-basis, sign-error, directional-test, magnitude-test-blind-spot, recurring-pattern, test-first-catch]
related_components: [movement, camera-yaw]
---

# Minimap rotation formula had a sign error from composing with the world-to-map z-flip

## Problem

While building the rotating minimap's map-space math (`src/ui/minimap.js`), `rotateMapPoint(point, playerYaw)` — the function that rotates an already-flattened map-space point so the player's own forward direction always renders as "up" — had two of its four coefficients sign-flipped, causing points directly ahead of the player to project to the *bottom* of the map instead of the top. Test-first development caught this in `test/ui/minimap.test.js` before the module was ever committed; the corrected function is what shipped in commit `81aeb10`.

## Symptoms

- The directional regression test (`test/ui/minimap.test.js:24-37`, `describe('minimap: projectToMap ...')`, `it.each` over yaw `0`, `π/2`, `π`, and an arbitrary yaw `1.234`) failed against the buggy formula with concrete numeric mismatches:
  - At yaw `0` and yaw `π`, the `y < 0` assertion (`test/ui/minimap.test.js:36`) failed with `expected 0.20797258270192573 to be less than 0` — a point directly ahead of the player projected to positive `y` (screen-*down*, since SVG is y-down) instead of negative.
  - At the arbitrary yaw `1.234`, the `x ≈ 0` assertion (`test/ui/minimap.test.js:35`) failed with `expected 0.1297328755544316 to be close to +0` — the ahead-point drifted sideways instead of landing directly above the marker.
- A second test in the same file, the diagonal-fit invariant (`test/ui/minimap.test.js:50-74`, asserting the four floor corners stay within radius `1` of the map's circular frame at several yaws), **passed both before and after the fix** — it gave no signal that anything was wrong.

## What Didn't Work

The diagonal-fit test (`test/ui/minimap.test.js:67-73`) could not have caught this bug, for a precise mathematical reason, not just bad luck: it only asserts `Math.hypot(projected.x, projected.y) <= 1` — the *distance from center* of a projected point — and both the buggy and the corrected `rotateMapPoint` are **orthogonal matrices**, so both preserve that distance exactly, for every input, at every yaw.

Written as matrices (`u, v` = the map-space point's `x, y`):

- Buggy: `[[cos, -sin], [-sin, -cos]]` — row-wise dot products give `cos²+sin²=1`, `sin²+cos²=1`, and `cos·(-sin)+(-sin)·(-cos)=0`, so it's orthogonal; its determinant is `-cos²-sin²=-1`, i.e. a **reflection**.
- Correct: `[[cos, sin], [-sin, cos]]` — likewise orthogonal, but with determinant `cos²+sin²=+1`, i.e. a genuine **rotation**.

An orthogonal matrix preserves Euclidean norm (`‖Mx‖ = ‖x‖` for all `x`) regardless of its determinant's sign — that's what "orthogonal" (`MᵀM = I`) means, independent of whether it's a proper rotation (det `+1`) or a mirror-image reflection (det `-1`). A magnitude/hypot-only check can therefore only ever catch a broken *scale* (a non-unit-norm transform) — it is structurally blind to the difference between "rotated the right way" and "reflected instead of rotated," because both preserve exactly the same distance-from-center for every point. Catching this class of bug requires a test that checks *where* a point ends up, not merely *how far* it ends up from the center — which is exactly what the AE2 directional test (`test/ui/minimap.test.js:24-37`) does, and why it was written in the first place.

## Solution

`rotateMapPoint` (`src/ui/minimap.js:58-62`) only needed the sign flipped on the two `point.y`-involving terms:

```js
// before (buggy)
function rotateMapPoint(point, playerYaw) {
  const cos = Math.cos(playerYaw);
  const sin = Math.sin(playerYaw);
  return { x: cos * point.x - sin * point.y, y: -sin * point.x - cos * point.y };
}

// after (fixed — current src/ui/minimap.js:58-62)
function rotateMapPoint(point, playerYaw) {
  const cos = Math.cos(playerYaw);
  const sin = Math.sin(playerYaw);
  return { x: cos * point.x + sin * point.y, y: -sin * point.x + cos * point.y };
}
```

`point.x`'s coefficients, and the `cos`/`sin`/`-sin` pattern otherwise, are unchanged — only `- sin * point.y` became `+ sin * point.y`, and `- cos * point.y` became `+ cos * point.y`.

The regression test that catches any future recurrence is the AE2 directional test (`test/ui/minimap.test.js:24-37`), run through `projectToMap` (`src/ui/minimap.js:84-88`), which composes `toMapSpace` (`src/ui/minimap.js:35-37`) and `rotateMapPoint`:

```js
it.each([
  ['facing +Z (yaw 0)', 0],
  ['facing +X (yaw pi/2)', Math.PI / 2],
  ['facing -Z (yaw pi)', Math.PI],
  ['an arbitrary yaw', 1.234],
])('covers AE2: a point directly ahead of the player projects above the marker, %s', (_label, yaw) => {
  const player = { x: 5, z: -8 };
  const ahead = aheadWorldPoint(player, yaw, 10);
  const projected = projectToMap(ahead, player, yaw, FLOOR_HALF_SIZE);
  expect(projected.x).toBeCloseTo(0, 6); // directly above the marker, not to either side
  expect(projected.y).toBeLessThan(0);   // negative y is "up" in SVG's y-down convention
});
```

where `aheadWorldPoint` (`test/ui/minimap.test.js:17-22`) constructs a world point along the player's own forward direction, `{ x: player.x + sin(yaw)*distance, z: player.z + cos(yaw)*distance }`, matching `movement.js`'s own `forward` convention (`src/sim/movement.js:75`).

After the fix, the full suite (`npm test`, 220 tests at the time) passed, including this newly-passing directional test alongside the still-passing diagonal-fit test.

## Why This Works

Define the player's world-space forward direction as `(sin(yaw), cos(yaw))`, matching `src/sim/movement.js:75`. `toMapSpace` (`src/ui/minimap.js:35-37`) maps a raw world delta `(dx, dz)` to map-space `(u, v) = (dx·scale, -dz·scale)` — the `-dz` flip exists because SVG's y-axis increases downward while `+z` is "ahead" (comment at `src/ui/minimap.js:30-34`).

The developer's derivation started from the standard 2D rotation matrix `R(θ) = [[cosθ, -sinθ], [sinθ, cosθ]]` with `θ = -yaw` (rotating by the *negative* of yaw is what makes the map turn opposite the player, so their forward always ends up pointing screen-up — the same `-yaw` used by `computeMapTransform` at `src/ui/minimap.js:48-50`). Multiplying that matrix directly against the pair `(dx, -dz)` — substituting the map-space y-value `-dz` for the y-input *at the point of matrix multiplication*, rather than composing `toMapSpace` and the rotation as two separate steps — gives (dropping the scale factor, which is a linear constant that carries through unchanged):

```
x' = cos(yaw)·dx − sin(yaw)·(−dz) ... (raw substitution)  ⇒  as coded: cos(yaw)·dx − sin(yaw)·dz
y' = −sin(yaw)·dx − cos(yaw)·(−dz) ... (raw substitution) ⇒  as coded: −sin(yaw)·dx − cos(yaw)·dz
```

This formula is correct **only when `dx` and `dz` are the raw, unflipped world deltas fed straight into it**. But `rotateMapPoint` doesn't receive raw `(dx, dz)` — it receives `toMapSpace`'s output, `point = (u, v) = (dx·scale, -dz·scale)`. The bug was implementing `rotateMapPoint` by literally pattern-matching `point.x ↔ dx` and `point.y ↔ dz` onto the formula above and typing `- sin(yaw) * point.y` where the derivation had `- sin(yaw) * dz` — treating `point.y` as if it *were* `dz`, when it is actually already `-dz`. That's a natural mistake precisely because the formula above and the buggy code look identical once you substitute those names in — nothing about reading the buggy line reveals that `point.y` carries an extra, silent sign flip from `toMapSpace` that the raw-delta derivation never accounted for.

Re-deriving correctly: since `v = -dz`, we have `dz = -v`. Substituting that into the *original, correct* raw-delta formula (`x' = cos(yaw)·dx - sin(yaw)·dz`, `y' = -sin(yaw)·dx - cos(yaw)·dz`) and simplifying with `dx = u` (unflipped, so `point.x` is already the right quantity):

```
x' = cos(yaw)·u − sin(yaw)·(−v) = cos(yaw)·u + sin(yaw)·v
y' = −sin(yaw)·u − cos(yaw)·(−v) = −sin(yaw)·u + cos(yaw)·v
```

This is exactly the corrected code: `{ x: cos*point.x + sin*point.y, y: -sin*point.x + cos*point.y }`. The rotation matrix itself was textbook-correct, and `toMapSpace`'s z-flip was independently correct — the bug lived entirely in composing the two without re-deriving what happens to the *coefficients* when the matrix's input is itself already a transformed quantity. A concrete check at yaw `0` (where `cos=1, sin=0`) makes this tangible: for a point 10 units directly ahead of the player, `toMapSpace` produces `v ≈ -0.20797` (using this test's own scale, `1/(34·√2)` times distance 10). The `point.x` term vanishes on both sides (multiplied by `sin(0)=0`), so `y'` reduces to `±cos(0)·v = ±v`. The buggy code computes `-cos·v = -v ≈ +0.20797` (screen-down); the fix computes `+cos·v = v ≈ -0.20797` (screen-up) — exactly the numbers the failing test reported.

## Prevention

- The AE2 directional test (`test/ui/minimap.test.js:24-37`) is the concrete guardrail going forward: any future change to `rotateMapPoint`, `toMapSpace`, or their composition that reintroduces a handedness/sign error will fail this test immediately, because it checks *where* a point lands, not merely how far it is from center.
- The generalizable lesson: when composing two coordinate transforms (here, a sign-flip/axis-remap followed by a rotation), don't derive one transform's coefficients against a *hypothetical* raw input and then reuse those coefficients unchanged on the *other* transform's already-transformed output. Every intermediate variable's actual meaning has to be re-substituted at each composition boundary — `point.y` inside `rotateMapPoint` is `-dz`, not `dz`, and the formula has to be re-derived (or at minimum re-verified) against that fact, not copied from a derivation that assumed a different input shape.
- This is the same higher-level failure mode as `docs/solutions/logic-errors/strafe-direction-camera-basis-mismatch.md` — a `movement.js` world-space basis vector that was internally orthonormal (self-consistent) but the wrong-handed one relative to what the camera actually renders — and as `docs/solutions/logic-errors/bot-obstacle-avoidance-reversal.md` — a deflection formula that looked like a plausible steering pattern but pointed backward for realistic approach angles, invisible to anyone who only read the formula. All three are "a coordinate/vector-math transform that is internally valid (orthonormal, textbook-derived, or superficially plausible) but wrong relative to what it's supposed to produce downstream, and invisible to a self-consistency or magnitude-only check." This is now the third occurrence of that exact pattern in this repo. The AE2 test itself was written in direct anticipation of that lesson from the strafe-direction bug, and it worked — it caught a new instance of the same class before the module was ever committed, rather than after it shipped. Given three occurrences now, it may be worth this repo turning "assert the actual downstream-consumed direction/orientation, not just internal self-consistency or magnitude" into an explicit, named review-checklist item or a `CONCEPTS.md` entry — a recommendation for a follow-up, not something this doc implements.

## Related Issues

- `docs/solutions/logic-errors/strafe-direction-camera-basis-mismatch.md` — a different bug (a `movement.js` basis vector picking the wrong-handed perpendicular relative to the rendered camera) but a real, causal relationship: this doc's own AE2 directional test exists specifically because of that doc's prevention lesson ("cross-check against the actual rendered/consuming side, not just internal orthonormality"), and it worked — catching this second instance of the same higher-level pattern before it ever shipped.
- `docs/solutions/logic-errors/bot-obstacle-avoidance-reversal.md` — a third, mechanically distinct occurrence of the same pattern family (an angle-dependent deflection-blend singularity, rather than a composition/re-derivation error), sharing no files or specific mechanism with this bug but the same underlying lesson.
- `docs/solutions/logic-errors/bot-retreat-survives-death.md` — unrelated; a clock-domain/stale-deadline bug with no shared mechanism.
