// The killfeed HUD module (R1-R5, R8): narrates the match by turning each
// kill into a compact, self-expiring line under the score. Entry
// formatting and cap/lifetime bookkeeping are exported pure functions
// (KTD1) -- highlight classes and cap/expiry boundaries are where
// regressions would hide, so they're unit-tested without a DOM; only the
// thin mount below touches the DOM.
import { displayName, LOCAL_PLAYER_ID } from './names.js';
import { DEFAULT_WEAPON_ID } from '../sim/weapon.js';

const FEED_CAP = 6; // visible entries; oldest drops beyond this (R4) -- tuned in U3
const ENTRY_LIFETIME_SECONDS = 5; // total time an entry survives before expiring (R4) -- tuned in U3
const ENTRY_DIM_AFTER_SECONDS = 2; // remaining time at which an entry starts dimming (R4) -- tuned in U3

// R7: killer <weapon glyph> victim -- the glyph stands in for a worded
// sentence (KD2), so it carries the weapon identity by itself. Exact
// characters are tunable (U3); an id with no entry here (or none supplied
// yet, pre-armory) falls back to the pistol's.
const WEAPON_GLYPHS = {
  pistol: '▸',
  machinegun: '≫',
  grenade: '💥',
};

function glyphFor(weaponId) {
  return WEAPON_GLYPHS[weaponId] ?? WEAPON_GLYPHS[DEFAULT_WEAPON_ID];
}

// A hit event -> { text, highlightClass }, or null for a non-lethal hit
// (only kills narrate the feed). Gold when the local player is the killer,
// red when the local player is the victim; a self-kill (a thrower caught in
// their own blast) reads as a death first -- "you died" is the more urgent
// of the two facts (R2).
export function formatEntry(event) {
  if (!event.killed) return null;
  const { shooterId, targetId, weapon } = event;
  const text = `${displayName(shooterId)} ${glyphFor(weapon)} ${displayName(targetId)}`;
  const highlightClass =
    targetId === LOCAL_PLAYER_ID ? 'red' : shooterId === LOCAL_PLAYER_ID ? 'gold' : 'neutral';
  return { text, highlightClass };
}

// Prepends a new entry (newest first) and drops the oldest beyond FEED_CAP
// (R4) -- the cap applies on add, not on age, so a kill flurry never grows
// the feed past its bound even mid-burst. A non-lethal event (formatEntry
// returns null) leaves entries untouched.
export function addEntry(entries, event) {
  const formatted = formatEntry(event);
  if (!formatted) return entries;
  return [{ ...formatted, remaining: ENTRY_LIFETIME_SECONDS }, ...entries].slice(0, FEED_CAP);
}

// Per-frame lifetime countdown (KTD2), mirroring tracer.js's update(dt):
// decrements every entry's remaining time, marks it dimmed once inside the
// dim window, and drops anything whose time has fully elapsed (R4).
export function ageEntries(entries, dt) {
  return entries
    .map((entry) => ({ ...entry, remaining: entry.remaining - dt }))
    .filter((entry) => entry.remaining > 0)
    .map((entry) => ({ ...entry, dimmed: entry.remaining <= ENTRY_DIM_AFTER_SECONDS }));
}

const HIGHLIGHT_COLORS = { gold: '#ffd23f', red: '#ff3b3b', neutral: '#fff' };

// R1, R8: mounts under the score, newest entry first. Call site order
// matters -- main.js appends this to the app container before creating the
// shell screens, so it paints underneath them and inherits their overlay
// coverage for free (AE5), the same way the rest of the HUD does. Updates
// only ever run from main.js's simRunning per-frame block, so a paused
// match freezes the feed by construction -- no visibility logic here.
export function createKillfeed(container) {
  const root = document.createElement('div');
  root.style.cssText =
    'position:absolute;right:16px;top:56px;display:flex;flex-direction:column;gap:2px;' +
    'align-items:flex-end;pointer-events:none;font-family:system-ui,sans-serif;font-size:0.95rem;' +
    'text-shadow:0 1px 3px #000;';
  container.appendChild(root);

  // One row element per cap slot, created once and reused -- render() runs
  // every frame (via update below), so updating each cached row in place
  // mirrors hud.js's cached elements instead of tearing down and rebuilding
  // DOM nodes 60 times a second.
  const rows = Array.from({ length: FEED_CAP }, () => {
    const row = document.createElement('div');
    root.appendChild(row);
    return row;
  });

  let entries = [];

  function render() {
    rows.forEach((row, index) => {
      const entry = entries[index];
      row.style.display = entry ? 'block' : 'none';
      if (!entry) return;
      row.textContent = entry.text;
      row.style.color = HIGHLIGHT_COLORS[entry.highlightClass] ?? HIGHLIGHT_COLORS.neutral;
      row.style.opacity = entry.dimmed ? '0.4' : '1';
    });
  }

  function addKill(event) {
    entries = addEntry(entries, event);
    render();
  }

  function update(dt) {
    entries = ageEntries(entries, dt);
    render();
  }

  // R13-style match reset (mirrors grenadeSystem.resetAll()/pickupSystem.resetAll()):
  // clears every entry so a new match opens with an empty feed instead of the
  // previous match's frozen lines bleeding through pause/results and into play.
  function resetAll() {
    entries = [];
    render();
  }

  return { addKill, update, resetAll };
}
