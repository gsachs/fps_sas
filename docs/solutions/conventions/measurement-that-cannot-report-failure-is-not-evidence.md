---
title: A measurement that cannot report failure is not evidence
date: 2026-08-08
category: conventions
module: verification-instrumentation
problem_type: convention
component: testing_framework
severity: high
applies_when:
  - "Writing a new window.__debug* hook, a headless-browser probe, or an ad-hoc measurement snippet"
  - "Adding a regression guard whose only job is to fail on the pre-fix code"
  - "Counting scene-graph objects or sampling pixels — measuring a rendered result no unit test can see"
  - "Reusing a long-lived instrumentation hook whose subject has been reimplemented since"
  - "Acting on a measurement that returned zero, empty, or pass"
symptoms:
  - "A measurement returns a plausible value (0, empty, pass) while being structurally incapable of returning any other"
  - "An ad-hoc scene-walk snippet defines its recursive walk but never invokes it, so it reports zero unconditionally"
  - "A debug hook keys off an incidental implementation property (type === 'Line') and silently returns zero after a refactor"
  - "A regression guard passes against the exact pre-fix code it was written to catch"
  - "Time is spent debugging working code because a broken instrument reported a defect that does not exist"
root_cause: logic_error
resolution_type: workflow_improvement
tags:
  - verification
  - instrumentation
  - false-negative
  - positive-control
  - debug-hooks
  - regression-guard
  - pixel-testing
related_components:
  - tooling
  - development_workflow
  - testing_framework
---

# A measurement that cannot report failure is not evidence

## Context

This project can see its simulation in complete detail and cannot see its output at all, which is exactly where the defects concentrate — the visual test layer says so in its own header (`test/visual/support/renderHarness.js:1-8`). Everything that closes that gap is instrumentation: `window.__debug*` hooks (`src/debug/testHooks.js`), the pixel samplers in the render harness, and one-off probes typed straight into `page.evaluate()` while a headless Chromium is already open.

Over one long visual-polish session, three separate pieces of that instrumentation turned out to be structurally incapable of reporting the failure they existed to detect. Each one returned a plausible number. None of them could have returned any other number. Two of the three were believed for a while; the third had been believed for a long time.

The shared property is not "a bug in a test". It is that the *output space* of the measurement had silently collapsed to a single value — and in every case that value was the benign one: `0`, or "pass".

## Guidance

**Before you trust a new measurement, demonstrate that it can fail.**

That is the whole practice. It costs one extra run and it is the only thing that distinguishes a measurement from a decoration.

### For a regression guard: run it red first

A guard written for a defect must be executed against the code that still has the defect, and observed failing, before the fix lands. A guard that has never been seen failing is an assertion about nothing.

The seam check in `test/visual/render.visual.js:40-63` is the shape to copy — and its own comment records why (`:57-59`). The broken version drew its "clean floor" reference from inside the band it was measuring:

```js
// BROKEN: reference sampled from inside the measured band.
const profile = (await render.column(300, junction, junction + 30)).map((p) => p.l);
const floorTypical = median(profile);      // includes the seam rows themselves
const peak = Math.max(...profile.slice(0, 8));
expect(peak / floorTypical).toBeLessThan(SOME_RATIO);
```

The defect's own brightness was baked into the baseline, so the brighter the seam got, the higher the baseline rose with it. The corrected form keeps the two windows disjoint and sums excess area rather than peaking:

```js
const profile = (await render.column(300, junction, junction + 30)).map((pixel) => pixel.l);
const floor = [...profile.slice(14)].sort((a, b) => a - b);      // outside the band
const floorTypical = floor[Math.floor(floor.length / 2)];
const excess = profile.slice(0, 8)                                // inside the band
  .reduce((total, l) => total + Math.max(0, l - floorTypical), 0);
expect(excess).toBeLessThan(12);
```

The numbers recorded in the comment at `test/visual/render.visual.js:49-55` are the evidence that this one can fail: healthy 5, 18 with `normalBias` alone, 256 with both biases. Three observed values, two of them red. That is what a demonstrated measurement looks like in the file afterwards.

### For an ad-hoc probe: give it a positive control

Before believing a zero, put the world in a state where the thing definitely exists and confirm the probe reports non-zero. Only then is a subsequent zero informative.

The probe that failed this way was, in essence:

```js
await page.evaluate(() => {
  let n = 0;
  const walk = (o) => { if (o.name === 'corpse') n += 1; o.children.forEach(walk); };
  return n;            // walk was never called
});
```

`0` was the only value that snippet could ever produce, on any scene, in any state. A positive control — spawn a body, count, expect > 0 — would have caught it in one extra line, before any conclusion was drawn from the zero.

### Prefer a same-run delta over an absolute reading

An absolute count checked once collapses quietly. A before/after comparison taken inside one process does not: to fake a pass, both readings have to be wrong in the same direction, which is a much harder accident to have.

This is already the governing rule of the visual layer — "every number is compared against another number measured FROM THE SAME FRAME" (`test/visual/support/renderHarness.js:12-17`) — and it is the same discipline applied to counters. For the cutscene, the honest measurement was not "how many bodies exist" but "how many bots are still visible, sampled repeatedly across the sequence". `window.__debugBotPhases()` already returns `meshVisible` per bot for exactly that kind of reading (`src/debug/testHooks.js:166-175`).

Same-run relativity is necessary but not sufficient: the seam guard in example 3 was already a same-frame comparison and still could not fail, because its control point sat *inside* the region under test. The reference must be relative **and** disjoint.

### Promote useful probes out of `page.evaluate()`

Inline probes are the highest-risk category in this repo: unreviewed, untested, written under time pressure, and trusted the instant they print. When one proves useful, move it into the vetted hook layer (`src/debug/testHooks.js`) or the permanent visual layer (`test/visual/`, run with `npm run test:visual` — `package.json:11`), where it gets read at least once by someone who is not mid-investigation.

Worth naming the causal chain: the corpse probe was written inline *because no hook covered corpses*. `createCorpseField` already exposes `count()` (`src/render/corpses.js:82`) and every body is named `'corpse'` (`src/render/corpses.js:50`) — the count was one line from being a hook, and its absence is what forced an unvetted snippet into the loop. The gap in the hook layer is what manufactures the risk.

## Why This Matters

A measurement that reports "everything is fine" and cannot report anything else is worse than no measurement at all. With no measurement, the state of the system is an acknowledged unknown and you keep looking. With a collapsed measurement, the unknown has been converted into a confident false negative — and the session then spends its remaining attention in the wrong place.

That is not hypothetical here. The corpse probe's `0` pointed at `corpses.spawn` (`src/render/victorySequence.js:75`) and the cutscene director, both of which were working correctly. Debugging correct code is the most expensive activity available: nothing you change makes the number move, so the natural response is to change more.

**Zero is the uniquely dangerous return value in measurement code.** Every other collapsed value eventually looks strange — a count that is always 7, a luminance that is always 128. Zero never looks strange, because "nothing there" is a legitimate and usually correct state. `__debugTracerCount` reporting `0` was indistinguishable from "no tracers on screen right this frame", which is true most of the time. So the broken hook produced no alarming reading, ever, for as long as it was broken. Nothing failed *loudly*, and nothing was being checked *quietly*.

The second cost is trust. This repo leans hard on instrumentation to compensate for a rendering pipeline that unit tests cannot see. Every hook that turns out to be a liar devalues the rest of them, and the natural reaction — re-verifying by eye — is precisely the manual work the hook layer exists to eliminate.

## When to Apply

- Writing any new `window.__debug*` hook in `src/debug/testHooks.js`.
- Writing any new check in `test/visual/` — the whole layer asserts on numbers nobody can eyeball.
- Typing a probe inline into `page.evaluate()` during an investigation. Especially then. Especially when the first reading agrees with what you already suspected.
- Any time a measurement returns `0`, `null`, `[]`, or "pass" and that result is about to change what you do next.
- Any time a test's baseline is derived from the same data as the thing it is judging — same pixel band, same time window, same collection, same frame region.
- Any time a check keys off an incidental property of the implementation (`type === 'Line'`, a class name, a geometry kind) rather than a property something deliberately declares. Those are the collapses that arrive later, when someone changes the implementation for an unrelated reason.

Not needed for measurements whose failure you have already witnessed in the normal course of the work — if you watched it go red, it can go red.

## Examples

### 1. The inline snippet that could only return zero

**Situation.** An end-of-match cutscene where escort drones clear surviving bots from the air (`src/render/victorySequence.js`). Strikes are paced one at a time — first after 3.2s, then every 1.15s (`:20-22`), each one calling `corpses.spawn` (`:75`) and reporting the defender down (`:76`). The question was whether bodies were actually being left behind.

**Before.** A `page.evaluate()` snippet defined a recursive `walk` over the scene graph looking for `o.name === 'corpse'` and returned the counter without ever invoking `walk`. It printed `corpses in scene: 0`. Per this session's investigation the cutscene was working correctly the entire time; the probe simply had no path to any value but zero.

**After.** Re-run with the traversal actually invoked, plus a same-run before/after count of visible bot meshes across the sequence. That showed the real behaviour: 2 survivors → 1 → 0, cleared one at a time, matching the pacing constants. The delta was the load-bearing part — the absolute corpse count alone would have been another single unverified reading.

The durable fix is a hook, not a better snippet: `corpses.count()` exists (`src/render/corpses.js:82`), and the unit suite already counts by name the same way (`test/render/corpses.test.js:23`).

### 2. The hook that had been lying since a refactor

**Before.** `__debugTracerCount` counted scene children with `type === 'Line'`. Bullet tracers were at some point reimplemented as meshes so they would have visible thickness — a `THREE.Line` renders one pixel wide on every platform that matters. From that change onward the hook returned `0` forever. No test broke, no reading looked wrong, because zero tracers is the normal state between shots.

**After.** It counts by name (`src/debug/testHooks.js:109-110`):

```js
const countNamed = (name) => scene.children.filter((child) => child.name === name).length;
window.__debugTracerCount = () => countNamed('tracer');
```

The same helper now backs `__debugEffectCounts` for sparks, decals and explosion effects (`:111-117`), and the comment above it (`:102-108`) records the reasoning that generalises: *names survive a mesh becoming a sprite; types do not*. Keying a measurement to an incidental implementation property is a delayed-action collapse — it works until someone changes the implementation for a reason that has nothing to do with the measurement.

A positive control would have caught this at any point in its lifetime: fire, then count, expect non-zero.

### 3. The guard that passed against the bug it was written for

**Before.** A pixel test for a bright seam where walls meet the floor took its "clean floor" reference luminance from inside the very band it was measuring. The defect's brightness contaminated its own baseline, and the test passed cleanly against the exact pre-fix code it had been written to catch.

**After.** Disjoint windows — reference sampled outside the band, excess luminance summed across the band (`test/visual/render.visual.js:46-62`). Rewritten, it failed on the old code and passed on the fixed code, which is the only sequence that proves anything. The bright-seam defect has shipped twice from two different causes (`:36-39`), so this guard is load-bearing rather than ornamental.

Two details in the rewrite are worth carrying forward. It measures *total excess across the band* rather than a peak ratio, because the peak only moved from 1.10 to 1.26 for one of the two real defects and would have needed a threshold too tight to trust (`:49-55`). And the sibling shadow test asserts its samples are actually on the floor before comparing them (`:84-87`) — without that, a camera drift turns the test into a silent pass instead of a failure. Same principle in a different costume: make the degenerate case loud.

## Related

- [`docs/solutions/logic-errors/minimap-rotation-composition-sign-error.md`](../logic-errors/minimap-rotation-composition-sign-error.md) — the earliest recorded instance of a check that could not fail: its diagonal-fit invariant test passed against both the buggy and the corrected `rotateMapPoint`, because both are magnitude-preserving and it only measured distance from centre. That doc's Prevention section asks for exactly the named, general rule this one states.
- [`docs/solutions/logic-errors/strafe-direction-camera-basis-mismatch.md`](../logic-errors/strafe-direction-camera-basis-mismatch.md) — the counterexample. `window.__debugCameraForward()` measured a dot of about -1 before the fix and about +1 after, so the probe demonstrably could report failure. It is also a probe that graduated into the vetted hook layer this doc argues for.
- [`docs/solutions/logic-errors/bot-obstacle-avoidance-reversal.md`](../logic-errors/bot-obstacle-avoidance-reversal.md) — an ad-hoc probe that did fail loudly (5471 of 5480 deflections reversed), and a case study in why it should have been promoted: that doc records that its measurements exist in no tracked file and cannot be independently re-derived.
- Contrast — [`killfeed-survives-match-restart.md`](../logic-errors/killfeed-survives-match-restart.md) and [`grenade-blast-kill-bypasses-mg-death-strip.md`](../logic-errors/grenade-blast-kill-bypasses-mg-death-strip.md) are coverage gaps: no test existed for the scenario. A coverage audit finds those. It cannot find a probe that runs and reports success — the audit for this class is proving each existing check can go red.
- `learnings/learn-2026-08-08.md` — the retrospective this rule comes out of; it narrates the `__debugTracerCount` and coarse-sampling incidents and states the guard-level version of the rule (L10, L11). This doc's contribution is extending it from regression guards to probes and long-lived hooks.
</content>
