"""
Speaks tools/demo/script.json with a natural neural voice, from the free service behind
Microsoft Edge's Read Aloud. Each mood only nudges the pace and the pitch, because big
changes are what make a synthetic voice sound synthetic. Finished lines are kept, and the
timing of every word is saved next to its line.

    pip install edge-tts
    python tools/demo/narrate.py <output folder> [line id ...]

Set DEMO_VOICE to try another voice. The voice is synthetic, and the video's end card says so.
"""
import asyncio
import hashlib
import json
import os
import sys
from pathlib import Path

VOICE = os.environ.get("DEMO_VOICE", "en-US-AndrewMultilingualNeural")
HERE = Path(__file__).resolve().parent

# Speed and pitch, by mood. Anything much larger than this starts to sound like a machine acting.
MOODS = {
    "relatable": ("-2%", "+0Hz"),
    "worried": ("-6%", "-1Hz"),
    "frustrated": ("-5%", "+0Hz"),
    "intrigued": ("-16%", "-1Hz"),
    "dark": ("-12%", "-3Hz"),
    "warm": ("-2%", "+0Hz"),
    "clear": ("-5%", "+0Hz"),
    "curious": ("-2%", "+1Hz"),
    "secretive": ("-8%", "-2Hz"),
    "playful": ("+2%", "+2Hz"),
    "building": ("+3%", "+1Hz"),
    "thrilled": ("+4%", "+3Hz"),
    "delighted": ("+0%", "+2Hz"),
    "dramatic": ("-7%", "-1Hz"),
    "tender": ("-9%", "+0Hz"),
    "somber": ("-14%", "-3Hz"),
    "convinced": ("-5%", "+0Hz"),
    "confident": ("+0%", "+0Hz"),
    "sincere": ("-10%", "-1Hz"),
    "hopeful": ("-2%", "+1Hz"),
    "proud": ("-6%", "+0Hz"),
}


def take_name(line: dict) -> str:
    key = json.dumps([line["say"], VOICE, *MOODS[line["mood"]]])
    return f'{line["id"]}-{hashlib.sha256(key.encode()).hexdigest()[:10]}.mp3'


def load_lines() -> list[dict]:
    return json.loads((HERE / "script.json").read_text(encoding="utf-8"))


async def speak(line: dict, target: Path) -> None:
    import edge_tts

    rate, pitch = MOODS[line["mood"]]
    talk = edge_tts.Communicate(line["say"], VOICE, rate=rate, pitch=pitch, boundary="WordBoundary")
    audio = bytearray()
    words = []
    async for chunk in talk.stream():
        if chunk["type"] == "audio":
            audio += chunk["data"]
        elif chunk["type"] == "WordBoundary":
            # The service counts in units of 100 nanoseconds.
            words.append({"w": chunk["text"], "s": chunk["offset"] / 1e7, "e": (chunk["offset"] + chunk["duration"]) / 1e7})
    target.write_bytes(bytes(audio))
    target.with_suffix(".json").write_text(json.dumps(words), encoding="utf-8")


async def main() -> None:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[2:])
    for line in load_lines():
        if only and line["id"] not in only:
            continue
        target = out / take_name(line)
        if not target.exists():
            await speak(line, target)
            print(f'{line["id"]:<10} {line["mood"]:<10} {target.name}', flush=True)


if __name__ == "__main__":
    asyncio.run(main())
