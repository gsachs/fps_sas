---
name: build-combat-feel
description: Build one requirement group from the combat-feel-and-lighting plan, end to end, stopping for human validation
argument-hint: "[assets | feedback | audio | lighting] — defaults to the next unbuilt group in plan order"
---

# Build: Combat Feel and Lighting

Implement **one** requirement group from `docs/plans/2026-08-03-002-feat-combat-feel-and-lighting-plan.md`.

Read that plan first. It is the definition of what to build — do not re-derive requirements, scope, or success criteria from this file.

## Which group

`$ARGUMENTS` selects the group. With no argument, pick the first one whose requirements are not yet satisfied in the code.

| Group | Requirements | Goal |
|---|---|---|
| `assets` | R1–R4 | Real weapon viewmodel, robotic bot |
| `feedback` | R5–R8 | Recoil, tracer, impact spark, hit confirm |
| `audio` | R9–R11 | Positional gunshots for every shooter |
| `lighting` | R12–R16 | Shadows, tone mapping, sky-based ambient |

Plan order is `assets → feedback → audio → lighting`. **Build exactly one group per run.** If the selected group is already done, say so and stop rather than continuing into the next one.

## Non-negotiables

These hold for every group. Violating one is a failed run, not a tradeoff.

- **Never touch `src/sim/`.** This is a render-and-feedback pass. Collision, spawn points, cover placement, hitscan resolution, and bot difficulty are unchanged (R17). Recoil is cosmetic and must not move the aim point.
- **Never change `src/arena/arena.js`.** It owns every Rapier collider. Visuals read from it; they do not alter it.
- **Keep the placeholder fallback.** A failed asset load must still render placeholder geometry and never block startup (R18).
- **`npm test` passes before you stop.** Full suite, not the files you touched.
- **Credit every new asset in `CREDITS.md`** with source and license before you finish. Existing assets are CC BY 3.0 — attribution is required.
- **Do not commit, branch, or push.** Leave the working tree dirty for review.

## Known landmines

Verified against the codebase — do not rediscover these the hard way.

- `public/assets/weapons/quaternius-pistol.glb` is **unusable**. It is a skinned mesh with a baked 100× scale split across its armature and mesh nodes. Three scale attempts already failed. Source a *static, non-skinned* weapon instead; `weaponView.setModel()` is the seam and takes a local transform.
- `src/render/mixer.js` hardcodes clip names as `Rig|Idle_Loop`, `Rig|Jog_Fwd_Loop`, `Rig|Pistol_Shoot`. A bot model from the same Quaternius rig family keeps these working; anything else means remapping the animation hints. The death lookup is already name-agnostic.
- `src/sim/weapon.js` already returns `origin`, `endPoint`, and `hitEntityId` on a fired shot — everything the feedback work needs. It uses `castRay` and yields **no surface normal**, which is why impact feedback is sparks at the end point and not wall decals.
- `LineBasicMaterial` ignores `linewidth` on most WebGL platforms, so the current tracer cannot simply be thickened. If it needs to be thicker, it needs to stop being a `THREE.Line`.
- Two tests break on any added mesh and will need updating deliberately, not silently: `test/render/arenaMesh.test.js` asserts an exact child count, and `test/render/weaponView.test.js` destructures the weapon group's children positionally. `test/smoke.test.js` uses `>= 2` lights, so added lights are safe.
- Browsers block audio until a user gesture. The existing click-to-play pointer-lock gesture is the unlock point.

## Finish by handing it back

The success criteria in this plan are not machine-verifiable — "firing reads as having weight" and "whether a shot landed is never ambiguous" are judged by playing, not by inspection. Tests prove the code runs; they cannot tell you it feels right.

So end every run with:

1. The full `npm test` result, stated plainly — including any test you changed and why.
2. `npm run dev`, and the exact thing to go look at or listen for.
3. One specific question about feel that only a human can answer.

Do not report the group as done. Report it as ready to judge.
