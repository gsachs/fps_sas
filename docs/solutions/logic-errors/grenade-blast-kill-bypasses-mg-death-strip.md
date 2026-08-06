---
title: Grenade blast kills skipped the R13 machine-gun death-strip that gunshot kills correctly applied
date: 2026-08-06
category: logic-errors
module: world
problem_type: logic_error
component: service_object
symptoms:
  - "An entity (bot or player) killed by a grenade blast while holding the machine gun stayed at heldWeapon: 'machinegun' with its remaining ammo intact after death, in violation of R13 ('Death strips the carrier's machine gun and ammo -- bot or player')."
  - "The identical kill delivered by a hitscan gunshot correctly reset heldWeapon to 'pistol' and ammo to null -- the divergence tracked which system produced the kill, not any per-entity state."
  - "None of the 300 existing tests failed, because no test exercised 'kill via grenade blast while carrying the machine gun': U3 (pickup/death-strip) and U4 (grenade/blast) were built and tested as separate units, and neither's suite crossed into the other's kill path."
  - "The death-strip block in src/sim/world.js's per-entity command loop only ran inside the combat branch, gated on the truthy return of that same loop's combat.applyHit(...) call -- grenades.js's detonate() called healthSystem.applyHit(...) directly from grenades.tick(), invoked at world-scope after the per-entity loop, so its hit/kill events never reached that gated branch."
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [armory, death-strip, grenade-blast, machine-gun, cross-system-bug, event-loop-composition, code-review-catch, regression-test]
related_components: [grenades, combat, pickups]
---

# Grenade blast kills skipped the R13 machine-gun death-strip that gunshot kills correctly applied

## Problem

`world.js`'s per-tick `step()` stripped a killed entity's machine gun and ammo (R13) only when the kill came from a hitscan gunshot; a grenade-blast kill on an entity holding the machine gun left `heldWeapon: 'machinegun'` and `ammo` untouched, letting a dead-and-respawning carrier retain a weapon death was supposed to strip.

## Symptoms

- Kill an entity with a gunshot while it holds the machine gun: it correctly ends the tick with `heldWeapon: 'pistol'`, `ammo: null`.
- Kill an otherwise-identical entity, holding the identical `heldWeapon: 'machinegun'`, `ammo: 30`, with a grenade blast instead of a gunshot: it ends the tick still `dead: true` but with `heldWeapon: 'machinegun'`, `ammo: 30` — the strip silently never ran.
- No exception, no console warning, no failing assertion anywhere in either unit's own test suite — the only way to see the discrepancy is to inspect `world.getEntity(victimId)` after a blast kill and compare it against the same inspection after a gunshot kill. Nothing about a blast kill's other visible effects (the `'hit'` event, the `'explosion'` event, `dead: true`, `health` clamped) looks wrong in isolation; only the weapon fields quietly diverge from the gunshot case.
- The discrepancy tracked exactly with which function produced the killing `'hit'` event: `combat.applyHit` called from the per-entity loop's combat branch (gunshot) versus `healthSystem.applyHit` called from inside `grenades.js`'s `detonate()` (blast) — both functions are the same `applyHit`, called with the same signature, returning the same `{ killed: true, ... }` shape, but only one call site fed into the strip check.

## What Didn't Work

Nothing was tried and failed here in the usual "wrong fix attempt" sense — the bug shipped clean the first time each unit was built, and the interesting question is why the codebase's normal safety nets didn't catch the composition gap before a human had to go looking for it by hand.

- **U3's tests (pickups/death-strip) proved gunshot kills strip the MG.** They exercise `world.step()` with a hitscan-only combat system, assert the post-kill entity is back to `heldWeapon: 'pistol'`/`ammo: null`, and pass. They have no reason to ever construct a grenade — grenades didn't exist yet in U3's scope — so there was never an assertion in that suite that could have failed against a blast path.
- **U4's tests (grenade projectile/blast) proved blast mechanics thoroughly** — arc, fuse, wall landing, blast radius, line-of-sight occlusion, linear falloff, self-credit to the thrower — but never asserted anything about the *victim's held weapon* after a blast kill. Asserting that would mean testing R13 (a U3-owned invariant) from inside a U4-scoped test file, and U3 was already complete and reviewed by the time U4 was written; that assertion fell into the gap between "not this unit's job" and "already covered, surely" that neither unit's own scope was positioned to close.
- **The automated multi-agent adversarial/correctness code review (`ce-code-review`) was supposed to be the final gate that caught exactly this shape of cross-unit interaction**, and normally would have — it's designed to trace invariants across unit boundaries rather than trust each unit's own tests. Its dispatch hit the session's API usage quota mid-run: every reviewer subagent failed identically with a session-limit error, so no review output was ever produced, positive or negative.
- **What actually surfaced it**: rather than retry the review blind or ship on the strength of two green, narrowly-scoped test suites, the orchestrating session did the specific trace it had intended to hand to the reviewer — reading `src/sim/world.js`'s `step()` end-to-end and asking, deliberately, "does a grenade-blast kill go through the same death-strip branch a gunshot kill does?" That direct read (not a test run, not a tool) found the inline `if (hitEvent.killed) {...}` block living only inside the per-entity combat branch, with no equivalent anywhere near `grenades.tick()`. It was confirmed with `grep -rn "heldWeapon = 'pistol'" src/`, which turned up three lines — `src/shell/matchEnd.js:51` (unconditional full match reset), `src/sim/world.js:139` (the per-entity combat-branch check, pre-fix), and a same-text default-parameter match in `src/sim/bot/fsm.js:205` (`function sample(..., heldWeapon = 'pistol')`, unrelated to any mutation) — and no hit in `src/sim/grenades.js` at all.

## Solution

The fix is committed as `75f629f` on `main` ("fix: strip a carried machine gun on a blast kill, not just a gunshot kill"), already pushed to `origin/main`. It was written test-first: the regression test below was added and confirmed to fail (`expected 'machinegun' to be 'pistol'`) against the pre-fix code before the production change was made.

**1. Regression test first**, `test/sim/grenades.test.js:395-439` (line numbers as of later additions to this file; unchanged in substance), describe block `'grenades: blast kill strips a carried machine gun, same as a gunshot kill (R13)'`: it drives a real `createWorld()` through `world.step()` — a thrower throws a grenade, the test steps the world until the grenade lands (`grenade.landed`), then adds a `victim` at the blast center holding `heldWeapon: 'machinegun', ammo: 30` with `health: 20`, steps until the fuse detonates and the victim is `dead`, and asserts:

```js
expect(world.getEntity('victim').dead).toBe(true);
expect(world.getEntity('victim').heldWeapon).toBe('pistol');
expect(world.getEntity('victim').ammo).toBeNull();
```

**2. Removed the inline strip from the per-entity loop's combat branch.** Before (per `git show 75f629f`), inside the per-entity loop, immediately after `combat.applyHit(...)`:

```js
if (hitEvent) {
  events.push({ type: 'hit', ...hitEvent });
  if (hitEvent.killed) {
    const target = entityAccessor.getEntity(hitEvent.targetId);
    if (target) {
      target.heldWeapon = 'pistol';
      target.ammo = null;
    }
  }
}
```

After — now just `src/sim/world.js:133` (line number as of the killfeed feature's weapon-field addition; unchanged in substance):

```js
if (hitEvent) events.push({ type: 'hit', ...hitEvent });
```

**3. Added a single pass over every `'hit'` event this tick produced, after both the per-entity combat loop and `grenades.tick()` have run** — `src/sim/world.js:152-170`:

```js
if (grenades) events.push(...grenades.tick(entityAccessor, dt));

// R13: death strips the carrier's machine gun and ammo -- bot or player,
// regardless of damage source. Applied once over every 'hit' event this
// step produced (hitscan, from the per-entity loop above, and blast,
// from grenades.tick() above) rather than inline per source, so a second
// damage path can never silently bypass it the way an inline-only
// version once did. ...
for (const event of events) {
  if (event.type !== 'hit' || !event.killed) continue;
  const target = entityAccessor.getEntity(event.targetId);
  if (target) {
    target.heldWeapon = 'pistol';
    target.ammo = null;
  }
}
```

`grenades.js`'s side was untouched — `detonate()` (`src/sim/grenades.js:92-116`) already pushes standard `{ type: 'hit', ...hitEvent }` events (`src/sim/grenades.js:111`) via the same `healthSystem.applyHit` (`src/sim/grenades.js:104`) that the hitscan path calls; the bug was never in how the blast produced its event, only in where the strip check lived relative to it.

**4.** The new test passes, the full suite (301 tests at the time of the fix) stays green, and `npm run build` completes clean.

## Why This Works

The root cause is that a cross-cutting invariant — "any kill strips the machine gun, no matter what killed the carrier" — was implemented as a side effect embedded inside one specific *producer's* success branch (the per-entity combat loop's `if (hitEvent.killed)`) instead of as a check over the *outcome type* both producers emit. Hitscan and blast damage are two independent call sites for the same `applyHit` function, and both correctly return the same `{ killed: true, targetId, ... }` shape — the event data was never wrong. What was wrong is that only one of the two paths that can produce that outcome had a wire running from "kill event produced" to "strip the weapon." The other path (`grenades.tick()`) ran at world scope, after the per-entity loop had already finished, and its kills simply never crossed the inline check's line of sight.

The fix's shape is the generalizable lesson: when an invariant must hold "regardless of X" — regardless of damage source, regardless of which system produced the event — implement it as a single pass over every occurrence of the outcome type in the shared aggregator (`world.js`'s `events` array, which every producer already contributes its `'hit'` events into by the time `step()` returns), not as inline logic nested inside only one of the paths that can produce that outcome. An aggregator-scoped check is structurally exhaustive over every current *and future* producer of that event type; an inline check nested in one producer is exhaustive only over that one producer, and silently stops being exhaustive the moment a second producer of the same event type is added elsewhere. This project's own plan documents future damage-source candidates (the Armory Loop plan's Scope Boundaries) — any of them, implemented the old way, would have reproduced this exact bug shape. Implemented the new way, none of them can: a third damage source only needs to push a `{ type: 'hit', killed: true, targetId }` event into the same array, and the existing post-loop pass picks it up automatically without being told about the new source at all.

## Prevention

- The regression test, `test/sim/grenades.test.js:392-436` (`describe('grenades: blast kill strips a carried machine gun, same as a gunshot kill (R13)')`), is the concrete guardrail: it drives a real blast kill end-to-end through `world.step()` and asserts the post-kill weapon state, so any future change that reintroduces a source-specific gap in the strip logic fails this test directly.
- **Guardrail rule for this codebase:** when a cross-cutting invariant — kill-time side effects, respawn-time resets, match-reset clears, or anything else that must hold across every code path capable of producing a given event type — needs to hold universally, implement it as a single pass over that event type in the shared aggregator (here, `world.js`'s `events` array, checked with `event.type === 'hit' && event.killed`), not inline inside just one producer of that event. Before adding a new inline side effect gated on a specific call's own result, check whether the same effect needs to hold for *every* producer of that result shape — if so, it belongs in a post-aggregation pass, not the call site.
- **Process lesson:** this plan split the feature into sequential units (U3: pickups/death-strip, U4: grenades/blast) built by separately-scoped sessions, each with tests scoped tightly to its own unit — exactly the setup where an *interaction* between two units' effects (U3's death-strip logic composing correctly, or not, with U4's independently-produced kill events) is invisible to either unit's own suite by construction. Neither U3 nor U4 was ever going to catch this on its own; it needed either an automated cross-unit review pass or, as happened here when that review's quota failed mid-run, a deliberate manual trace of the specific cross-system risk the review was meant to cover. When a plan splits a feature this way, budget for that final integration-level pass explicitly — it is not a redundant formality on top of unit tests, it is the only place this class of bug is visible at all.

## Related Issues

- `docs/solutions/logic-errors/bot-retreat-survives-death.md` is the closest thematic neighbor in this repo's logic-errors set, but the overlap is shallower than it first looks. Both bugs are "a death-adjacent invariant fails to hold in a subset of cases," but structurally they differ on every concrete dimension: `bot-retreat-survives-death.md` is a *single* code path (`transitionBotState`) whose absolute-tick deadline silently desyncs from a per-entity clock that pauses while the bot is dead — there is no second producer that independently "forgot" to enforce anything, just one check computed against the wrong clock domain. This bug is a genuine *two-producer* problem: two independent code paths (the hitscan combat loop and `grenades.tick()`) both emit kill outcomes, and the invariant-enforcing side effect was nested inside only one producer's branch. The fixes are shaped oppositely, too — bot-retreat's fix trusts an already-correct, already-computed per-call value (`armed`) instead of re-testing a stale deadline; this fix hoists a check *out of* a single producer's inline branch to run once, centrally, over the tick's unified event list. No file overlap, no shared solution mechanism, no shared prevention-rule content — but both are examples of an invariant that was correct for the one path it was written against and silently inapplicable the moment a second path came into play without being individually re-checked against it.
- `bot-obstacle-avoidance-reversal.md`, `strafe-direction-camera-basis-mismatch.md`, and `minimap-rotation-composition-sign-error.md` are all vector/coordinate-math sign-and-handedness bugs with no mechanism in common with this one — a logic-placement gap, not a math error — so they're left out here.
- `killfeed-survives-match-restart.md` is the same family — "an invariant held for the paths it was written against but silently didn't extend to a new one" — arriving from the opposite direction. There, the enforcing mechanism (`resetMatch()`'s optional-system-plus-`resetAll()` convention) was already correctly built and already working for two prior systems; the new `killfeed.js` module simply never registered with it. Here, the enforcing mechanism itself was incomplete (the death-strip check lived inline in one producer's branch), so no amount of "remembering to register" could have helped a second producer — the aggregator had to be built. Same family, opposite remedy: that fix is "build the aggregator correctly"; this fix already was the aggregator, and stayed correct without needing to change.
