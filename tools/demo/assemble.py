"""
Trims each spoken line, lays them on one track with their pauses, and times every word,
so the captions and the animations can land on the words they belong to. Nothing here
stretches the speech: slowing a voice down is what makes it sound like a machine.

    pip install numpy soundfile
    python tools/demo/assemble.py <clips folder> <output folder>

Writes narration.wav and timeline.json.
"""
import difflib
import json
import re
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from narrate import load_lines, take_name  # noqa: E402

SAMPLE_RATE = 24_000
LEAD_IN = 0.6
TARGET_DB = -20.0
# Quiet lines stay quiet, and the big moment is allowed to be big.
MOOD_GAIN = {"somber": -2.5, "thrilled": 1.5, "proud": 1.0, "dark": -1.0}
MAX_CAPTION = 44


def tokens(text: str) -> list[str]:
    return text.split()


def plain(word: str) -> str:
    return re.sub(r"[^a-z0-9']", "", word.lower().replace("’", "'"))


def trim(y: np.ndarray) -> tuple[np.ndarray, float]:
    """Cuts the silence off both ends, and says how much came off the front."""
    frame = int(0.01 * SAMPLE_RATE)
    level = np.sqrt(np.convolve(y**2, np.ones(frame) / frame, "same"))
    loud = np.where(level > max(level.max() * 0.03, 0.002))[0]
    if len(loud) == 0:
        return y, 0.0
    a = max(0, loud[0] - int(0.05 * SAMPLE_RATE))
    b = min(len(y), loud[-1] + int(0.14 * SAMPLE_RATE))
    y = y[a:b].copy()
    fade = int(0.012 * SAMPLE_RATE)
    y[:fade] *= np.linspace(0, 1, fade)
    y[-fade:] *= np.linspace(1, 0, fade)
    return y, a / SAMPLE_RATE


def level_to(y: np.ndarray, db: float) -> np.ndarray:
    frame = int(0.05 * SAMPLE_RATE)
    rms = np.array([np.sqrt(np.mean(y[i : i + frame] ** 2)) for i in range(0, max(1, len(y) - frame), frame)])
    voiced = rms[rms > rms.max() * 0.25]
    gain = 10 ** ((db - 20 * np.log10(np.mean(voiced) + 1e-9)) / 20)
    y = y * gain
    peak = np.abs(y).max()
    return y * (0.89 / peak) if peak > 0.89 else y


def timed_words(say: str, spoken: list[dict], offset: float, seconds: float) -> list[dict]:
    """Puts the voice's own timings on the script's words, punctuation and all."""
    want = tokens(say)
    a, b = [plain(w) for w in want], [plain(w["w"]) for w in spoken]
    times: list[tuple[float, float] | None] = [None] * len(want)
    for block in difflib.SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks():
        for k in range(block.size):
            times[block.a + k] = (spoken[block.b + k]["s"] - offset, spoken[block.b + k]["e"] - offset)
    known = [i for i, t in enumerate(times) if t]
    out = []
    for i, w in enumerate(want):
        if times[i]:
            s, e = times[i]
        else:
            before = max([k for k in known if k < i], default=None)
            after = min([k for k in known if k > i], default=None)
            lo = times[before][1] if before is not None else 0.0
            hi = times[after][0] if after is not None else seconds
            gap_a = i - (before if before is not None else -1)
            gap_n = (after if after is not None else len(want)) - (before if before is not None else -1)
            s = lo + (hi - lo) * (gap_a - 1) / gap_n
            e = lo + (hi - lo) * gap_a / gap_n
        out.append({"w": w, "s": round(max(0.0, float(s)), 3), "e": round(float(e), 3)})
    missed = [w for i, w in enumerate(want) if not times[i]]
    if missed:
        print(f"    no timing from the voice for: {missed}")
    return out


def captions_of(words: list[dict], ends_at: float) -> list[dict]:
    chunks: list[list[dict]] = [[]]
    for i, w in enumerate(words):
        chunks[-1].append(w)
        length = sum(len(x["w"]) + 1 for x in chunks[-1])
        next_len = len(words[i + 1]["w"]) if i + 1 < len(words) else 0
        strong = re.search(r"[.?!:]$|\.\.\.$", w["w"])
        weak = w["w"].endswith(",") and length > 16
        if i + 1 < len(words) and (strong or weak or length + next_len + 1 > MAX_CAPTION):
            chunks.append([])
    out = []
    for i, chunk in enumerate(chunks):
        end = chunks[i + 1][0]["s"] if i + 1 < len(chunks) else ends_at
        out.append({"text": " ".join(x["w"] for x in chunk), "s": chunk[0]["s"], "e": round(end, 3)})
    return out


def main() -> None:
    clips, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)

    entries, audio, at = [], [], LEAD_IN
    for line in load_lines():
        path = clips / take_name(line)
        if not path.exists():
            raise SystemExit(f'{line["id"]} has not been spoken yet')
        y, rate = sf.read(path)
        y = y.mean(axis=1) if y.ndim > 1 else y
        if rate != SAMPLE_RATE:
            y = np.interp(np.linspace(0, len(y) - 1, int(len(y) * SAMPLE_RATE / rate)), np.arange(len(y)), y)
        y, cut = trim(y)
        y = level_to(y, TARGET_DB + MOOD_GAIN.get(line["mood"], 0.0))
        speech = len(y) / SAMPLE_RATE
        spoken = json.loads(path.with_suffix(".json").read_text(encoding="utf-8"))
        words = timed_words(line["say"], spoken, cut, speech)
        whole = speech + line["after"]
        entries.append(
            {
                "id": line["id"],
                "mood": line["mood"],
                "start": round(at, 3),
                "end": round(at + whole, 3),
                "speech": round(speech, 3),
                "words": words,
                "captions": captions_of(words, speech + min(line["after"], 0.35)),
                "accent": line.get("accent", []),
            }
        )
        audio.append((at, y))
        at += whole

    track = np.zeros(int(at * SAMPLE_RATE) + 1)
    for start, y in audio:
        i = int(start * SAMPLE_RATE)
        track[i : i + len(y)] += y
    sf.write(out / "narration.wav", track, SAMPLE_RATE, subtype="PCM_16")
    (out / "timeline.json").write_text(json.dumps({"total": round(at, 3), "lines": entries}, indent=1), encoding="utf-8")
    print(f"{len(entries)} lines, {at:.1f} seconds")
    for e in entries:
        print(f'  {e["id"]:<10} {e["start"]:6.1f}s  speech {e["speech"]:5.1f}s')


if __name__ == "__main__":
    main()
