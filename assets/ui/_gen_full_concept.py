#!/usr/bin/env python3
"""
Full game concept art generation — 3 images via gpt-image-1 CLI.
Run: .venv/bin/python3 assets/ui/_gen_full_concept.py
"""
import os, base64, pathlib, concurrent.futures
from openai import OpenAI

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
ui_dir = pathlib.Path("assets/ui")
ui_dir.mkdir(parents=True, exist_ok=True)

JOBS = [
    # ── IMAGE A: Main gameplay screen ─────────────────────────────────
    dict(
        key="A",
        path=ui_dir / "concept-A-gameplay.png",
        size="1024x1536",
        prompt=(
            "Pixel art game screenshot, portrait layout 480x800, dark underground cave roguelite. "
            "Game title: 挖地瓜 Roguelite (Yam Digger). "
            "Dark cave background color #130b04. "
            "\n\n"
            "TOP HUD ZONE (top 110px of screen): "
            "Full-width dark stone panel. Three stat boxes in a row: "
            "【深度 Depth: 75】【工具 Tools: 3】【最佳 Best: 114】 "
            "in pixel font, cream color #e8d8a0. "
            "Below: gold pixel-art horizontal durability bar (6 segments). "
            "Score: '得分 327' large, '連刺 ×7 streak' smaller, status line '穩定 Stable'. "
            "Right side: small portrait icon of a yam miner character. "
            "\n\n"
            "TILE GRID ZONE (y 126–650): "
            "Two columns, 18px side margins, 18px gap between columns, each column 222px wide. "
            "5 rows, each tile 105px tall, full-bleed pixel art (no gaps between tiles). "
            "Tile types visible: "
            "LEFT col top-to-bottom: [dirt brown], [dirt brown], [stone gray cracked], [dirt brown], [diamond cyan gem sparkle]; "
            "RIGHT col top-to-bottom: [dirt brown], [event tile — orange glowing ancient rune carving], [dirt brown], [dirt brown], [puzzle tile — golden spiral maze]. "
            "Each tile is richly detailed pixel art, warm underground palette. "
            "Tile borders are subtle 1px darker shade. "
            "\n\n"
            "WORKER CHARACTER (left of left column, y ~80-180): "
            "72x72 pixel art miner: stout body, wide brim hat, pickaxe raised, warm amber overalls, "
            "readable silhouette, facing right toward the tiles. "
            "Name tag '挖地瓜工' below in pixel font. "
            "\n\n"
            "BOTTOM BUTTON BAR (y 748–776): "
            "Full-width dark stone strip. 6 pixel art stone buttons evenly spaced: "
            "[暫停 Pause] [音開 Audio] [說明 Help] [收藏 Collection] [重開 Restart] [清進度 Clear]. "
            "Each button: carved stone look, gold pixel border 1px, cream text, pressed-shadow on bottom edge. "
            "\n\n"
            "OVERALL: Authentic 16-bit RPG pixel art. "
            "Warm dark cave atmosphere. Deep browns, muted greens, gold accents. "
            "Game frame fills entire canvas — no magenta, no white margin, no border."
        ),
    ),

    # ── IMAGE B: All modal panels ──────────────────────────────────────
    dict(
        key="B",
        path=ui_dir / "concept-B-modals.png",
        size="1024x1536",
        prompt=(
            "Pixel art UI design reference sheet for a dark cave roguelite game. "
            "Dark cave background #130b04 fills the entire canvas. "
            "Show FIVE modal/overlay screens arranged vertically, each separated by a thin gold divider line. "
            "\n\n"
            "PANEL 1 — EVENT MODAL (three-card horizontal layout): "
            "Title '遭遇事件 Event' in gold pixel font at top. "
            "Flavor text line below in cream. "
            "Three SIDE-BY-SIDE choice cards, each ~126px wide × 128px tall, gold border pixel art stone panel. "
            "Card 1: icon of a gem + '獲得寶石 +3' text, highlighted border glow. "
            "Card 2: icon of tools + '修復工具' text. "
            "Card 3: icon of skull + '跳過 Skip'. "
            "Each card has pixel art illustration in top half, text description in bottom half. "
            "\n\n"
            "PANEL 2 — DIFFICULTY SELECT (three-card horizontal): "
            "Title '選擇難度 Difficulty' in gold pixel font. "
            "Three side-by-side cards: [簡單 Easy — green accent], [普通 Normal — gold accent], [困難 Hard — red accent]. "
            "Each card shows difficulty icon + stat differences. "
            "\n\n"
            "PANEL 3 — GAME OVER MODAL (red crimson variant): "
            "Dark stone panel with RED border #e05050 instead of gold. "
            "Title '遊戲結束 GAME OVER' in red pixel font. "
            "Score summary: 最終深度, 得分, 最高連刺. "
            "Two buttons: [重新開始 Restart] [返回 Back]. "
            "\n\n"
            "PANEL 4 — COLLECTION MODAL: "
            "Gold border stone panel. Title '道具收藏 Collection'. "
            "4×3 grid of small item slots (pixel art icons: gems, tools, coins, potions). "
            "Each slot shows count badge. "
            "\n\n"
            "PANEL 5 — HELP MODAL: "
            "Gold border stone panel. Title '說明 Help'. "
            "Icon + one-line descriptions for 5 tile types in a list: "
            "[土塊 Dirt — dig for score], [石頭 Stone — tough], [寶石 Diamond — bonus], [事件 Event — triggers choice], [謎題 Puzzle — solve for reward]. "
            "\n\n"
            "All panels use consistent pixel art visual language: "
            "dark obsidian stone #130b04, gold border #c8821a, cream text #e8d8a0, "
            "ornate corner decorations (carved stone knots). "
            "Pixel art style, 16-bit RPG quality."
        ),
    ),

    # ── IMAGE C: Tile + character sprite reference ─────────────────────
    dict(
        key="C",
        path=ui_dir / "concept-C-sprites.png",
        size="1024x1024",
        prompt=(
            "Pixel art sprite reference sheet for a dark cave roguelite game. "
            "Dark cave background #130b04. Gold pixel art title at top: '挖地瓜 Roguelite — Sprite Reference'. "
            "\n\n"
            "SECTION 1 — TILE TYPES (top half, 2 rows): "
            "Show 8 tiles, each 105px square pixel art, labeled below in cream pixel font. "
            "Left to right, row 1: "
            "[土塊 Dirt — warm dark brown, rough cave earth texture, subtle pebbles], "
            "[石頭 Stone — medium gray, cracked surface, harder look], "
            "[深岩 Deep Rock — dark blue-gray, denser cracks, rare], "
            "[鐵礦 Iron — stone with orange-brown metal veins]. "
            "Row 2: "
            "[寶石 Diamond — dark stone with large cyan gem crystal embedded, sparkle pixels], "
            "[事件 Event — ancient rune carved in orange glow, mystical cave wall], "
            "[謎題 Puzzle — golden spiral maze pattern, ornate stone tile], "
            "[空磚 Empty — darker hollow, already dug]. "
            "\n\n"
            "SECTION 2 — CHARACTER (bottom-left quarter): "
            "The miner worker '挖地瓜工': "
            "4-frame walk cycle sheet (4 frames in a row, each 72x72px). "
            "Stout pixel art character: wide brim hat, amber overalls, pickaxe on shoulder. "
            "Plus 1 idle frame and 1 dig-swing frame beside the walk sheet. "
            "\n\n"
            "SECTION 3 — UI ELEMENTS (bottom-right quarter): "
            "Row of 6 button sprites (each ~60x22px): dark stone, gold pixel border, cream label text. "
            "Below: durability bar — 6-segment pixel art bar in gold/orange, full and empty states. "
            "Below: item icon examples — gem (cyan), tool (orange wrench), coin (gold), heart (red). "
            "\n\n"
            "Pixel art, 16-bit RPG style. Warm dark cave palette. All elements clearly labeled."
        ),
    ),
]


def generate(job):
    key = job["key"]
    print(f"[{key}] Generating ({job['size']}) → {job['path'].name} …")
    resp = client.images.generate(
        model="gpt-image-1",
        prompt=job["prompt"],
        n=1,
        size=job["size"],
        output_format="png",
    )
    job["path"].write_bytes(base64.b64decode(resp.data[0].b64_json))
    size = job["path"].stat().st_size
    print(f"[{key}] Saved → {job['path']}  ({size:,} bytes)")
    return key, str(job["path"])


print("Launching 3 concept art generations in parallel …\n")
results = {}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    futures = {pool.submit(generate, j): j["key"] for j in JOBS}
    for f in concurrent.futures.as_completed(futures):
        key, path = f.result()
        results[key] = path

print("\n=== DONE ===")
for k in "ABC":
    print(f"  [{k}] {results[k]}")
