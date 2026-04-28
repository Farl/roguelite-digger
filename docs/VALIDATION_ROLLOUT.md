# Small-Scale Validation Rollout

Use this process to validate Phaser safely before full migration.

## Engine Switch
- Default: DOM engine (`main.js`)
- Canary: `?engine=phaser`
- Rollback: `?engine=dom`
- Sticky mode: query selection is saved to localStorage key `yam_engine_mode_v1`

## Auto Rollout (Implemented)
- Deterministic rollout is enabled in [index.html](index.html#L744)
- Current rollout percentage: `5%` (`ROLLOUT_PERCENT`)
- Each browser gets a stable local id in localStorage key `yam_rollout_id_v1`
- Bucket rule: `Number(id) % 100 < ROLLOUT_PERCENT` => Phaser, else DOM
- Forced query parameters still take highest priority (`?engine=phaser` / `?engine=dom`)

## Safety Fallback
- If Phaser CDN fails to load, app automatically falls back to DOM engine
- If `phaser-main.js` import fails, app automatically falls back to DOM engine
- Fallback events are logged in console as warning messages

## Stage 0 (Local Smoke)
- Open with `?engine=phaser`
- Verify: dig left/right, event choice (1/2/3), pause, game-over restart
- Confirm no console errors

## Stage 1 (Internal Canary)
- Ask only a small internal group to use `?engine=phaser`
- Keep everyone else on default DOM engine
- Track bugs in three buckets:
  - input mismatch
  - visual mismatch
  - progression/storage mismatch

## Stage 2 (Soft Public Canary)
- Share a dedicated test URL with `?engine=phaser`
- Keep release default on DOM engine
- Exit criteria:
  - no progression loss issues
  - no blocking input bugs on mobile
  - no severe visual overlap in event/game-over overlays

## Stage 3 (Default Flip)
- Change default engine from `dom` to `phaser` in `index.html`
- Keep DOM path for one release as fallback

## Stage 4 (Cleanup)
- Remove DOM renderer path after stable period
- Keep `game.js` as engine-agnostic gameplay core
