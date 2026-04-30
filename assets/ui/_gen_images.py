#!/usr/bin/env python3
"""Generate UI assets via OpenAI Images API."""
import os, base64, pathlib
from openai import OpenAI

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
ui_dir = pathlib.Path("/Users/farl/websim/roguelite-digger/assets/ui")
ui_dir.mkdir(parents=True, exist_ok=True)

# ── Image 1: UI Concept Sheet ──────────────────────────────────────
print("Generating Image 1: UI concept sheet …")
prompt1 = (
    "2D roguelite game UI concept sheet on solid magenta #FF00FF background. "
    "Dark underground cave theme. Show on one sheet: "
    "(1) a 9-slice panel frame — dark stone/obsidian texture with ornate golden border trim and inner glow, "
    "rounded corners radius ~12px, the panel is 240x160px positioned top-left, "
    "(2) a small button shape 80x28px — carved dark stone with gold-etched border, "
    "(3) a danger/red panel variant — same stone but with crimson-red border trim. "
    "All elements share the same dark cave visual language: deep brown-black background #130b04, "
    "warm gold border #c8821a, subtle inner detail lines. "
    "Art style: clean HD indie game UI, NOT pixel art. "
    "Solid magenta #FF00FF background everywhere outside the UI elements."
)
r1 = client.images.generate(model="gpt-image-1", prompt=prompt1, n=1, size="1024x1024", output_format="png")
p1 = ui_dir / "ui-concept-raw.png"
p1.write_bytes(base64.b64decode(r1.data[0].b64_json))
print(f"  Saved → {p1}  ({p1.stat().st_size:,} bytes)")

# ── Image 2: 9-slice Panel Texture ────────────────────────────────
print("Generating Image 2: 9-slice panel texture …")
prompt2 = (
    "Single tileable 9-slice UI panel frame texture, 80x80 pixels, on solid magenta #FF00FF background. "
    "The panel: dark cave stone/obsidian material, color #130b04, with ornate golden border trim "
    "color #c8821a width 3px, rounded corners radius 12px. "
    "Inner subtle detail line offset 4px from border, gold color at 35% opacity. "
    "The 12px corner regions contain the ornate corner decorations (stone carved knots). "
    "Center 56x56 area is flat dark stone texture with very subtle grain — this area will be tiled/stretched. "
    "No glow effects bleeding into corners. "
    "Clean separation between corner art and stretchable edges."
)
r2 = client.images.generate(model="gpt-image-1", prompt=prompt2, n=1, size="1024x1024", output_format="png")
p2 = ui_dir / "ui_panel_raw.png"
p2.write_bytes(base64.b64decode(r2.data[0].b64_json))
print(f"  Saved → {p2}  ({p2.stat().st_size:,} bytes)")

print("All done.")
