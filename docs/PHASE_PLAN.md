# Roguelite Digger Phaser Migration Plan

This project now follows a Phaser migration flow.

## Phase 1 - Gameplay Foundation (Done)
- Core dig loop, hazards, events, puzzle relics, run stats
- Input: touch + keyboard
- Stability: pause, step throttle, auto-dig safety

## Phase 2 - Phaser Runtime Bootstrap (Start Now)
Goal: move rendering/input loop from DOM renderer to Phaser Scene.

Deliverables:
- Phaser scene entrypoint (`phaser-main.js`)
- Keep existing `game.js` gameplay core unchanged
- Touch + keyboard control mapped in Phaser
- Event and game-over overlay shown in Phaser

Rules:
- Keep business logic in `game.js`
- Phaser layer is presentation/input only
- Keep DOM version as fallback until sprite pass is complete

Validation gates:
- Start with canary URLs using `?engine=phaser`
- Keep default engine on DOM until blocker count is zero
- Flip default only after staged verification in `docs/VALIDATION_ROLLOUT.md`

## Phase 3 - Visual Asset Pipeline
Goal: replace emoji/placeholder visuals with consistent sprite assets.

Deliverables:
- Character sprite sheet (worker)
- Tile icon set (dirt, stone, diamond, event, puzzle)
- FX bundle (hit, dig spark, milestone burst)
- UI icon set (tool, score, relics)

Rules:
- Use sprite generation workflow (ai-sprite-forge style via generate2dsprite skill)
- Raw sheets use solid #FF00FF background
- Each animated sheet must have fixed frame bounds and consistent scale
- Every asset batch includes a transparent export + GIF preview

## Phase 4 - Integration and Polish
- Replace current inline emoji rendering in main.js with image-based sprites
- Add animation states in renderTiles/renderWorker
- Tune contrast and readability for mobile

## Phase 5 - Content Expansion
- Add new event families and relic branches tied to visual assets
- Introduce seasonal palette packs and alternate worker skins

## Release Rhythm
- One feature batch per tag
- Tag format: vX.Y.0
- Push main + tag for GitHub Pages deploy
