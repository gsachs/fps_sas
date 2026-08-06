---
name: goal
description: Fix the whole-repo review findings one unit at a time, re-reviewing until no P0/P1/P2 remains
argument-hint: "[U1 … U10 | all] — defaults to the next unfinished unit in plan order; `all` runs the loop to completion"
---

# Goal: clear the review findings

Work the units in `docs/plans/2026-08-06-005-fix-review-findings-plan.md` until a fresh whole-repo review comes back clean.

Read that plan first. It is the definition of what to fix and what done means — do not re-derive findings, fix shapes, or acceptance criteria from this file.

## The loop

```
pick the next unfinished unit
  -> write the failing test
  -> make it pass
  -> npm test (full suite)
  -> commit
repeat until every unit is done
  -> re-review
  -> new P0/P1/P2? fold into the plan as new units and go again
  -> none? done
```

`$ARGUMENTS` selects a unit. With no argument, take the next one whose work is not yet in the code. **One unit per run**, with one exception: the literal argument `all` runs the loop above to completion — every remaining unit, one commit each, through re-review and triage — in this single invocation. Any other argument (a specific unit like `U11`, or no argument at all) runs exactly one unit and stops.

## Definition of done

The loop terminates when a fresh whole-repo review returns **no P0, no P1, and no P2**, and:

- `npm test` passes in full.
- Every P3 and advisory item in that final review is either fixed or written into the plan's **Accepted** section with a one-line reason.
- Every fix landed with a test that failed before it and passes after.

"No issues remain" literally is not a reachable state — a review can always surface another P3 or an advisory observation, so an unbounded loop never terminates. P0/P1/P2-clean is the bar. P3 and advisory are a decision to record, not a blocker to grind against.

## Re-reviewing

After the last unit is committed, run:

```
/compound-engineering:ce-code-review entire repo
```

Then triage the result:

- **New P0/P1/P2** -> add it to the plan as a new work unit, in fix order, and re-enter the loop.
- **A finding you already fixed comes back** -> the fix did not hold. Do not patch it again. Revert and take a different approach (`CLAUDE.md`: fix the cause, not the symptom; three fixes to the same problem means the first approach was wrong).
- **P3 / advisory only** -> fix the cheap ones, record the rest under **Accepted** with a reason, and stop.

**Cap the loop at three review rounds.** If round three still returns P0/P1/P2, stop and report what is not converging and why. A loop that will not close is information about the approach, not a reason to keep going.

## Non-negotiables

Violating one is a failed run, not a tradeoff.

- **Every fix starts with a failing test.** Write it, watch it fail, then fix. A fix with no test that would have caught the bug is not done — that is exactly how U1 and U2 shipped with all 318 tests green.
- **`npm test` passes before every commit.** Full suite, not the files you touched.
- **One unit per commit.** Never bundle units.
- **Never mix structural and behavioral changes in the same commit.** U9 and U10 are structural/documentation only and commit separately.
- **Stop at U4.** Corpse semantics is a human decision — what a corpse is during the respawn window drives both fixes, and guessing produces two inconsistent notions of "dead". Ask, wait for the answer, then implement. Do not proceed past it unasked.
- **Do not push, branch, or open a PR.** Commit on `main` (solo project — see `CLAUDE.md`). Pushing is the user's call.
- **Do not touch `docs/plans/` or `docs/solutions/` except as a unit directs.** U10 refreshes drifted citations; nothing else edits them.
- **Update the plan as you go.** Mark units done, add new ones from re-review, and fill in **Accepted**. A stale plan makes the next round re-litigate settled decisions.

## Landmines

The plan's "Known landmines" section is the full list. The two that bite hardest:

- A green suite proves nothing about whether a unit is done. It was green while half the arena had no walls.
- `test/support/rig.js` builds a flat 60x60 floor with no pickups or grenades systems. Bot navigation, steering, and FSM tests pass against an empty plane, not the shipped layout.

## Finish

End every run with:

1. Which unit ran, and the full `npm test` result stated plainly — including any test you changed and why.
2. The commit you made.
3. What the next unit is, or — if a review round just ran — the finding counts by severity and whether the loop continues.

For U4 and for any unit whose success criteria are about feel rather than inspection, add: `npm run dev`, the exact thing to go look at, and one specific question only a human can answer. Report those as ready to judge, not done.
