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
The current stage of a Bot's decision-making: idle/patrolling (no target engaged), chasing (closing distance on a sensed target), attacking (target in range and in sight, actively engaging), searching (target lost — see Last-Seen Position), or retreating (disengaging due to low health). Transitions are sensed from distance and line-of-sight to the target: acquisition requires line of sight, not proximity alone, so a Bot never tracks a target through a wall. Retreat is health-gated and, once entered, holds until either its duration elapses or health recovers — health recovering while retreating only happens via a full heal (this game has no gradual regen), so recovered health while still retreating doubles as a signal that the Bot has just returned to play after dying.

### Last-Seen Position
The remembered world position where a Bot last had line of sight to its target. Honest sensing steers chase and search behavior at this remembered point, never at the target's live position while occluded — losing sight of a target means hunting where it *was*, not where it *is*. Cleared on the Bot's death and on match reset.

### Waypoint Graph
The map's rooms and doorways treated as nodes a Bot can plan a route across, with an edge between any two nodes that are directly reachable without crossing a wall. A* search over this graph produces a sequence of nodes; each becomes, one at a time, the next subgoal steering seeks toward — the graph decides *where* to go next, and existing steering (seek, obstacle avoidance) decides *how* to actually move there. A doorway that stays impassably blocked long enough gets temporarily excluded and the route replanned around it, rather than the Bot waiting at it forever.

## Map

### Room
A distinct, walled space in the arena — four corner rooms and one central landmark room, connected by a corridor loop so no reachable position sees the whole map. Rooms are told apart by interior landmark geometry (a pillar's presence, count, or placement) rather than differing footprints, so the outer wall perimeter stays a simple closed shape. Walls, rooms, doorways, pillars, and spawn points are all authored as one descriptor dataset (`src/arena/layout.js`) that both physics and rendering consume, so the two can never derive the map's shape differently.

### Doorway
A gap cut into a room or corridor wall where two spaces connect — the only points where a Bot or player can cross between them. Every doorway is wide enough to pass through without the character controller snagging, and every room has at least two, so no space is a dead end a Bot or player can get trapped in.

### Minimap
The player-only, always-on corner overlay showing the whole arena's layout and the player's own position and facing — never any other entity, in any state. It rotates player-up (the player's facing always points to the top) rather than staying fixed-north, so reading it never costs a mental rotation. The rotation pivots on the arena's own fixed center, not the player — the whole layout spins in place rather than panning to re-center on them, which is what lets a single circular frame keep the entire map visible at every rotation angle. The player's own marker is the one piece that doesn't spin with the layout: its position moves to track them, but its shape always points up.

### Room Accent
The single accent color a corner Room owns, carried in the world through tinted wall/pillar surfaces plus trim strips at doorway thresholds — never a light, since a real per-room light would bleed through this arena's open-topped walls — and by the matching cell tint on the minimap. World and map share this one color language so naming your location is a glance, not a read. The central Room stays neutral and reads as the landmark reference. Accents live within the existing clean style: each room's color multiplies over the shared panel/composite surface texture rather than replacing it, so a room still names itself by hue at a glance with real material underneath it; no geometry or collider change. Enemy information never rides on wayfinding surfaces.

## Combat & Items

### Armory Loop
The room-control incentive created by weapons living on the map as respawning pickups: the machine gun spawns in the central landmark room, grenade pickups in corner rooms, and taken pickups return after a delay — so knowing and holding spawn rooms stays valuable all match. Bots join the loop only opportunistically (a bot takes the machine gun when its path crosses it); grenades are player-only.

### Gun Slot & Grenade Pocket
The loadout model: one gun slot (infinite pistol by default; a picked-up machine gun auto-equips and auto-reverts to the pistol when its ammo runs dry — no switch input exists) plus a separate grenade pocket thrown with its own key. The two never share a slot, so a player can hold the machine gun and grenades simultaneously.

Death empties the gun slot back to the pistol — the carrier's machine gun and its ammo are stripped the instant the carrier dies, regardless of what killed them, though the taken pickup's own respawn timer is unaffected by the death (it keeps counting down from when it was taken, independent of the carrier's fate). The grenade pocket is untouched by death and empties only on a full match reset.

## Match & Pacing

### Hunt-and-Ambush Pacing
The target match rhythm for the arena overhaul: engagements are deliberately less frequent than constant contact, start at closer range with partial information, and reward knowing the map — stalking, ambushing at doorways, disengaging to reposition. Chosen over the original arena's constant contact, which kept the player permanently in a fight. Pacing is tuned through contact-density knobs (awareness ranges, spawn placement, bot ramp, kill target), not by making individual bots harder.

### Match Reset
The full state reset a "Play Again" or "Restart Match" action triggers: every entity's position, health, score, and held weapon return to a fresh-match baseline, and every match-scoped stateful system — armory pickups, in-flight grenades, the killfeed, Bot AI memory — clears back to empty. A match-scoped system is not reset automatically; it must expose a reset hook and be explicitly registered with the reset step for its state to be included, which is a distinct failure mode from the reset step itself being wrong.

### Respawn
The automatic recovery of a single dead Entity after a short delay — restored to full health at a new spawn position, continuing the match's existing state (score, other entities, the killfeed's history) unchanged. Distinct from a Match Reset, which restarts the whole match fresh rather than recovering one Entity mid-match.

## Presentation & Feedback

### Killfeed
The under-score feed narrating every kill as killer ▸ victim with a weapon glyph — the player's kills gold, their death red, blast multi-kills stacking as one burst. It carries kill events only, never positions or health: the match becomes readable without the hunt-and-ambush partial-information pillar giving anything away. Entries dim, fade, and cap; the feed observes scoring and never affects it. A Match Reset clears every entry, so a restarted match always opens with an empty feed.

### Impact Decal
The bullet mark a hit leaves on a world surface, placed at the visible hit point and oriented to the surface's normal. Decals persist through the match under a cap (~200): below the cap nothing fades, and hits landing within a tight cluster on nearly the same spot dedupe into a single mark rather than stacking one per round; past the cap, the oldest fades out as a new one lands, keeping battle history bounded instead of growing forever. A Match Reset clears every decal, the same way it clears the killfeed. Purely presentational: they never affect physics, sensing, or gameplay.

### Cosmetic Recoil
Weapon kick that animates the viewmodel and the camera but never moves the aim point — shots still land where the crosshair was when the trigger was pulled. The distinction matters because real recoil (aim that climbs and must be fought back down) would be a gameplay change: it reaches into hitscan resolution and invalidates the tuned Bot aim spread and reaction delay. Cosmetic Recoil stays entirely in the render layer, so weapon feel can be tuned freely without re-tuning difficulty.
