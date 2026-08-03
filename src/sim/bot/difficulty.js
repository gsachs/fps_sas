// Bot difficulty tunables (KTD4): aim spread and reaction delay, not
// smarter pathing -- these are what make bots beatable. Starting values,
// not a considered balance decision (Outstanding Questions) -- tune here
// during playtest.
export const DEFAULT_DIFFICULTY = {
  aimSpread: 0.15,
  reactionDelayTicks: 20, // ~0.33s at 60Hz before a freshly-acquired target draws fire
};
