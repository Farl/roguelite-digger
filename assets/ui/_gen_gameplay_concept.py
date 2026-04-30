#!/usr/bin/env python3
"""Generate gameplay concept art for 挖地瓜 Roguelite."""
import os, base64, pathlib
from openai import OpenAI

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
out = pathlib.Path(__file__).parent / "gameplay-concept-raw.png"

prompt = (
    "Pixel art game concept art, 480x800 portrait layout, solid magenta #FF00FF background ONLY outside the game frame. "
    "Show the complete gameplay screen of a 2-column underground cave digging roguelite game. "
    "The layout from top to bottom: "
    "TOP HUD BAR (y 0-110px): Dark stone background #1a1009. Three stat labels: 深度 (depth), 工具 (tools), 最佳 (best) "
    "in pixel font, warm cream color. Below: score text, streak text, status line. Pixel art gold tool-durability meter bar. "
    "TILE GRID (y 126-650px): Two columns side by side with 18px gap between, 18px side margins. "
    "Each column is approximately 222px wide. 5 tile rows per column, each tile 105px tall. "
    "Left column tiles from top: dirt (dark brown), dirt, stone (gray), dirt, diamond (cyan gem). "
    "Right column: dirt, event tile (orange rune glow), dirt, dirt, puzzle tile (golden). "
    "The tiles are full-bleed pixel art with no gaps. Each tile fills its cell completely. "
    "Tile textures: retro pixel cave tiles, warm earthy palette. "
    "WORKER CHARACTER: 72x72px pixel art yam miner with pickaxe, positioned left of left column at y 100. "
    "Warm earth tones, readable silhouette. "
    "BOTTOM BUTTON BAR (y 748-776px): 6 small pixel art stone buttons in a row: Pause Sound Help Favorite Restart Clear. "
    "Each button has carved dark stone appearance with gold pixel border. "
    "OVERALL FEEL: Deep underground cave. Dark warm atmosphere. Pixel art 16-bit RPG quality. "
    "Magenta #FF00FF only outside the 480x800 game frame."
)

print("Generating gameplay concept art…", flush=True)
r = client.images.generate(
    model="gpt-image-1",
    prompt=prompt,
    n=1,
    size="1024x1024",
    output_format="png"
)
out.write_bytes(base64.b64decode(r.data[0].b64_json))
print(f"DONE: {out}  ({out.stat().st_size:,} bytes)")
