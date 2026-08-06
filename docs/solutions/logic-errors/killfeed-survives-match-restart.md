---
title: Killfeed entries survived a match restart because the new module was never wired into resetMatch's existing reset convention
date: 2026-08-06
category: logic-errors
module: killfeed
problem_type: logic_error
component: service_object
symptoms:
  - "A killfeed entry from a kill in the previous match (for example, a 'You' vs 'Bot 1' line) stayed visible, frozen in place, through the entire RESULTS/PAUSED screen after the match ended, because killfeed.update()'s aging logic only runs from the per-frame render loop in src/main.js while simRunning is true."
  - "Clicking Play Again / Restart Match transitioned the match back to PLAYING and resumed aging on the stale entry from wherever it had been left, so the new match visibly opened showing a kill line from a fight in the previous match for up to the entry's remaining lifetime (a few seconds) of new-match play."
  - "None of the 316 (later 318) existing automated tests caught it: every killfeed test in test/ui/killfeed.test.js drives formatEntry/addEntry/ageEntries directly with no match-restart scenario, and test/shell/matchEnd.test.js had no case exercising resetMatch with a killfeed system attached, since killfeed.js did not exist yet when the pickupSystem/grenadeSystem resetAll convention was established in resetMatch."
  - "resetMatch(entityAccessor, { ..., pickupSystem, grenadeSystem }) already had a working, established convention for exactly this reset -- calling pickupSystem.resetAll() and grenadeSystem.resetAll() when those optional systems were supplied -- but killfeed was simply never added as one of those optional systems when it was built."
root_cause: missing_workflow_step
resolution_type: code_fix
severity: medium
tags: [killfeed, match-restart, reset-hook, stale-ui-state, reset-match-convention, code-review-catch, playwright-verification]
related_components: [match-end, pickup-system, grenade-system, hud]
---

# Killfeed entries survived a match restart because the new module was never wired into resetMatch's existing reset convention

## Problem

The killfeed HUD's `entries` array had no reset hook and was never wired into `resetMatch()`, so a kill line from the match that had just ended stayed frozen in the feed through the results screen and reappeared, unchanged, at the start of the next match — narrating a fight from the previous game as if it belonged to the new one.

## Symptoms

- After clicking "Play Again" (or "Restart Match"), the killfeed opens the new match already showing a kill line — correctly formatted and correctly colored (gold if the local player was the shooter) — for a fight that happened before the restart.
- The stale line behaves exactly like a real new-match kill: it sits in the feed and ages/dims/expires normally for up to `ENTRY_LIFETIME_SECONDS` (5s) of real new-match play, then disappears, indistinguishable from a genuine kill except that it references entities/timing from the prior match.
- The line is visible on the results screen too, frozen with no countdown, for however long the results screen is shown — this part is correct, expected behavior (the feed is meant to freeze in non-`PLAYING` states) and is not itself the bug; the bug is that it survives the *transition back into* `PLAYING` instead of being cleared.
- No console error, no failing assertion, no visual glitch — the formatting, color, and DOM update are all working exactly as designed against stale data.

## What Didn't Work

There was no failed fix attempt here — `killfeed.js` shipped clean and its own test suite (`test/ui/killfeed.test.js`) was, and still is, fully green. The relevant question is why 316 passing tests, plus the codebase's established testing convention, didn't surface this before a reviewer had to go find it by hand.

- **`killfeed.test.js` exercises only the pure formatter/aging functions, by deliberate design.** `formatEntry`, `addEntry`, and `ageEntries` are exported as DOM-free pure functions specifically so cap/dim/expiry-boundary regressions can be unit-tested without a DOM (KTD1 in the killfeed plan) — the same convention `src/ui/hud.js` and `src/shell/states.js` already follow. That convention is correct for what it covers, but it also means the DOM-mount/wiring code in `createKillfeed()` — including whatever hooks it does or doesn't expose to callers — is out of scope for that suite by construction. No amount of exercising `ageEntries` in isolation could ever reveal that the object `createKillfeed()` returns has no reset hook, because the object it returns isn't something that test file ever inspects.
- **`test/shell/matchEnd.test.js` had a proven convention for optional match-scoped systems, but no test exercising it with a killfeed.** `pickupSystem` already had exactly this shape of coverage there — a fake `{ resetAll: () => { resetAllCalls += 1; } }` and an assertion that `resetMatch` calls it exactly once (`test/shell/matchEnd.test.js:116`). `grenadeSystem`'s `resetAll()` is instead covered behaviorally, in `test/sim/grenades.test.js`, with a real `createGrenadeSystem()` instance and an assertion that `resetMatch` actually clears its in-flight grenades — not a fake counter. Either way, killfeed didn't exist yet when both of those tests were written and reviewed, and once it was built, nothing in `matchEnd.test.js`'s existing tests could fail to reflect its absence, because none of them ever passed a `killfeed` option in the first place — there was nothing to assert against.
- **No test anywhere drives a full match-lifecycle integration** — freeze the feed through a state transition out of `PLAYING`, then transition back in and check what's still showing — because that scenario doesn't belong to either file's scope: it's not a pure-formatter concern (`killfeed.test.js`) and it's not a `resetMatch`-argument-shape concern unless a `killfeed` option is actually supplied (`matchEnd.test.js`). The gap sat exactly between two suites that were each internally consistent and green.
- **What actually found it** was not a test run but a scenario-construction step: an independently dispatched adversarial-reviewer subagent (part of `ce-code-review`, run over the killfeed diff after both implementation units landed) deliberately asked "what happens to this new stateful system across a match restart?" — the same category of question its persona brief poses as "timing abuse... between cache invalidation and repopulation," generalized to a game-restart analog. It traced that `createKillfeed()`'s returned object (`return { addKill, update };`, pre-fix) exposed no reset/clear hook, while every other match-scoped stateful system in the codebase (`pickupSystem`, `grenadeSystem`, bot AI via `botEntry.bot.reset()`) does and is wired into `resetMatch()` or `onRestart`. It filed this as a P1 finding (confidence 100) citing `src/ui/killfeed.js:101` as first evidence. Five other reviewer personas run in parallel on the same diff (correctness, testing, maintainability, learnings-researcher, performance) did not surface it — a reviewer checking "is this code correct in isolation" would see `addEntry`/`ageEntries`/cap/dim/expire fully and correctly unit-tested and have no reason to go looking for a missing cross-lifecycle hook.
- The finding was then confirmed live, not just by inspection: a headless Playwright script drove the real running game through `?debug` hooks — forced `PLAYING`, produced a genuine kill through the real `weapon.js` → `health.js` → `world.js` → `main.js` → `killfeed.addKill()` path, confirmed a gold kill line, forced match-end via a debug score-setting hook, confirmed the frozen line was still showing on the results screen (correct), clicked the real "Play Again" button, forced `PLAYING` again, and read the DOM: the same stale line was still there. Re-run after the fix, the same script's final read showed an empty feed.

## Solution

Fixed on local `main` as commit `c9a1300` (not yet pushed to `origin/main` as of this writing — this repo commits directly to `main` with no PR workflow, so the fix is not "pending" in the review sense, only unpushed; the SHA is stable unless the local commit is later amended or rebased). This commit also folds in an unrelated DOM-row-caching refactor to `killfeed.js`'s `render()` and a `LOCAL_PLAYER_ID` de-duplication across `main.js`/`states.js`/`names.js`, per its own message, but the pieces relevant to this bug are the four described below.

**1. `src/ui/killfeed.js`** — `createKillfeed()` gained an exported `resetAll()` and returns it alongside the existing functions. Before the fix the function returned only `{ addKill, update }` (this is the exact object the adversarial reviewer cited at `src/ui/killfeed.js:101`, pre-fix, as evidence no reset hook existed). After the fix, `src/ui/killfeed.js:111-119`:

```js
// R13-style match reset (mirrors grenadeSystem.resetAll()/pickupSystem.resetAll()):
// clears every entry so a new match opens with an empty feed instead of the
// previous match's frozen lines bleeding through pause/results and into play.
function resetAll() {
  entries = [];
  render();
}

return { addKill, update, resetAll };
```

**2. `src/shell/matchEnd.js`** — `resetMatch()`'s destructured options gained `killfeed` as a new optional parameter, guarded and called the same way as its two existing siblings, `src/shell/matchEnd.js:33-39`:

```js
export function resetMatch(
  entityAccessor,
  { rapierWorld, spawnPoints, movementSystem, healthSystem, pickupSystem, grenadeSystem, killfeed }
) {
  if (pickupSystem) pickupSystem.resetAll();
  if (grenadeSystem) grenadeSystem.resetAll();
  if (killfeed) killfeed.resetAll();
```

**3. `src/main.js`** — the `onRestart` callback's existing `resetMatch(sim.world, {...})` call site gained `killfeed` in its options object, `src/main.js:277-286`:

```js
onRestart: () => {
  resetMatch(sim.world, {
    rapierWorld: arena.rapierWorld,
    spawnPoints: arena.spawnPoints,
    movementSystem,
    healthSystem,
    pickupSystem,
    grenadeSystem,
    killfeed,
  });
```

The `killfeed` const itself already existed (`const killfeed = createKillfeed(app);` at `src/main.js:70`, present since the feature was first built, and already consumed each frame at `src/main.js:541` (`if (event.type === 'hit') killfeed.addKill(event);`) and `src/main.js:586` (`killfeed.update(delta);`)) — only the reset-wiring at the `onRestart` call site was missing, not the object or its per-frame usage.

**4. `test/shell/matchEnd.test.js:132-145`** — new regression test, placed immediately before the existing `it('still resets health/dead/score/position without a pickupSystem (back-compat)', ...)` test, mirroring the pickupSystem test's exact shape:

```js
it('clears the killfeed on restart, so a new match opens with an empty feed', () => {
  const entities = [makeEntity('a', 0)];
  const accessor = createFakeEntityAccessor(entities);
  const rapierWorld = buildFlatRapierWorld();
  const spawnPoints = [{ x: 10, y: 1, z: 10 }];
  const movementSystem = { teleport: () => {} };
  const healthSystem = { clearRespawnTimer: () => {} };
  let resetAllCalls = 0;
  const killfeed = { resetAll: () => { resetAllCalls += 1; } };

  resetMatch(accessor, { rapierWorld, spawnPoints, movementSystem, healthSystem, killfeed });

  expect(resetAllCalls).toBe(1);
});
```

Full suite (318 tests after this addition) passes; `npm run build` is clean; the Playwright script re-run after the fix confirmed the empty feed live, as described above.

## Why This Works

The root cause is not that `resetMatch()`'s extensibility mechanism was wrong — it is that a new component never registered with it. `resetMatch()` already had a correctly designed, already-proven convention for match-scoped stateful systems: accept the system as an optional parameter, guard on its presence (so callers that predate it keep working, per the function's own doc comment), and call a `resetAll()` it exposes. `pickupSystem` and `grenadeSystem` both already used this convention successfully. `killfeed.js` was simply built later, as its own closure-owned module with its own `entries` array and its own per-frame `update(dt)`, and its author never took the step of exposing a `resetAll()` and adding it to that already-established options object — not because the convention couldn't accommodate a third system, but because nothing forced the new component to join it.

This is worth naming precisely because it is a different shape of bug than `docs/solutions/logic-errors/grenade-blast-kill-bypasses-mg-death-strip.md`, even though both are "a cross-cutting concern silently didn't apply to something new." That bug's fix was *structural*: the death-strip invariant had been embedded inline inside one producer's success branch (the per-entity combat loop's `if (hitEvent.killed)`), so a second, independent producer of the same outcome (`grenades.tick()`) had no path to it at all — the aggregator that should have unified both producers' kill events didn't exist yet in the right place, and the fix built one (a single post-loop pass over the shared `events` array). This bug's fix is *additive registration*: `resetMatch()`'s options-object aggregator already existed, already worked, and needed zero restructuring — the fix is one more optional parameter, one guarded call, and one thread-through at the `onRestart` call site, exactly mirroring two systems that already used it correctly. The lesson here isn't "cross-cutting invariants need a shared aggregator" (that lesson was already learned and already applied correctly to `resetMatch`); it's "an already-correct extensibility point does nothing for a new component that never plugs into it" — the gap was in the killfeed module's own build step, not in `resetMatch`'s design.

## Prevention

- The regression test at `test/shell/matchEnd.test.js:132-145` is the concrete guardrail: it drives `resetMatch()` with a fake `killfeed` and asserts `resetAll()` is called exactly once, so any future change that drops or breaks that wiring fails this test directly.
- **Checklist rule for this codebase:** any new stateful, match-scoped system — anything that accumulates or mutates state across frames and must not survive a match boundary (killfeed's `entries`, pickup respawn state, in-flight grenades, bot AI memory) — needs a `resetAll()`/`reset()` export wired into `resetMatch()` (or the relevant `onRestart` path in `main.js`) as part of building the system, not as a follow-up. If it exposes per-frame `update(dt)`-style state the way `killfeed.js`, `pickupSystem`, and `grenadeSystem` all do, ask "what does this look like immediately after Play Again?" before considering the module done.
- This class of gap is invisible to unit tests scoped to the new system alone: `killfeed.test.js`'s pure-function tests, by the same KTD1 convention that makes them fast and DOM-free, structurally cannot see whether the module's returned object has a reset hook, because they never construct or inspect that object. Catching it requires either extending the match-lifecycle suite (`matchEnd.test.js`) to cover the new system the moment it's threaded into `resetMatch`, as this fix now does, or a review pass that explicitly asks the cross-lifecycle question — "does this survive a restart the way its siblings do?" — for every new match-scoped system, the same question the adversarial-reviewer persona asked here.

## Related Issues

- `docs/solutions/logic-errors/grenade-blast-kill-bypasses-mg-death-strip.md` is the closest relative: both bugs are "a cross-cutting/lifecycle concern that held for the code paths it was written against, and silently didn't extend to a new one." Where they differ is the state of the mechanism that was supposed to enforce the concern universally. In the grenade-blast bug, the enforcing mechanism itself was incomplete — the death-strip check lived inline inside a single producer's branch, so there was no shared aggregator a second producer could join even if someone had thought to try, and the fix had to build one (hoist the check into a post-loop pass over `world.js`'s shared `events` array). In this bug, the enforcing mechanism — `resetMatch()`'s optional-system-plus-guarded-call convention — was already correctly built and already working for two prior systems (`pickupSystem`, `grenadeSystem`); the failure was that killfeed simply never registered with an extension point that was fully capable of accommodating it. Same family of bug, opposite remedy: the grenade-blast fix is "build the aggregator correctly"; this fix is "register the new component with an aggregator that was already correct."
- `bot-obstacle-avoidance-reversal.md`, `strafe-direction-camera-basis-mismatch.md`, and `minimap-rotation-composition-sign-error.md` are unrelated vector/coordinate sign-and-handedness bugs with no mechanism in common with this one, so they're left out here.
