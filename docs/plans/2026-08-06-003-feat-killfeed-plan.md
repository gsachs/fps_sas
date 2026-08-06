---
title: Killfeed - Plan
type: feat
date: 2026-08-06
topic: killfeed
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Killfeed - Plan

## Goal Capsule

- **Objective:** Narrate the match: a compact glyph killfeed under the score showing who killed whom with what, with the player's own kills and death highlighted. Third and final plan of the agreed sequence; a live scoreboard and richer stats stay future candidates.
- **Product authority:** The Product Contract governs product behavior; the Planning Contract governs mechanism within it.
- **Execution profile:** Phased; each unit ends with a human play-check. Build after the armory loop's event work lands, or land U1's weapon field first if order flips — either order works, never both writing the same field.
- **Open blockers:** None.

---

## Product Contract

### Summary

A killfeed on the right edge, tucked under the score: compact entries reading killer ▸ victim with a weapon glyph, the player's kills in gold and their death in red, grenade multi-kills stacking as simultaneous lines, entries dimming then fading after a few seconds. It shows every kill — including bot-vs-bot crossfire — and never any position, so the hunt-and-ambush pillar is untouched.

### Problem Frame

Fights the player didn't see leave no trace: a distant firefight resolves and the match state changes silently, and even the player's own multi-kill moment gets no acknowledgment beyond the score ticking. For a demo, the feed is also narrative texture — a viewer instantly reads "this is a living match." The armory plan's grenade multi-kills are exactly the moments worth announcing.

### Key Decisions

- KD1. **Killfeed only** — chosen over adding a live mid-match scoreboard or richer end-of-match stats (session-settled: user-directed — smallest coherent unit; the results screen already covers standings; both alternatives stay future candidates). Governs R1–R5.
- KD2. **Glyph entries** — killer ▸ victim with a weapon glyph, chosen over worded sentences (session-settled: user-directed — picked from visual sketches; fits the narrow under-score slot). Governs R1, R7.
- KD3. **Right edge under the score** — the one slot the HUD allocation leaves free (session-settled: user-approved — corners hold fps, score, health cluster, and minimap). Governs R1, R8.

### Requirements

**Feed**

- R1. A feed under the score shows every kill as killer ▸ victim with a weapon glyph, newest entry first.
- R2. The player's kills render gold and the player's death renders red; all other entries are neutral.
- R3. Kills from one blast appear as separate lines in the same instant, reading as one burst.
- R4. Entries dim after a few seconds and then fade; the feed caps its visible entries and never grows unbounded.
- R5. The feed carries kill events only — never positions, health, or any location information.

**Names and data**

- R6. Every entity has a readable display name — "You" for the player, "Bot N" for bots — used consistently by the feed and the results screen, replacing the raw id labels there.
- R7. Kill events carry the weapon used, and the glyph derives from it (pistol, machine gun, grenade; exact glyph characters are tunable). Until the armory lands, every entry reads as a pistol kill.

**Guardrails**

- R8. The feed joins the existing HUD layer and inherits its behavior — frozen and covered by overlays in non-play states, no new visibility logic.

### Key Flows

- F1. Reading the match
  - **Trigger:** A fight the player didn't see resolves.
  - **Steps:** The feed shows the line; the player learns the match moved — who's scoring, what weapon is loose — without learning where anyone is; they adjust their hunt.
  - **Covers:** R1, R5.

### Acceptance Examples

- AE1. **Covers R1, R7.** Given a bot kills another bot with the machine gun, then a "Bot 2 ≫ Bot 4"-style line appears at the top of the feed.
- AE2. **Covers R2, R3.** Given the player's grenade kills two bots at once, then two gold grenade lines appear in the same instant; when the player dies, the line naming them renders red.
- AE3. **Covers R4.** Given no new kills, entries dim and then disappear after their lifetime; given a kill flurry, the feed never shows more than its cap.
- AE4. **Covers R6.** Given the results screen after this plan, then it lists "You" and "Bot 1"-style names — no raw entity ids.
- AE5. **Covers R5, R8.** Given the game is paused, the feed is covered like the rest of the HUD; no feed entry ever contains location information.

### Success Criteria

- The match feels narrated: after playing, the owner can recount what happened from the feed's story (who ran the table, what the loose MG did) — validated by play.
- Hunt pacing is untouched, and ~60fps holds with the feed active.

### Scope Boundaries

- Live mid-match scoreboard and richer end-of-match stats — future candidates, per KD1.
- Kill sounds, announcer voice, or streak callouts — future polish, not scope.
- No changes to scoring rules; the feed observes, never affects.

<!-- ce-section: work-relationships -->
### How This Work Fits Together

This plan closes the agreed three-plan sequence (wayfinding, armory loop, killfeed). Relationships are current understanding, not a roadmap.

- Armory loop — its event extension carries the weapon identity R7 needs; whichever plan builds first lands the field, the other consumes it. Grenade multi-kills are the feed's best content.
- Wayfinding — independent; shares only the HUD layer, in already-allocated slots.
- Live scoreboard, match stats, kill audio — future candidates this feed's event consumption would feed.

### Dependencies / Assumptions

- Verified: the sim already emits per-kill events with shooter, target, and a killed flag — but no weapon identity field; R7's field joins that contract (src/sim/health.js, src/sim/world.js).
- Verified: bot-vs-bot kills are credited like any other, so the feed shows them with no scoring change (src/sim/score.js).
- Verified: the top-right column below the score is unoccupied, and HUD elements added before the shell screens inherit overlay coverage in non-play states for free (src/ui/hud.js, src/main.js, src/shell/states.js).
- Verified: no shared naming helper exists — the results screen hardcodes "You" and shows raw ids like "bot0" for bots; R6's shared naming rule replaces that ad-hoc labeling (src/shell/states.js).

### Sources / Research

- src/sim/world.js, src/sim/health.js — the kill events the feed consumes; the contract the weapon field joins.
- src/ui/hud.js, src/main.js — the HUD layer, paint-order overlay behavior, the per-frame event loop, and the free under-score slot.
- src/render/tracer.js — the per-frame lifetime-countdown pattern the feed's dim/fade mirrors.
- src/shell/states.js — the results screen R6's naming rule also fixes.
- docs/plans/2026-08-06-002-feat-armory-loop-plan.md — KTD1's event extension this plan's R7 rides on.

---

## Planning Contract

Product Contract preservation: Product Contract unchanged.

### Key Technical Decisions

- KTD1. **The feed is a HUD-layer module in the pure-formatter idiom** — exported DOM-free functions own entry formatting (name, glyph, highlight class) and the cap/lifetime bookkeeping; a thin DOM mount renders their output. Mirrors how every testable HUD/render piece in this codebase is built; the DOM wiring itself stays untested by convention (no DOM exists in the Node test environment). Cites R1–R4.
- KTD2. **Entries are driven by the existing per-tick event stream and aged by per-frame delta time** — the feed consumes `killed` hit events in the main event loop and ages entries in the per-frame update like the tracer's lifetime countdown; because that update only runs while the sim runs, pause freezes the feed for free. No wall-clock timers. Cites R3, R4, R8.
- KTD3. **One display-name helper serves the feed and the results screen** — a pure function mapping entity id to "You" / "Bot N"; the results screen's ad-hoc labels are replaced by it in the same unit that introduces it, so two naming sources never coexist. Cites R6.
- KTD4. **The weapon field lands as a coordinated contract addition** — the kill event gains a weapon identifier sourced from the shooter's held weapon (constant pistol until the armory lands); if the armory builds first, this plan consumes its field instead of adding one. Cites R7.

### Implementation Units

### U1. Display names and the weapon field

- **Goal:** Kill events carry everything the feed needs, and names are readable everywhere.
- **Requirements:** R6, R7; implements KTD3, KTD4; advances AE4.
- **Dependencies:** None. Coordination: skip the event-field half if the armory's event extension already landed it.
- **Files:** src/ui/names.js (new), src/shell/states.js (results labels use the helper), src/sim/health.js + src/sim/world.js (weapon field on the kill event), test/ui/names.test.js (new), test/shell/states.test.js, test/sim/combat.test.js.
- **Approach:**
  1. `displayName(entityId)` pure helper: local player id → "You", bot ids → "Bot N" (1-based), unknown ids pass through.
  2. Results screen list uses the helper — raw "bot0" labels die here.
  3. Kill events gain a weapon identifier from the shooter's held weapon, defaulting to the pistol while it is the only weapon.
- **Patterns to follow:** src/ui/hud.js's exported pure formatters with direct unit tests.
- **Test scenarios:**
  - Covers AE4: results entries render "You" and "Bot 1"-style names for a mixed standings list.
  - `displayName` maps the player id, several bot ids, and an unknown id correctly.
  - A kill event includes the weapon field; with only pistols in play it reads pistol.
- **Verification:** `npm test` green; owner finishes a match — results screen shows readable names.

### U2. The feed

- **Goal:** The killfeed lives: entries appear, highlight, stack, dim, fade, and cap.
- **Requirements:** R1–R5, R8; implements KTD1, KTD2; advances AE1, AE2, AE3, AE5.
- **Dependencies:** U1.
- **Files:** src/ui/killfeed.js (new: pure entry/cap/lifetime logic + DOM mount), src/main.js (consume killed events in the event loop; per-frame update call; mount before shell screens), test/ui/killfeed.test.js (new).
- **Approach:**
  1. Pure core: `formatEntry(event)` → text, glyph, highlight class (gold when the local player is the killer, red when the victim); `ageEntries(entries, dt)` → dim/expire transitions; a cap that drops the oldest.
  2. DOM mount appends under the score element, newest first; joins the app container before the shell screens so overlay coverage is inherited (KTD2, R8).
  3. Feed updates only inside the simRunning per-frame block — paused matches freeze it by construction.
- **Execution note:** Test-first for the pure core — highlight classes and cap/expiry boundaries are where regressions would hide.
- **Test scenarios:**
  - Covers AE1: a bot-kills-bot event with the MG weapon formats as "Bot 2 ≫ Bot 4", neutral class.
  - Covers AE2: two killed events with the same tick and the player as shooter produce two gold grenade entries; a killed event naming the player as victim produces a red entry.
  - Covers AE3: entries transition to dimmed after the dim threshold and expire after the lifetime; adding beyond the cap drops the oldest, never exceeding it.
  - An event with `killed: false` produces no entry.
  - Unknown weapon identifiers fall back to the pistol glyph rather than throwing.
- **Verification:** `npm test` and `npm run build` green; owner plays — kills appear newest-first under the score, their own kills gold, death red, pause covers the feed (AE5 live).

### U3. Live-play validation and tuning

- **Goal:** The feed reads well in real matches at 60fps.
- **Requirements:** Success Criteria gate; final values for R4's lifetime, dim timing, and cap.
- **Dependencies:** U2.
- **Files:** Tuning constants in src/ui/killfeed.js; README controls/description untouched unless the feed warrants a line.
- **Approach:** Owner plays several matches, including one kill-flurry match: entry lifetime, dim timing, cap, and font size tuned one at a time; glyph legibility checked at play distance.
- **Test scenarios:** Test expectation: none — tuning and feel; behavioral coverage landed in U1/U2.
- **Verification:** Owner can recount the match from the feed afterward; ~60fps holds; hunt tension unchanged.

---

## Verification Contract

| Gate | Command / act | Applies to |
|---|---|---|
| Unit tests | `npm test` (vitest, pure formatters — no DOM in tests) | U1, U2, every commit |
| Build | `npm run build` | U2 |
| Live play-check | Owner runs `npm run dev` and plays the unit's named scenario | U1–U3 |
| Performance | Stats overlay ~60fps with the feed active | U3 |

---

## Definition of Done

- R1–R8 hold in the shipped game; AE1–AE5 demonstrated (AE1–AE4 by tests plus live checks; AE5 live).
- `npm test` and `npm run build` green.
- The results screen shows no raw entity ids anywhere (the "bot0" era ends with U1).
- Owner validated the U3 multi-match session including a kill flurry.
- ~60fps with the feed active; no dead code; CONCEPTS.md and README stay accurate.
