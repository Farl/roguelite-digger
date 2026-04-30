#!/usr/bin/env python3
"""Generate gameplay production assets (pixel style) via gpt-image-1."""
import base64
import concurrent.futures
import os
import pathlib

from openai import OpenAI

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
out_dir = pathlib.Path("assets/ui/gameplay")
out_dir.mkdir(parents=True, exist_ok=True)

JOBS = [
    {
        "name": "bg_gameplay_raw.png",
        "size": "1024x1536",
        "prompt": (
            "Pixel art portrait game background for a cave roguelite, no UI text, no characters, no buttons. "
            "Dark warm underground palette. Full frame background texture only. "
            "Top HUD strip area (top 110px proportionally) is dark carved stone with subtle gold seams. "
            "Middle gameplay field is rocky cave wall with subtle depth gradient, not noisy. "
            "Bottom strip area (bottom 52px proportionally) is dark stone bar matching top strip. "
            "Include gentle vignette and tiny cave grain. No magenta. No white margins. Fill entire image. "
            "16-bit retro pixel art aesthetic."
        ),
    },
    {
        "name": "tile_dirt_v2.png",
        "size": "1024x1024",
        "prompt": (
            "Single square pixel art tile texture of cave dirt. Warm dark brown earth (#4a2c12 / #2a1608), "
            "subtle pebbles, no border frame, edge-to-edge full bleed so neighboring tiles connect seamlessly. "
            "No text, no icons, no extra objects."
        ),
    },
    {
        "name": "tile_stone_v2.png",
        "size": "1024x1024",
        "prompt": (
            "Single square pixel art tile texture of cracked cave stone. Gray-brown rock, hard look, "
            "subtle cracks, no border frame, edge-to-edge full bleed seamless when tiled."
        ),
    },
    {
        "name": "tile_diamond_v2.png",
        "size": "1024x1024",
        "prompt": (
            "Single square pixel art cave tile with embedded cyan diamond crystal. "
            "Dark stone base with one large cyan gem and small sparkles. "
            "No border frame, full bleed, seamless edges."
        ),
    },
    {
        "name": "tile_event_v2.png",
        "size": "1024x1024",
        "prompt": (
            "Single square pixel art cave tile for event trigger. "
            "Dark rock with ancient orange glowing rune carved in center. "
            "No border frame, full bleed, seamless edges."
        ),
    },
    {
        "name": "tile_puzzle_v2.png",
        "size": "1024x1024",
        "prompt": (
            "Single square pixel art cave tile for puzzle. "
            "Dark stone with golden spiral maze sigil in center, mystical style. "
            "No border frame, full bleed, seamless edges."
        ),
    },
    {
        "name": "tile_empty_v2.png",
        "size": "1024x1024",
        "prompt": (
            "Single square pixel art dug-out cave tile. "
            "Darker hollow earth cavity, low contrast, no special icon. "
            "No border frame, full bleed, seamless edges."
        ),
    },
    {
        "name": "worker_v2.png",
        "size": "1024x1024",
        "prompt": (
            "Single pixel art character sprite of a yam miner worker, full body, facing right. "
            "Wide brim hat, pickaxe, warm amber overalls, readable silhouette, 16-bit RPG style. "
            "Dark outline, clean sprite on transparent-looking plain dark background. "
            "Only one character, centered, no text."
        ),
    },
]


def generate(job):
    resp = client.images.generate(
        model="gpt-image-1",
        prompt=job["prompt"],
        n=1,
        size=job["size"],
        output_format="png",
    )
    path = out_dir / job["name"]
    path.write_bytes(base64.b64decode(resp.data[0].b64_json))
    return path


print("Generating gameplay assets v2 in parallel...")
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    futures = [pool.submit(generate, job) for job in JOBS]
    for f in concurrent.futures.as_completed(futures):
        p = f.result()
        print(f"saved: {p} ({p.stat().st_size:,} bytes)")

print("done")
