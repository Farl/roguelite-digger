# Sprite Forge Brief (for Phaser)

Use the generate2dsprite workflow for each batch.

## Batch A - Worker
- asset_type: player
- action: walk
- view: side
- sheet: 2x2
- art_style: retro_pixel
- prompt: sturdy yam miner with pickaxe, warm earth palette, readable silhouette, fixed frame scale, solid #FF00FF background

## Batch B - Tile Icons
- asset_type: prop
- action: single
- view: side
- sheet: 2x3
- art_style: retro_pixel
- prompt: six tile icons (dirt, stone, diamond, event rune, puzzle piece, empty crack), centered, same visual scale, solid #FF00FF background

## Batch C - FX
- asset_type: fx
- bundle: spell_bundle
- includes:
  - dig spark (projectile 1x4)
  - hit impact (impact 2x2)
  - milestone burst (explode 2x2)
- art_style: retro_pixel
- prompt: earthy gold sparks and dust burst, high readability over dark cave background, solid #FF00FF background

## Processing Requirements
- Keep strict frame containment
- Shared scale across frames
- Export transparent sheet and gif previews
- Output into assets/sprite-forge/
