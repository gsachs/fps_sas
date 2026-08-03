---
title: Bot retreat state survived death, stranding respawned bots fleeing at full health
date: 2026-08-03
category: logic-errors
module: bot-fsm
problem_type: logic_error
component: service_object
symptoms:
  - After almost every bot kill, the respawned bot sprinted away from the player at full health for up to ~3 seconds before re-engaging, instead of fighting immediately.
  - The stranded fleeing was reproducible only for bots that died while already in the "retreat" phase; bots that died while idle, chasing, or attacking respawned and engaged normally, making the bug look intermittent.
  - getPhase() reported "retreat" -- and the bot kept executing flee() movement -- for a freshly respawned, full-health bot, even though retreat is documented as gated on health below RETREAT_HEALTH_THRESHOLD.
  - The leftover fleeing duration varied with how much of the pre-death retreat-duration budget remained unspent at the moment of death, rather than being a fixed post-respawn delay.
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [bot-ai, fsm, retreat-hysteresis, respawn, absolute-tick, dead-entity-skip, code-review-catch, regression-test]
related_components: [bot-steering, command-gathering]
---

# Bot retreat state survived death, stranding respawned bots fleeing at full health

## Problem

`transitionBotState` in `src/sim/bot/fsm.js` drives each bot through `Idle/Patrol -> Chase -> Attack -> Retreat`. Retreat is supposed to last a fixed duration (`RETREAT_DURATION_TICKS = 180`, ~3s at 60Hz — `src/sim/bot/fsm.js:23`) once a bot's health drops below `RETREAT_HEALTH_THRESHOLD = 30` (`src/sim/bot/fsm.js:22`). Instead, after almost every bot kill, the *respawned* bot — always healed to full, since this game has no partial/gradual regen (`src/sim/bot/fsm.js:37-38`) — would sprint away from the player at full health for up to ~3 seconds before it would fight again.

## Symptoms

- A freshly respawned bot flees (does not chase or attack) for up to ~3 seconds at full health, with no in-game reason to be afraid.
- The behavior followed almost every bot kill, not an occasional one — any kill that happened to land while the victim was already in its retreat phase.
- The commit message for the original fix (`8755d58`) documents a concrete repro: a bot killed at tick 110 with `retreatEndTick` budgeted for tick 470 kept fleeing the entire way to tick 470 post-respawn, even though it had already been healed to 100.
- Everything else about death/respawn was correct in isolation — position, health-to-full, other phases (idle/chase/attack) — the bug was scoped entirely to retreat state surviving across the death boundary.

## What Didn't Work

This is a composition bug: neither half of the implicated code is wrong when read on its own.

- Reading `transitionBotState`'s timer logic alone doesn't turn up anything wrong. `retreatEndTick: tick + RETREAT_DURATION_TICKS` (`src/sim/bot/fsm.js:46`) is a completely ordinary "duration budget expressed as an absolute deadline" pattern, and the continuation check against it is correct arithmetic on its own terms.
- Reading the composition root's command-gathering step alone doesn't turn up anything wrong either. `gatherCommands` in `src/main.js:95-106` skips dead entities before asking them for a command (`src/main.js:101`, `if (botEntity && !botEntity.dead) {`) guarding the call to `bot.sample(...)` at `src/main.js:102`. That's the obviously-correct choice — you don't want to invoke an AI decision function for something that isn't currently acting.
- The bug only becomes visible by tracing one specific bot's own `tick` counter (`src/sim/bot/fsm.js:107`, incremented at `src/sim/bot/fsm.js:113` inside `sample()`) across a death-then-respawn boundary — which requires holding both files in mind at once. A self-contained review of either file, or a unit test that never drives a bot through death and back, does not surface it.

## Solution

The fix shipped in two commits that are worth reading as one connected story (`8755d58` then `b74a5d8`, about 18 minutes apart the same day).

**`8755d58`** (the original fix) added a direct, explicit health recheck inside the retreat-continuation branch, ahead of the existing timer check:

```js
if (state.phase === 'retreat') {
  // ...
  if (health >= RETREAT_HEALTH_THRESHOLD) return { phase: 'chase', retreatArmed: armed, retreatEndTick: 0 };
  if (tick < state.retreatEndTick) return { phase: 'retreat', retreatArmed: armed, retreatEndTick: state.retreatEndTick };
  return { phase: 'chase', retreatArmed: armed, retreatEndTick: 0 };
}
```

Reasoning (from the commit message and its inline comment): this game has no gradual health regen, only a full heal on respawn, so health being back at or above the retreat threshold *while still in the retreat phase* can only mean "just respawned" — there is no other path to that combination. Exiting immediately on that signal, rather than trusting the stale `retreatEndTick`, closes the bug regardless of how far the tick counter drifted during death.

**`b74a5d8`** (a later cleanup/simplify pass — described in its commit message as a follow-up over 11 code-review fix commits from 4 parallel reviewers) noticed that the reducer already computes an `armed` boolean earlier in the same function, for a different original purpose, and that `8755d58`'s new health recheck was provably redundant with it. It collapsed the two checks into one. This is the code as it stands today, `src/sim/bot/fsm.js:41-74`:

```js
export function transitionBotState(state, sensors, tick) {
  const { distanceToPlayer, hasLineOfSight, health } = sensors;
  const armed = health >= RETREAT_HEALTH_THRESHOLD ? true : state.retreatArmed;

  if (armed && health < RETREAT_HEALTH_THRESHOLD && state.phase !== 'retreat') {
    return { phase: 'retreat', retreatArmed: false, retreatEndTick: tick + RETREAT_DURATION_TICKS };
  }
  if (state.phase === 'retreat') {
    // Stay in retreat only while still unarmed (health hasn't recovered)
    // and the timer hasn't run out. `armed` already means "health is back
    // at or above the threshold" (per the ternary above), so this reuses
    // that latch instead of re-testing health -- and, since this game has
    // no health regen (only a full heal on respawn), armed-while-retreating
    // uniquely means "just respawned": exit immediately rather than
    // serving out a retreat window budgeted for the bot that died, not the
    // fresh one that just spawned in. Without this, a bot that died
    // mid-retreat resumed fleeing at full health for however much of the
    // window remained (gatherCommands gives a dead bot no command, so this
    // reducer isn't called and `tick` doesn't advance while dead, but
    // retreatEndTick is an absolute tick value).
    if (!armed && tick < state.retreatEndTick) {
      return { phase: 'retreat', retreatArmed: armed, retreatEndTick: state.retreatEndTick };
    }
    return { phase: 'chase', retreatArmed: armed, retreatEndTick: 0 };
  }

  if (hasLineOfSight && distanceToPlayer <= ATTACK_RANGE) {
    return { phase: 'attack', retreatArmed: armed, retreatEndTick: 0 };
  }
  if (hasLineOfSight || distanceToPlayer <= AWARENESS_RANGE) {
    return { phase: 'chase', retreatArmed: armed, retreatEndTick: 0 };
  }
  return { phase: 'idle', retreatArmed: armed, retreatEndTick: 0 };
}
```

One latch (`armed`, computed at `src/sim/bot/fsm.js:43`) now serves both jobs — the original re-trigger-prevention hysteresis *and* the death/respawn exit — and the duplicated `{ phase: 'chase', ... }` return literal that existed across two branches in the `8755d58` form collapsed into the single one at `src/sim/bot/fsm.js:64`.

## Why This Works

**The root mechanism.** `RETREAT_DURATION_TICKS` is a duration *budget*, but `tick + RETREAT_DURATION_TICKS` (`src/sim/bot/fsm.js:46`) bakes it into an absolute deadline measured on the bot's own `tick` counter. That counter only advances inside `sample()` (`src/sim/bot/fsm.js:113`), which is only ever invoked from `gatherCommands`, which explicitly (and correctly) skips dead entities (`src/main.js:100-103`). So the clock the deadline is checked against is not the same clock the budget was meant to measure: real match time (the respawn timer, other live entities' own ticks) keeps moving while this one bot is dead, but its personal `tick` counter simply stops. Nothing re-validates the deadline against elapsed real time — it's compared only against the bot's own frozen-then-resumed counter, which silently understates how much time has actually passed. Neither the duration-budget pattern nor the dead-entity skip is wrong; the bug lives entirely in the interaction between an absolute deadline and a per-entity clock that can be paused independently of the clock it was measured against.

**Why reusing `armed` loses no correctness.** `armed` is computed fresh on every call from that call's own live `health` reading (`src/sim/bot/fsm.js:43`): `health >= RETREAT_HEALTH_THRESHOLD ? true : state.retreatArmed`. Trace every place `retreatArmed` gets written and read:

- The retreat-entry branch (`src/sim/bot/fsm.js:45-47`) can only be reached when its own guard requires `health < RETREAT_HEALTH_THRESHOLD` for *that same call*, and it hardcodes `retreatArmed: false` in the state it returns — which trivially agrees with a direct `health >= RETREAT_HEALTH_THRESHOLD` check performed with that same call's health, since health is known low right there.
- Every other return site in the function (the continuation branch at `fsm.js:62` and `fsm.js:64`, and the non-retreat branches at `fsm.js:68`, `fsm.js:71`, `fsm.js:73`) stores exactly the `armed` value that was just computed at the top of *that same call*, never some other stale value.
- So the incoming `state.retreatArmed` seen by any call was itself set by a previous call's own live-health computation, and by induction stays in lockstep with "health was at/above threshold as of the last time this function ran for this bot."

The key point for the death/respawn boundary specifically: when a bot comes back from being dead, its first post-respawn call passes freshly-queried health (100, from the full heal) into the ternary at `fsm.js:43`, which takes the `true` branch *unconditionally* — it does not consult the frozen `state.retreatArmed` at all in that case. So `armed`'s correctness never depends on how many calls were skipped while the bot was dead; it is re-derived from scratch, live, the moment the bot is ticked again. That's precisely why trusting `armed` (`!armed && tick < state.retreatEndTick`, `fsm.js:61`) instead of re-testing `health >= RETREAT_HEALTH_THRESHOLD` directly is safe: at the point the retreat-continuation branch runs, the two are provably never in disagreement, so the second, independent comparison that `8755d58` added was redundant — just expressed as a fresh comparison instead of reusing the first.

## Prevention

- `test/sim/botAI.test.js:143-155`, **"exits retreat immediately once health is back to full, without waiting out the timer (regression)"** — constructs `{ phase: 'retreat', retreatArmed: false, retreatEndTick: 100_000 }` (a far-future deadline standing in for a large unspent budget) with `health: 100`, and asserts `next.phase` is not `'retreat'`. This is the direct regression test for the bug: it proves the fix does not depend on how much of the timer window is left, only on whether health is back up.
- `test/sim/botAI.test.js:157-173`, **"trusts the armed latch over a direct health check (documented invariant)"** — constructs a state the reducer's own transitions can never actually produce (`{ phase: 'retreat', retreatArmed: true, retreatEndTick: 500 }` paired with `health: 10`, which violates the invariant proven above) and asserts the *deliberate* current behavior: it still exits to `'chase'`, because the guard trusts `armed` rather than re-deriving health. This pins the `b74a5d8` refactor's trust boundary as an intentional, tested decision rather than an accidental gap.
- The other three tests in the same `describe('retreat hysteresis (no health regen in this game)', ...)` block (`test/sim/botAI.test.js:106-174`) round out the behavior this fix must not break: `test/sim/botAI.test.js:107-116` ("enters retreat on a fresh drop below the health threshold") proves normal entry still works; `test/sim/botAI.test.js:118-129` ("does NOT re-enter retreat the instant the timer expires while health is still low") proves the original hysteresis purpose of the latch (preventing one-tick flicker back into retreat once the timer runs out while health is still low) survived the refactor; `test/sim/botAI.test.js:131-141` ("re-arms retreat once health recovers (post-respawn), allowing a fresh trigger") proves a respawned bot can legitimately retreat again on a fresh health drop rather than being permanently disarmed.

**Generalizable guardrail.** Any state machine with a "this phase lasts until tick X" (absolute-deadline) design, where the entity driving the tick counter can be paused, skipped, or frozen (dead, disabled, off-screen, rate-limited, etc.), needs one of:

1. A test that specifically drives the entity through a pause-then-resume cycle and checks the deadline still behaves sanely — `test/sim/botAI.test.js:143-155` above is exactly this shape for this bug (it stands in for "died with the timer far from expired, respawned" without needing an actual full death/respawn integration test).
2. Reconsidering whether a live countdown/remaining-duration value — recomputed or decremented only while the entity is actually being ticked, and carried unchanged through any freeze — would avoid the whole class of bug rather than requiring a recheck. Note that the fix actually shipped here (option 1 above, plus the `armed` short-circuit) is a targeted fix that leans on a game-specific invariant (no gradual regen, so "healthy while retreating" uniquely means "just respawned"); it does not restructure `retreatEndTick` itself. A game with gradual regen would not have this escape hatch and would need the countdown-representation fix instead — worth naming explicitly as the tradeoff this codebase made.

A reusable shape for the "documented invariant" test pattern demonstrated at `test/sim/botAI.test.js:157-173`, applicable beyond this bug: when a reducer's correctness relies on an invariant it establishes for itself across normal transitions (rather than one enforced by a type system or external validation), write a test that constructs a synthetic state violating that invariant directly — bypassing the transitions that would normally guarantee it — and assert the reducer's actual, deliberate behavior when handed that impossible input. This documents the trust boundary as intentional (and will flag it loudly if a future refactor changes what the reducer assumes) rather than leaving it as an implicit, unverified assumption:

```js
it('trusts <invariant-carrying field> over re-deriving it (documented invariant)', () => {
  // <field> is normally kept in sync with <source> by every real transition;
  // construct a state where they disagree, which no real call sequence
  // can produce, and pin the reducer's current (deliberate) behavior.
  const invariantViolatingState = { /* ...normal fields, but with the invariant broken... */ };
  const next = reducer(invariantViolatingState, /* ...sensors that would disagree with the stale field... */);
  expect(next /* ... */).toBe(/* whatever the reducer actually does when it trusts the field */);
});
```

## Related Issues

- `b74a5d8` is a broader cleanup pass (per its own commit message: a follow-up over 11 code-review fix commits from 4 parallel reviewers) touching several files beyond `src/sim/bot/fsm.js`. This document covers only its `src/sim/bot/fsm.js` hunk; its other changes are unrelated to this bug and out of scope here.
- `src/sim/bot/fsm.js:1-8`'s module comment notes `transitionBotState` "mirrors shell/states.js's transition() shape, but over a continuous sensor bundle rather than a discrete event" — relevant background for anyone comparing this reducer's conventions against that sibling module.
- `docs/solutions/logic-errors/bot-obstacle-avoidance-reversal.md` documents a different bug in the same bot-AI subsystem, found in the same code-review pass (`src/sim/bot/steering.js`'s obstacle-avoidance deflection reversing bots into cover). No overlap in problem, root cause, or fix — a vector-math sign error versus this doc's clock-domain/stale-deadline bug — but that doc's own "Related Issues" section currently explains this bug's mechanism inline rather than pointing here; it should be updated to reference this doc directly now that one exists.
