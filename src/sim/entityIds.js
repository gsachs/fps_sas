// The one entity-id constant every layer (sim, render, shell, ui) needs to
// recognize "the local player" among world.js's entities -- lives in sim/
// because it names a sim concept (an entity id), the same reasoning that
// keeps DEFAULT_WEAPON_ID in weapon.js and MAX_HEALTH in health.js: the
// domain layer owns its own identifiers, everyone else imports them instead
// of re-typing the literal (KTD2-style guard in architecture.test.js).
export const LOCAL_PLAYER_ID = 'player'; // matches main.js's own entity id for the local player
