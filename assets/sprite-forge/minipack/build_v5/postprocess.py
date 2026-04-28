#!/usr/bin/env python3.11
"""
Post-process v5 raw sheets:
 - worker-raw.png (1024x1024 2x2) → worker.png (256x64 spritesheet, 4 frames)
 - tiles-raw.png (1024x1536 2x3)  → tile_dirt/stone/diamond/event/puzzle/empty.png (64x64 each)
Chroma-key removes solid magenta (#FF00FF ±threshold).
"""
import sys, pathlib
from PIL import Image

RAW_DIR = pathlib.Path(__file__).parent / "raw"
OUT_DIR  = pathlib.Path(__file__).parent.parent  # assets/sprite-forge/minipack/

TILE_NAMES = ["tile_dirt", "tile_stone", "tile_diamond", "tile_event", "tile_puzzle", "tile_empty"]
FRAME_SIZE = 64          # output px per frame / tile
CHROMA_THRESHOLD = 80    # how close to #FF00FF counts as background

def chroma_key(img: Image.Image, threshold: int) -> Image.Image:
    """Remove magenta (#FF00FF) background, return RGBA."""
    img = img.convert("RGBA")
    data = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = data[x, y]
            dist = ((r - 255)**2 + g**2 + (b - 255)**2) ** 0.5
            if dist < threshold:
                data[x, y] = (0, 0, 0, 0)
    return img

def split_grid(img: Image.Image, cols: int, rows: int):
    """Split image into (cols*rows) cells, row-major order."""
    cw = img.width  // cols
    ch = img.height // rows
    cells = []
    for row in range(rows):
        for col in range(cols):
            box = (col * cw, row * ch, (col+1) * cw, (row+1) * ch)
            cells.append(img.crop(box))
    return cells

def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # ── Worker spritesheet ──────────────────────────────────────────────────
    worker_raw = Image.open(RAW_DIR / "worker-raw.png")
    frames = split_grid(worker_raw, cols=2, rows=2)
    strip = Image.new("RGBA", (FRAME_SIZE * 4, FRAME_SIZE), (0, 0, 0, 0))
    for i, frame in enumerate(frames):
        keyed = chroma_key(frame, CHROMA_THRESHOLD)
        keyed = keyed.resize((FRAME_SIZE, FRAME_SIZE), Image.LANCZOS)
        strip.paste(keyed, (i * FRAME_SIZE, 0), keyed)
    out_path = OUT_DIR / "worker.png"
    strip.save(out_path, "PNG")
    print(f"✓ worker.png  → {out_path}  ({strip.width}×{strip.height})")

    # ── Tile icons ──────────────────────────────────────────────────────────
    tiles_raw = Image.open(RAW_DIR / "tiles-raw.png")
    cells = split_grid(tiles_raw, cols=2, rows=3)
    for i, (name, cell) in enumerate(zip(TILE_NAMES, cells)):
        keyed = chroma_key(cell, CHROMA_THRESHOLD)
        keyed = keyed.resize((FRAME_SIZE, FRAME_SIZE), Image.LANCZOS)
        out_path = OUT_DIR / f"{name}.png"
        keyed.save(out_path, "PNG")
        print(f"✓ {name}.png → {out_path}")

    print("\nAll done!")

if __name__ == "__main__":
    main()
