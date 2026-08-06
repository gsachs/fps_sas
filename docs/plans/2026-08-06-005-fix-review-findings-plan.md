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

### U3 — Startup failure path (finding #2, P1)

`src/main.js:35`

Top-level `await RAPIER.init()` has no failure path. A blocked WASM fetch, a restrictive CSP, or an environment that cannot instantiate it throws before any other module-level code runs. `index.html` has no fallback content, so the player gets a permanent black screen with only an unhandled rejection in the console.

Every other async load in this same file — bot model, weapon model, gunshot audio — uses an `onError` callback plus a non-blocking fallback. This is the one external call in `main.js` not held to the app's own convention, or to `CLAUDE.md`'s "design for failure on every external call".

- Wrap in `try`/`catch` and render a visible failure message into `#app`, matching the screen-rendering pattern in `shell/states.js`.

### U4 — Corpse semantics (findings #4, #6 — P1, P2) — HUMAN DECISION REQUIRED

`src/sim/health.js:42` and `src/main.js:132`

The sim treats a dead entity as live in two ways:

- **#4:** for the full 3s respawn delay a corpse stays in the physics world as a solid capsule while its mesh is hidden. Shots aimed through the death spot vanish; anyone behind a corpse is invisible to line-of-sight sensing and safe from fire. It also poisons spawn safety — `selectSpawnPoint` can rate a point "hidden from every enemy" purely because a corpse blocks the ray, then the corpse vanishes and the entity spawns in the open.
- **#6:** every bot keeps targeting the corpse — closing on the death spot and firing into it for three seconds, then searching it after the player has respawned elsewhere. `gatherCommands` guards the *bot's* liveness but reads the player's position unconditionally, and the FSM's acquisition sensor has no liveness input.

**Stop here and ask.** Both are symptoms of one unmade decision: what is a corpse during the respawn window — absent from the world, or present but non-targetable? Fixing them independently risks two inconsistent notions of "dead". Do not guess.

Proposed default once the decision is made:
- #4: add `setCharacterEnabled(entityId, enabled)` to `movementSystem` wrapping `collider.setEnabled`; call `false` in the death branch at `health.js:40-46` and `true` in `tickRespawns` at `:76`. If `rapier3d-compat` 0.19 does not expose `Collider.setEnabled`, reuse the `PARK_POSITION` idiom `main.js` already applies to un-ramped bots.
- #6: add a `targetAlive` argument to `createBotAI(...).sample` at `fsm.js:205`, pass `!playerEntity.dead` from `main.js:137`, and AND it into `fsm.js:127`. Thread liveness — do not pass a null position (`CLAUDE.md`: never pass null).

**Test first:** kill B between A and C, assert A's shot reaches C. Construct a dead target and assert the bot FSM does not hold `attack`.

### U5 — Input state across pause and blur (findings #7, #14 — P2, P2)

`src/main.js:427-428`

Two leaks through one root cause: document-level key listeners are neither pointer-lock-gated nor cleared on focus loss. The mouse already has both treatments at `main.js:414-426`; the keyboard has neither.

- **#7:** pressing G while paused, at the start screen, or on results queues a live throw that fires on resume. The latch is an uncapped `pending += 1` counter (`sim/command.js:28-30`), so a few taps dump the whole grenade pocket over consecutive ticks. Gate `keydown` on `document.pointerLockElement === renderer.domElement`. Leave `keyup` ungated, mirroring the documented `mouseup` rationale at `:419-423`.
- **#14:** alt-tab while holding W and no keyup ever arrives, so `'KeyW'` stays in the sampler's key set and the character auto-walks on resume. Expose `clearHeldInput()` from `createInputSampler` and wire `window.addEventListener('blur', ...)`.

**Test first:** no test covers input-sampler state across a pause or blur boundary at all. Add one that does.

### U6 — Grenade sticks to bodies (finding #9, P2)

`src/sim/grenades.js:151-167`

A grenade thrown at an enemy stops dead against their capsule at chest height and floats there for the rest of its two-second fuse while they walk away. The sweep is documented as detecting *wall* contact, but its raycast excludes only the thrower's collider, so every character capsule is treated as terrain.

- After the `castRay` at `:151`, treat the hit as terrain only when `movementSystem.getEntityIdForCollider(hit.collider) === undefined`; otherwise continue the arc.
- Assumption named: grenades pass through bodies rather than sticking, matching the module's own "wall contact" framing at `:5-6`. If the intended behaviour is stick-to-body, say so and this unit becomes a comment fix instead.
- **Test first:** `test/sim/grenades.test.js` never throws a grenade at an entity. Add that case.

### U7 — Player diagonal speed (finding #12, P2)

`src/input/sampler.js:69-72`

W+D moves the player at ~5.66 units/sec versus 4.0 for W alone — the sampler emits `moveX`/`moveZ` as independent ±1 values and `movement.js` composes them onto an orthonormal basis without renormalising. Bots are unaffected, since `fsm.js` projects an already-normalised direction. The result is a player-vs-bot asymmetry any player finds by strafe-walking, and it silently invalidates `MOVE_SPEED` as the game's real top speed.

- Clamp in `sample()` before building the Command: `const length = Math.hypot(moveX, moveZ); if (length > 1) { moveX /= length; moveZ /= length; }`. Clamping in the sampler leaves already-unit-length bot commands untouched.
- **Test first:** `test/input/sampler.test.js` asserts W+D yields `moveZ 1 / moveX 1` but never asserts the resulting speed. Assert the speed.

### U8 — Error-handling invariants (findings #8, #11 — P2, P2)

Two `CLAUDE.md` invariant violations on external-call failure paths.

- **#8 `src/render/models.js:33, :45`** — both loaders resolve to a literal `null`. Both current call sites guard correctly, so nothing breaks today, but any future caller that omits the falsy check crashes destructuring `{ scene, animations }` off null. Return `{ scene: null, animations: [], loaded: false }` and check `result.loaded` at `main.js:185` and `:219`. ("Never return null.")
- **#11 `src/audio/gunshots.js:199`** — `setRunning` runs every animation frame once unlocked. If the context stays suspended under Chrome's auto-suspend policy, the code issues a fresh `resume()`, it rejects, and `.catch(() => {})` discards the error, forever, at up to 60 calls/second. The player loses all audio for the session with no diagnostic signal. Track a `resumeFailed` flag set in the `.catch()`, log through the same `onError`-style callback the module already accepts for buffer loads, and clear it only on a fresh `unlock()` from a user gesture. ("No swallowed exceptions"; "design for failure on every external call".)

`test/render/models.test.js` covers only `disposeObject3D` — the loaders have zero coverage in either direction. Add it.

### U9 — Knowledge duplication and conventions (findings #10, #13, #16 — P2, P2, P3)

Structural only. **This unit contains no behavioral change — commit it separately** (`CLAUDE.md`: never mix structural and behavioral changes in the same commit).

- **#10 `src/sim/world.js:33`** — `DEFAULT_WEAPON_ID` is exported from `sim/weapon.js` and correctly reused by `health.js` and `killfeed.js`, but four sites re-encode it as the bare literal `'pistol'`: `world.js:33`, `world.js:167`, `matchEnd.js:54`, `fsm.js:205`. Change the default and those four silently stay on the old value while killfeed glyphs and the `health.js` fallback move. This project has already shipped this divergence shape twice. Import the constant at all four.
- **#13 `src/main.js:1`** — the largest and most consequential module (606 lines, the composition root) is the only file in `src/` with no one-line why-it-exists comment. Every sibling has one, including `sim/index.js` and `shell/states.js`, which place theirs right after the import block. Add it there.
- **#16 `src/main.js:376`** — `__debugTracerCount` filters `child.type === 'Line'`, but `tracer.js` deliberately builds each beam as a `THREE.Mesh` (a `Line` cannot render at usable width). The counter can only ever return 0, so a harness relying on it either concludes tracers are broken when they work or passes a check that can never fail. Set `beam.name = 'tracer'` in `tracer.js` (matching `grenadeFX.js` / `impacts.js`) and filter on the name.

### U10 — Learnings citation refresh

Documentation only, separate commit. All six learnings in `docs/solutions/logic-errors/` still hold — every recorded fix is in place and no pattern recurs at a new site. Three have drifted:

- `bot-retreat-survives-death.md` — `RETREAT_HEALTH_THRESHOLD`/`RETREAT_DURATION_TICKS` `fsm.js:22-23` -> `:36-37`; `transitionBotState` `:41` -> `:99`; `armed` `:43` -> `:101`. Its fully-quoted "current" function body is a stale snapshot — the live function has grown a `search` phase and threads `lastSeenPosition` through nearly every return via `...state` spreads. Re-quote it.
- `strafe-direction-camera-basis-mismatch.md` — bot-side basis `fsm.js:329-330` -> `:335-336`.
- `grenade-blast-kill-bypasses-mg-death-strip.md` — cites the regression block as both `grenades.test.js:395-439` and `:392-436`. It runs 395-439.

If U1-U9 shift any cited line, refresh those citations here too. `CLAUDE.md`: update relevant specs in the same session as code changes.

## Known landmines

Verified during review — do not rediscover these.

- **The suite is not the safety net you think it is.** All 318 tests pass with two of four arena spokes fully open (U1) and with the restart flow dead-ended (U2). Both shipped green. A passing suite is not evidence a unit is done; the new test is.
- `test/support/rig.js:17-40` builds a flat 60x60 floor and omits the pickups and grenades systems. Every bot navigation, steering, and FSM test runs against an empty plane, not the shipped rooms-and-corridors layout its ranges were tuned for. A test that passes on the rig may not reflect real arena behaviour.
- `test/render/arenaMesh.test.js` asserts an exact child count and `test/render/weaponView.test.js` destructures the weapon group's children positionally. Both break on added meshes — update them deliberately, never silently.
- `sim/lineOfSight.js` has no dedicated test file. Its `LOS_SURFACE_BACKOFF` / `CAPSULE_RADIUS` boundary math is covered only indirectly, so U4 cannot lean on it as a verified base.
- Colliders lag a teleport by one sim tick (`world.js:137`). Any U4 test that teleports then immediately raycasts will read the pre-teleport position.
- `render/models.js` caches a rejected GLTF promise per URL forever, so a transient failure in a U8 test poisons later loads of that URL in the same run.

## Accepted (not fixed)

Nothing yet. Every P3 or advisory item the loop decides not to fix goes here with a one-line reason, so the decision is durable rather than re-litigated each round.

## Deferred residual risks

Reviewed and judged out of scope for this remediation. Listed so they are not rediscovered as new findings:

- Deterministic match openings — `spawns.js:22-30` always returns `spawnPoints[0]` first, so every match and restart starts identically.
- `fsm.js:206`'s strict health-increase respawn detection misses a full-health one-tick kill — a residual hole in `bot-retreat-survives-death.md`.
- `se-bottom` / `se-right` doorway ids swapped at `layout.js:178-179`. Harmless only while every doorway shares one width; the moment one is widened, the gap opens in the wrong wall.
- Full-health `100` bare in five places (`world.js:29`, `health.js:73`, `matchEnd.js:50`, `fsm.js:175`, `:199`).
- `weaponSystem` cooldowns and `nextGrenadeId` sit outside `resetMatch`'s reset convention — same shape as `killfeed-survives-match-restart.md`.
- `tracer.js`'s active array is unbounded, unlike `impacts.js` and `grenadeFX.js`.
- WebGL context loss is handled nowhere.
- `pointerLock.js:21`'s `NotSupportedError` retry has no `.catch()`.
- `createPointerLockController` has no tests at all.

Promote any of these into a work unit only if a later review raises it as P0/P1/P2.
