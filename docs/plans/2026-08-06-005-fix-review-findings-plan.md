# Fix: whole-repo code review findings

Source: `ce-code-review` over the entire repository at `main` @ `a3d2d21`, 2026-08-06.
Nine reviewers; 15 findings, all independently validated. Zero dropped as false positives.

This document is the definition of what to fix. `/goal` drives it.

## Definition of done

The loop ends when a fresh whole-repo `ce-code-review` returns **no P0, P1, or P2 finding**, and:

- `npm test` passes in full.
- Every P3 and advisory item from that final review is either fixed or listed in "Accepted" below with a one-line reason.
- Every fix landed with a test that fails before it and passes after.

"No issues remain" is not literally reachable — a review can always surface a fresh P3 or an advisory observation. P0/P1/P2-clean is the terminating condition; P3/advisory is a decision, not a blocker.

## Work units

Fix in this order. Each unit is one commit. Do not batch units.

### U1 — Arena geometry hole (finding #1, P1) — DONE (a52a7a5)

`src/arena/layout.js:209-210, 215-216`

South and west spoke corridors emit **zero** wall geometry. Both Rapier colliders and rendered meshes are missing, since both read `LAYOUT.walls`. A player leaving the central room south or west walks into the void and can see and shoot across it.

Cause: an extra negation. `sw.z` is already `-26`, so `-(sw.z - DOOR_HALF)` is `+27.5` while the run's `to` is `-10`. `splitAroundGaps` hits `cursor < to` with `27.5 < -10` and silently returns `[]`.

- Use `sw.z + DOOR_HALF` in both spoke-south runs and `sw.x + DOOR_HALF` in both spoke-west runs. This mirrors the working spoke-north entry exactly.
- Make `splitAroundGaps` throw on `from >= to`. A reversed run must never silently emit nothing again.
- **Test first:** assert every space id named in `DOORWAYS.connects` owns at least one wall. `test/arena/layout.test.js` currently asserts wall *ownership* (every wall names a real space) but never the converse — that asymmetry is why this shipped with the suite green.

### U2 — Match restart wiring (findings #3, #5 — P1, P1) — DONE (84806a1)

`src/shell/states.js:125` and `:132`

`returnButtonFromResults` dispatches `returnToStart` without calling `onRestart()`, so scores stay at or above `KILLS_TO_WIN`. Click "Return to Start" then "Click to Play" and `checkMatchEnd` fires on the first frame — the start screen is a dead end that can never begin a new match. `returnButtonFromPause` has the same gap: it silently resumes an in-progress match from a screen that reads as fresh.

`createGameShell` has zero test coverage. `test/shell/states.test.js` covers only the pure `transition()` and `formatResultsEntry`. This is the same failure mode as `docs/solutions/logic-errors/killfeed-survives-match-restart.md`: orchestrator wiring around a tested pure function, itself untested.

- Call `onRestart()` before dispatching in **both** `returnToStart` handlers, matching `playAgainButton` / `restartButton` at `:113-124`.
- **Test first:** a jsdom test constructing `createGameShell({ container, lockElement, onRestart })` that asserts the heading for a player-leading and a player-trailing leaderboard, the "leaderboard omitted the player" fallback at `:142-146`, and that each of the four buttons calls `onRestart` exactly where it should.

Fix and test land together. The test is the point of the unit, not a follow-up.

### U3 — Startup failure path (finding #2, P1) — DONE (2f5c044)

`src/main.js:35`

Top-level `await RAPIER.init()` has no failure path. A blocked WASM fetch, a restrictive CSP, or an environment that cannot instantiate it throws before any other module-level code runs. `index.html` has no fallback content, so the player gets a permanent black screen with only an unhandled rejection in the console.

Every other async load in this same file — bot model, weapon model, gunshot audio — uses an `onError` callback plus a non-blocking fallback. This is the one external call in `main.js` not held to the app's own convention, or to `CLAUDE.md`'s "design for failure on every external call".

- Wrap in `try`/`catch` and render a visible failure message into `#app`, matching the screen-rendering pattern in `shell/states.js`.

### U4 — Corpse semantics (findings #4, #6 — P1, P2) — DONE (9208c94)

**Decision:** corpse absent from physics (not present-but-non-targetable).

**Landmine hit during implementation, not predicted by the plan:** `Collider.setEnabled(false)` does **not** exclude a kinematic character's collider from `castRay` in this Rapier build (`rapier3d-compat` 0.19.3) -- verified empirically: `isEnabled()` correctly reports `false`, but `castRay` still hits it, even after `world.step()`. The fallback the plan named ahead of time -- reuse `main.js`'s `PARK_POSITION` teleport idiom -- is what actually shipped. `health.js` now has its own `CORPSE_PARK_POSITION` and teleports the corpse's physics body there on death; `tickRespawns`'s existing `movementSystem.teleport(entityId, spawn)` call pulls it back on respawn, no separate re-enable needed.

`src/sim/health.js:42` and `src/main.js:132`

The sim treats a dead entity as live in two ways:

- **#4:** for the full 3s respawn delay a corpse stays in the physics world as a solid capsule while its mesh is hidden. Shots aimed through the death spot vanish; anyone behind a corpse is invisible to line-of-sight sensing and safe from fire. It also poisons spawn safety — `selectSpawnPoint` can rate a point "hidden from every enemy" purely because a corpse blocks the ray, then the corpse vanishes and the entity spawns in the open.
- **#6:** every bot keeps targeting the corpse — closing on the death spot and firing into it for three seconds, then searching it after the player has respawned elsewhere. `gatherCommands` guards the *bot's* liveness but reads the player's position unconditionally, and the FSM's acquisition sensor has no liveness input.

**Stop here and ask.** Both are symptoms of one unmade decision: what is a corpse during the respawn window — absent from the world, or present but non-targetable? Fixing them independently risks two inconsistent notions of "dead". Do not guess.

Proposed default once the decision is made:
- #4: add `setCharacterEnabled(entityId, enabled)` to `movementSystem` wrapping `collider.setEnabled`; call `false` in the death branch at `health.js:40-46` and `true` in `tickRespawns` at `:76`. If `rapier3d-compat` 0.19 does not expose `Collider.setEnabled`, reuse the `PARK_POSITION` idiom `main.js` already applies to un-ramped bots.
- #6: add a `targetAlive` argument to `createBotAI(...).sample` at `fsm.js:205`, pass `!playerEntity.dead` from `main.js:137`, and AND it into `fsm.js:127`. Thread liveness — do not pass a null position (`CLAUDE.md`: never pass null).

**Test first:** kill B between A and C, assert A's shot reaches C. Construct a dead target and assert the bot FSM does not hold `attack`.

### U5 — Input state across pause and blur (findings #7, #14 — P2, P2) — DONE (95ce35a)

`src/main.js:427-428`

Two leaks through one root cause: document-level key listeners are neither pointer-lock-gated nor cleared on focus loss. The mouse already has both treatments at `main.js:414-426`; the keyboard has neither.

- **#7:** pressing G while paused, at the start screen, or on results queues a live throw that fires on resume. The latch is an uncapped `pending += 1` counter (`sim/command.js:28-30`), so a few taps dump the whole grenade pocket over consecutive ticks. Gate `keydown` on `document.pointerLockElement === renderer.domElement`. Leave `keyup` ungated, mirroring the documented `mouseup` rationale at `:419-423`.
- **#14:** alt-tab while holding W and no keyup ever arrives, so `'KeyW'` stays in the sampler's key set and the character auto-walks on resume. Expose `clearHeldInput()` from `createInputSampler` and wire `window.addEventListener('blur', ...)`.

**Test first:** no test covers input-sampler state across a pause or blur boundary at all. Add one that does.

### U6 — Grenade sticks to bodies (finding #9, P2) — DONE (fe2b7e0)

`src/sim/grenades.js:151-167`

A grenade thrown at an enemy stops dead against their capsule at chest height and floats there for the rest of its two-second fuse while they walk away. The sweep is documented as detecting *wall* contact, but its raycast excludes only the thrower's collider, so every character capsule is treated as terrain.

- After the `castRay` at `:151`, treat the hit as terrain only when `movementSystem.getEntityIdForCollider(hit.collider) === undefined`; otherwise continue the arc.
- Assumption named: grenades pass through bodies rather than sticking, matching the module's own "wall contact" framing at `:5-6`. If the intended behaviour is stick-to-body, say so and this unit becomes a comment fix instead.
- **Test first:** `test/sim/grenades.test.js` never throws a grenade at an entity. Add that case.

### U7 — Player diagonal speed (finding #12, P2) — DONE (a902a0b)

`src/input/sampler.js:69-72`

W+D moves the player at ~5.66 units/sec versus 4.0 for W alone — the sampler emits `moveX`/`moveZ` as independent ±1 values and `movement.js` composes them onto an orthonormal basis without renormalising. Bots are unaffected, since `fsm.js` projects an already-normalised direction. The result is a player-vs-bot asymmetry any player finds by strafe-walking, and it silently invalidates `MOVE_SPEED` as the game's real top speed.

- Clamp in `sample()` before building the Command: `const length = Math.hypot(moveX, moveZ); if (length > 1) { moveX /= length; moveZ /= length; }`. Clamping in the sampler leaves already-unit-length bot commands untouched.
- **Test first:** `test/input/sampler.test.js` asserts W+D yields `moveZ 1 / moveX 1` but never asserts the resulting speed. Assert the speed.

### U8 — Error-handling invariants (findings #8, #11 — P2, P2) — DONE (221ebe8)

Two `CLAUDE.md` invariant violations on external-call failure paths.

- **#8 `src/render/models.js:33, :45`** — both loaders resolve to a literal `null`. Both current call sites guard correctly, so nothing breaks today, but any future caller that omits the falsy check crashes destructuring `{ scene, animations }` off null. Return `{ scene: null, animations: [], loaded: false }` and check `result.loaded` at `main.js:185` and `:219`. ("Never return null.")
- **#11 `src/audio/gunshots.js:199`** — `setRunning` runs every animation frame once unlocked. If the context stays suspended under Chrome's auto-suspend policy, the code issues a fresh `resume()`, it rejects, and `.catch(() => {})` discards the error, forever, at up to 60 calls/second. The player loses all audio for the session with no diagnostic signal. Track a `resumeFailed` flag set in the `.catch()`, log through the same `onError`-style callback the module already accepts for buffer loads, and clear it only on a fresh `unlock()` from a user gesture. ("No swallowed exceptions"; "design for failure on every external call".)

`test/render/models.test.js` covers only `disposeObject3D` — the loaders have zero coverage in either direction. Add it.

### U9 — Knowledge duplication and conventions (findings #10, #13, #16 — P2, P2, P3) — #10, #13 DONE (980f146); #16 (P3) deferred

Structural only. **This unit contains no behavioral change — commit it separately** (`CLAUDE.md`: never mix structural and behavioral changes in the same commit).

**#16 was out of scope for the P1/P2 remediation pass and was not fixed.** It remains open for a future round.

- **#10 `src/sim/world.js:33`** — `DEFAULT_WEAPON_ID` is exported from `sim/weapon.js` and correctly reused by `health.js` and `killfeed.js`, but four sites re-encode it as the bare literal `'pistol'`: `world.js:33`, `world.js:167`, `matchEnd.js:54`, `fsm.js:205`. Change the default and those four silently stay on the old value while killfeed glyphs and the `health.js` fallback move. This project has already shipped this divergence shape twice. Import the constant at all four.
- **#13 `src/main.js:1`** — the largest and most consequential module (606 lines, the composition root) is the only file in `src/` with no one-line why-it-exists comment. Every sibling has one, including `sim/index.js` and `shell/states.js`, which place theirs right after the import block. Add it there.
- **#16 `src/main.js:376`** — `__debugTracerCount` filters `child.type === 'Line'`, but `tracer.js` deliberately builds each beam as a `THREE.Mesh` (a `Line` cannot render at usable width). The counter can only ever return 0, so a harness relying on it either concludes tracers are broken when they work or passes a check that can never fail. Set `beam.name = 'tracer'` in `tracer.js` (matching `grenadeFX.js` / `impacts.js`) and filter on the name.

### U10 — Learnings citation refresh — DONE

Documentation only, separate commit. All six learnings in `docs/solutions/logic-errors/` still hold — every recorded fix is in place and no pattern recurs at a new site. Three have drifted:

- `bot-retreat-survives-death.md` — `RETREAT_HEALTH_THRESHOLD`/`RETREAT_DURATION_TICKS` `fsm.js:22-23` -> `:36-37`; `transitionBotState` `:41` -> `:99`; `armed` `:43` -> `:101`. Its fully-quoted "current" function body is a stale snapshot — the live function has grown a `search` phase and threads `lastSeenPosition` through nearly every return via `...state` spreads. Re-quote it.
- `strafe-direction-camera-basis-mismatch.md` — bot-side basis `fsm.js:329-330` -> `:335-336`.
- `grenade-blast-kill-bypasses-mg-death-strip.md` — cites the regression block as both `grenades.test.js:395-439` and `:392-436`. It runs 395-439.

If U1-U9 shift any cited line, refresh those citations here too. `CLAUDE.md`: update relevant specs in the same session as code changes.

**Landed.** All three files fixed, plus a full re-verification of every other line citation in all three docs against current source (several had drifted further than this list anticipated, e.g. the strafe doc's `fsm.js:329-330` target had itself drifted to `:337-338` by the time U9 landed, and `movement.js:75` for the `forward` vector had drifted to `:78`; the grenade-blast test citation had drifted to `:431-475`, past both numbers this list gave). Every `file:line` reference in all three docs now matches current source, verified by direct `sed`/`grep` cross-check, not by re-deriving an offset.

## Known landmines

Verified during review — do not rediscover these.

- **The suite is not the safety net you think it is.** All 318 tests pass with two of four arena spokes fully open (U1) and with the restart flow dead-ended (U2). Both shipped green. A passing suite is not evidence a unit is done; the new test is.
- `test/support/rig.js:17-40` builds a flat 60x60 floor and omits the pickups and grenades systems. Every bot navigation, steering, and FSM test runs against an empty plane, not the shipped rooms-and-corridors layout its ranges were tuned for. A test that passes on the rig may not reflect real arena behaviour.
- `test/render/arenaMesh.test.js` asserts an exact child count and `test/render/weaponView.test.js` destructures the weapon group's children positionally. Both break on added meshes — update them deliberately, never silently.
- `sim/lineOfSight.js` has no dedicated test file. Its `LOS_SURFACE_BACKOFF` / `CAPSULE_RADIUS` boundary math is covered only indirectly, so U4 cannot lean on it as a verified base.
- Colliders lag a teleport by one sim tick (`world.js:137`). Any U4 test that teleports then immediately raycasts will read the pre-teleport position.
- `render/models.js` caches a rejected GLTF promise per URL forever, so a transient failure in a U8 test poisons later loads of that URL in the same run.
- **`Collider.setEnabled(false)` does not exclude a kinematic character's collider from `castRay`** in `rapier3d-compat` 0.19.3, even though `isEnabled()` reports correctly. Confirmed by direct probe (fixed-body colliders honor it; kinematic-position-based ones don't). Don't reach for `setEnabled` to take a character out of hitscan/line-of-sight queries -- teleport its physics body far away instead (see U4, `CORPSE_PARK_POSITION`).

## Round 1 re-review (2026-08-06, whole-repo `ce-code-review` after U1-U10)

Nine reviewers (correctness, testing, maintainability, agent-native, learnings-researcher, performance, reliability, adversarial; project-standards skipped — no `CLAUDE.md`/`AGENTS.md` inside this repo; cross-model peer skipped — no non-Claude CLI installed on the host). 13 findings survived independent validation (12/12 in the automated validator batch, plus one additional finding surfaced by `learnings-researcher`'s recurrence check and independently derived/confirmed by direct computation): 2 P1, 10 P2, 1 P3. Not yet P0/P1/P2-clean — the loop continues. Full findings, evidence, and reasoning are in the review transcript; units below are ready to pick up one at a time.

Fix in this order. Each unit is one commit, test-first, per the loop's non-negotiables.

### U11 — Damage indicator points the wrong way (P1)

`src/render/feedback.js:9-18` (`computeAngleFromPlayer`)

The incoming-damage HUD arrow is mirrored left-right. Its formula, its own doc comment, and its own test (`test/render/feedback.test.js:12-15`) all agree with each other — but disagree with the codebase's one already-verified ground truth for "right" (`src/sim/movement.js:85`, `right = {x: -cos(yaw), z: sin(yaw)}`, confirmed live via Playwright when the strafe-direction bug was fixed). An attacker standing at the player's real visual-right position computes a *negative* angle from `computeAngleFromPlayer`, which `createDamageIndicator.show()` renders as the arrow pointing screen-left. This is the same failure shape as `strafe-direction-camera-basis-mismatch.md` and `minimap-rotation-composition-sign-error.md` — an internally self-consistent coordinate transform never cross-checked against the actual consumer — now confirmed at a fourth site.

- Flip the sign the same way `movement.js`'s `right` vector was flipped, or re-derive `bearingYaw`'s relationship to `playerYaw` against the verified right-vector directly.
- The existing test's own expected values are backwards and must be corrected as part of this fix, not left as a regression guard for the wrong behavior.
- **Test first:** assert an attacker at the player's real visual-right position (per `movement.js`'s verified basis, not a bare `+X` literal) produces a positive angle.

### U12 — Weapon-id string literal duplicated with no canonical source (P1)

`src/sim/weapon.js:34-49` and 6+ call sites (`render/weaponView.js:64,68,70,139`, `audio/gunshots.js:28`, `sim/pickups.js:35,41`, `ui/killfeed.js`)

Only `DEFAULT_WEAPON_ID` is exported from `weapon.js`; every other reference to `'pistol'`/`'machinegun'` is re-typed as a bare literal. This is the exact failure shape U9 already fixed once for `DEFAULT_WEAPON_ID` alone — the fix didn't reach the full id set.

- Export a canonical weapon-id source (e.g. `WEAPON_IDS` derived from `WEAPON_CONFIGS`) and import it at every listed call site.
- **Test first:** an architecture-style test asserting every non-`sim/weapon.js` weapon-id reference resolves through the exported source, not a bare literal.

### U13 — Bot search-phase `lastSeenPosition` aliases the live player object (P2)

`src/sim/bot/fsm.js:132,135,288`

`lastSeenPosition: playerPosition` stores a reference to the same mutable object `movement.js` updates in place every tick, so the Search phase's "frozen last-seen point" silently tracks the player's *current* position — defeating the honest-sensing guarantee the phase's own adjacent comment (`fsm.js:283-287`) states.

- Store a shallow copy (`{ x: playerPosition.x, z: playerPosition.z }`) at both return sites that set `lastSeenPosition`.
- **Test first:** move the player after a sighting is recorded; assert the bot's Search-phase facing does not track the move.

### U14 — GLTF loader caches a rejected promise forever (P2)

`src/render/models.js:11-21`

A failed model load poisons `gltfCache` for the rest of the session — no later call for that URL can ever succeed again, even after the transient cause (network blip) clears.

- On rejection, delete the cache entry so a later call re-attempts the load.
- **Test first:** a rejected `loadGltf(url)` followed by a second call for the same URL should attempt the load again, not replay the cached rejection.

### U15 — `RAPIER.init()` has no timeout, only a reject handler (P2)

`src/main.js:40-46`

U3 fixed the reject path; a hang (blocked fetch that never settles rather than errors) still black-screens the game forever, invisible to the `try`/`catch`.

- Race `RAPIER.init()` against a timeout; treat the timeout the same as a rejection.
- **Test first:** a `RAPIER.init` that never resolves should still reach the startup-error screen after the timeout.

### U16 — A fire queued right before pause discharges itself on resume (P2)

`src/main.js:461`, `src/input/sampler.js:66-74`

`clearHeldInput()` (wired to `blur`, mirroring the pause boundary) clears held keys and the fire-held level but — by its own comment — never the edge latches (`fireLatch`/`throwLatch`). A press queued immediately before pause stays pending through the pause and fires with zero live input on the first tick after resume. Same shape as the already-fixed U5 grenade-throw-while-paused bug (P2), on the fire latch instead of the throw latch.

- Drain `fireLatch`/`throwLatch` pending counts from the same sites `clearHeldInput()` is already called from.
- **Test first:** queue a fire, then pause before the next tick consumes it; assert no fire event fires on resume with no new input.

### U17 — `mixer.js` hardcodes a `'Death'` substring the module's own design says to avoid (P2)

`src/render/mixer.js:25`

The module's header comment (`mixer.js:9-15`) explains clip names are caller-supplied per model specifically so no module hardcodes a single rig's naming; line 25 does exactly that.

- Use `clipNames.dead` (the caller-supplied mapping) instead of `clip.name.includes('Death')`.
- **Test first:** a model whose death clip name doesn't contain `'Death'` should still get the one-shot/clamp treatment.

### U18 — Full-health `100` literal duplicated in 5 places (P2)

`src/sim/world.js:31`, `src/sim/health.js:89`, `src/shell/matchEnd.js:51`, `src/sim/bot/fsm.js:177,201`

Same failure shape as U9/U12 — one of the five call sites (`fsm.js`'s respawn-detection heuristic) depends on its own hardcoded value staying in lockstep with the others. Already listed once in "Deferred residual risks" below; promoted here per this document's own rule now that a review has flagged it P2.

- Export `MAX_HEALTH` from `sim/health.js`; import at all five sites.
- **Test first:** assert a newly-spawned entity's health equals the same constant `fsm.js`'s respawn-detection heuristic compares against.

### U19 — `main.js` bundles composition wiring, debug instrumentation, and per-frame event policy (P2) — structural only

`src/main.js:316-424` (debug hooks), `:473-637` (`onFrame`)

639 lines with no automated size/responsibility guard (unlike `src/sim/`, which has an architecture test). Extract `window.__debug*` into `src/debug/testHooks.js`; extract `onFrame`'s per-event switch into `src/render/frameEvents.js`. No behavior change — commit separately from U20, which depends on this extraction to be testable.

### U20 — `main.js`'s composition-root wiring has zero test coverage (P2)

`src/main.js:141-158` (`gatherCommands`) and the pieces U19 extracts

The actual U3/U4/U5 fixes (startup-error handling, `targetAlive` threading, input-clearing wiring) live here and are exercised by no test at all.

- After U19's extraction, unit test the extracted functions directly (mirroring how U2 tested `createGameShell`).
- **Test first:** the tests are the point of this unit.

### U21 — `build-combat-feel.md` misstates asset licenses (P2) — docs only

`.claude/commands/build-combat-feel.md:34` vs `CREDITS.md:3` (CC BY 3.0 claimed vs CC0 actual)

Correct the claim: existing assets are CC0, no attribution required.

### U22 — `goal.md`'s "run to completion" mode has no defined trigger syntax (P2) — **needs a human decision**

`.claude/commands/goal.md:27` says "unless the loop below is explicitly running to completion" but `argument-hint` (line 4) documents only unit selectors — no such trigger exists anywhere in the file. This is the exact ambiguity this session hit when deciding how to proceed after this review.

**Stop and ask**, same as U4: what should the actual trigger be (a literal argument like `all`/`complete`, a different mechanism, or should the single-unit-per-run default simply be documented as permanent)? Implement only after the answer.

### U23 — `gunshots.js`'s `unlock()` has a bare `catch(() => {})` U8 didn't reach (P3)

`src/audio/gunshots.js:196-200`

Cheap, same pattern as U8's already-fixed `setRunning()` path. Route through the same `onError` callback.

## Accepted (not fixed)

Nothing yet. Every P3 or advisory item the loop decides not to fix goes here with a one-line reason, so the decision is durable rather than re-litigated each round.

## Deferred residual risks

Reviewed and judged out of scope for this remediation. Listed so they are not rediscovered as new findings:

- Deterministic match openings — `spawns.js:22-30` always returns `spawnPoints[0]` first, so every match and restart starts identically.
- `fsm.js:206`'s strict health-increase respawn detection misses a full-health one-tick kill — a residual hole in `bot-retreat-survives-death.md`.
- `se-bottom` / `se-right` doorway ids swapped at `layout.js:178-179`. Harmless only while every doorway shares one width; the moment one is widened, the gap opens in the wrong wall.
- `weaponSystem` cooldowns and `nextGrenadeId` sit outside `resetMatch`'s reset convention — same shape as `killfeed-survives-match-restart.md`. Round 1 re-review re-confirmed this (bounded impact: max ~6 stale ticks after a restart) and left it deferred.
- `tracer.js`'s active array is unbounded, unlike `impacts.js` and `grenadeFX.js`. Round 1 re-review re-confirmed this is genuinely low-impact given `BOT_COUNT=4` and exactly one machine-gun pickup on the map (worst case ~10 short-lived objects).
- WebGL context loss is handled nowhere.
- `pointerLock.js:21`'s `NotSupportedError` retry has no `.catch()`. Round 1 re-review re-confirmed this is cosmetic (console warning only) — the sibling `pointerlockerror` event already backstops it functionally.
- `createPointerLockController` has no tests at all.
- Escape-triggered pause doesn't clear held movement keys the way window `blur` does (`states.js`'s `onUnlock` only dispatches `lockLost`) — lower-confidence, narrower version of U16; revisit if it recurs as its own report.
- Ramp-parked (not-yet-activated) bots are filtered by `!entity.dead` rather than activity state in spawn-safety scoring — low confidence this triggers in practice given bots activate early in a match.
- Citation drift in the three `docs/solutions/logic-errors/` docs NOT touched by U10's refresh (`killfeed-survives-match-restart.md`, `minimap-rotation-composition-sign-error.md`, `bot-obstacle-avoidance-reversal.md`), plus one passage inside an already-refreshed doc (`grenade-blast-kill-bypasses-mg-death-strip.md`'s historical grep narrative still names the pre-U9 literal `'pistol'` call sites) — all caused by later, unrelated commits shifting `main.js`/`fsm.js` line numbers. Documentation-only, P3-grade; promote to a unit only if it actively misleads someone.

Promote any of these into a work unit only if a later review raises it as P0/P1/P2.
