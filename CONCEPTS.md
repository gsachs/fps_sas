# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Simulation & Bots

### Command
The single per-tick action shape every controllable entity emits — movement, look direction, and button state. The local player, an AI Bot, and a future networked remote peer all produce the same Command shape, and the simulation consumes it identically regardless of source; this is what lets the simulation stay indifferent to who or what is driving an entity.

### Entity
A simulation object with position, orientation, health, alive/dead status, score, and an animation hint. Every controllable thing in a match — the player, every Bot — is represented as one Entity in the simulation's entity store; nothing acts on the simulation except by supplying a Command for its Entity.

### Bot
An AI-controlled Entity that produces its own Command every tick by sensing the world and deciding, rather than from human input. A Bot's decision-making moves through a small set of stages (see Bot Phase), and its steering (movement direction) and aim (look direction) are decided independently — obstacle avoidance can redirect where a Bot moves while it keeps aiming at its target.

### Bot Phase
The current stage of a Bot's decision-making: idle/patrolling (no target engaged), chasing (closing distance on a sensed target), attacking (target in range and in sight, actively engaging), or retreating (disengaging due to low health). Transitions are sensed from distance and line-of-sight to the target. Retreat is health-gated and, once entered, holds until either its duration elapses or health recovers — health recovering while retreating only happens via a full heal (this game has no gradual regen), so recovered health while still retreating doubles as a signal that the Bot has just returned to play after dying.

## Presentation & Feedback

### Cosmetic Recoil
Weapon kick that animates the viewmodel and the camera but never moves the aim point — shots still land where the crosshair was when the trigger was pulled. The distinction matters because real recoil (aim that climbs and must be fought back down) would be a gameplay change: it reaches into hitscan resolution and invalidates the tuned Bot aim spread and reaction delay. Cosmetic Recoil stays entirely in the render layer, so weapon feel can be tuned freely without re-tuning difficulty.
