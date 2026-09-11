"""Lay a single-take ElevenLabs narration onto bifrost-demo.mp4, in sync.

    cd submission && python3 tools/sync.py narration.mp3      # -> bifrost-submission.mp4

The take is one generation of SCRIPT.md's whole-video fallback. Eleven v3 ignores
<break> tags, so its pauses don't fall on the scene cuts; left as-is, it drifts
up to 1.7 s behind the picture and runs 2.5 s past the end. This cuts the take into
phrases at its silences and places each at max(cue, previous end + gap): scene openers
and key lines are cued to timeline.json, everything else keeps its natural pause,
capped so no scene overruns.

The picture gains two holds on frames that are already static, so none of it is cut:
0.8 s in the code scene (still from 2:40.3 to 2:44.3) and 1.5 s on the end card.

CUES are timestamps in *this* take. For a new take, re-read phrase starts from the
printed phrase list and update them.
"""
import json, os, subprocess, sys, tempfile
import numpy as np

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
TIMELINE = json.load(open(os.path.join(HERE, "..", "timeline.json")))
HOLDS = [(164.0, 24), (None, 45)]           # (source second, frames at 30 fps); None = end
HOLD_S = {164.0: 24 / 30}

def shift(t):  # a source-video time after the holds are inserted
    return t + sum(d for at, d in HOLD_S.items() if t >= at)

S = {m["id"][:2]: shift(m["at"]) for m in TIMELINE if "id" in m}
CUES = [  # (phrase start in the take, not-before time in the output video, what)
    (0.00,   S["01"] + 0.10, "01 Real-world lenders"),
    (9.74,   10.70,          "   Bifrost doesn't move the asset (cursor on the proof, 0:11.0)"),
    (14.11,  S["02"] + 0.15, "02 Every number here"),
    (23.42,  S["03"] + 0.25, "03 A portfolio is locked"),
    (37.89,  S["04"] + 0.30, "04 Connect a wallet"),
    (48.67,  S["05"] + 0.30, "05 This portfolio has"),
    (52.35,  50.90,          "   Before anyone signs (checks green, 0:51.3)"),
    (64.45,  S["06"] + 0.30, "06 Jump to any portfolio"),
    (66.74,  66.50,          "   This line opened (interest ticking, 1:08.5)"),
    (79.34,  S["07"] + 0.25, "07 Don't trust us"),
    (95.18,  94.30,          "   True (verify() -> true, 1:34.4)"),
    (103.37, S["08"] + 0.30, "08 Now try to lie"),
    (116.17, 116.20,         "   Put the real value back (accepted, 1:57.8)"),
    (122.93, S["09"] + 0.30, "09 Every position is public"),
    (126.50, 128.00,         "   And valuation is a separate role (desk, 2:09.7)"),
    (132.52, S["10"] + 0.20, "10 Lenders fund the pool"),
    (142.69, S["11"] + 0.20, "11 One function does it all"),
    (168.60, S["12"] + 0.35, "12 Bifrost."),
    (170.08, 168.70,         "   Your loan book is already collateral (tagline settles, 2:49.2)"),
]
# where each scene's speech begins in the take; used only to pick a gap cap
SCENE_IN_TAKE = [(0, "01"), (14.0, "02"), (23.0, "03"), (37.5, "04"), (48.3, "05"), (64.3, "06"),
                 (79.0, "07"), (103.0, "08"), (122.5, "09"), (132.0, "10"), (142.5, "11"), (168.4, "12")]
GAP_CAP = {"11": 0.35}  # the code scene is the tight one
DEFAULT_CAP, MIN_GAP, PAD, FADE = 0.55, 0.28, 0.06, int(0.012 * SR)

def run(*a, **kw): return subprocess.run(a, check=True, **kw)

def main(src, video="bifrost-demo.mp4", out="bifrost-submission.mp4"):
    x = np.frombuffer(run("ffmpeg", "-loglevel", "error", "-i", src, "-f", "f32le", "-ac", "1", "-ar",
                          str(SR), "-", capture_output=True).stdout, dtype=np.float32)
    log = subprocess.run(["ffmpeg", "-hide_banner", "-i", src, "-af", "silencedetect=noise=-42dB:d=0.18",
                          "-f", "null", "-"], capture_output=True, text=True).stderr
    sil, s0 = [], None
    for ln in log.splitlines():
        if "silence_start" in ln: s0 = float(ln.split("silence_start:")[1])
        if "silence_end" in ln: sil.append((s0, float(ln.split("silence_end:")[1].split("|")[0])))
    phrases, t = [], 0.0
    for a, b in sil:
        if a - t > 0.12: phrases.append((t, a))
        t = b
    if len(x) / SR - t > 0.12: phrases.append((t, len(x) / SR))

    cue = {}
    for at, v, what in CUES:
        i = min(range(len(phrases)), key=lambda k: abs(phrases[k][0] - at))
        if abs(phrases[i][0] - at) > 0.08:
            sys.exit(f"cue {what!r} expects a phrase at {at}s; nearest is {phrases[i][0]:.2f}s. "
                     f"Phrase starts: {[round(p[0], 2) for p in phrases]}")
        cue[i] = (v, what)

    placed, end = [], 0.0
    for i, (a, b) in enumerate(phrases):
        scene = [s for t0, s in SCENE_IN_TAKE if a >= t0 - 0.01][-1]
        start = end + max(MIN_GAP, min(a - phrases[i - 1][1], GAP_CAP.get(scene, DEFAULT_CAP))) if i else 0.0
        if i in cue: start = max(cue[i][0], end + MIN_GAP)
        placed.append((a, b, start))
        end = start + b - a

    frames = int(run("ffprobe", "-v", "error", "-select_streams", "v", "-count_packets", "-show_entries",
                     "stream=nb_read_packets", "-of", "csv=p=0", video, capture_output=True, text=True).stdout)
    length = (frames + sum(n for _, n in HOLDS)) / 30
    if end > length - 0.5: sys.exit(f"narration ends at {end:.2f}s, past the {length:.2f}s picture")
    y = np.zeros(int(length * SR), dtype=np.float32)
    ramp = np.linspace(0, 1, FADE, dtype=np.float32)
    for a, b, start in placed:
        seg = x[max(0, int((a - PAD) * SR)):int((b + PAD) * SR)].copy()
        seg[:FADE] *= ramp; seg[-FADE:] *= ramp[::-1]
        o = int((start - PAD) * SR); y[o:o + len(seg)] += seg[:len(y) - o]

    with tempfile.TemporaryDirectory() as tmp:
        wav, parts = os.path.join(tmp, "narration.wav"), []
        run("ffmpeg", "-loglevel", "error", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-", wav,
            input=y.tobytes())
        # the holds: encode each side of the cut with tpad, then join without re-encoding
        cut = HOLDS[0][0]
        for k, (seek, n) in enumerate([(("-t", str(cut)), HOLDS[0][1]), (("-ss", str(cut)), HOLDS[1][1])]):
            p = os.path.join(tmp, f"part{k}.mp4"); parts.append(p)
            run("ffmpeg", "-y", "-loglevel", "error", *seek, "-i", video, "-vf",
                f"tpad=stop_mode=clone:stop={n}", "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "18",
                "-pix_fmt", "yuv420p", "-r", "30", p)
        lst = os.path.join(tmp, "parts.txt")
        open(lst, "w").write("".join(f"file '{p}'\n" for p in parts))
        m = subprocess.run(["ffmpeg", "-hide_banner", "-i", wav, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:"
                            "print_format=json", "-f", "null", "-"], capture_output=True, text=True).stderr
        m = json.loads(m[m.rindex("{"):m.rindex("}") + 1])
        norm = (f"loudnorm=I=-16:TP=-1.5:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
                f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:"
                f"offset={m['target_offset']}:linear=true,aresample=48000")
        run("ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-i", wav,
            "-map", "0:v", "-map", "1:a", "-af", norm, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            "-ac", "2", "-movflags", "+faststart", out)

    print(f"{out}: {length:.2f}s, narration ends {end:.2f}s")
    for i, (a, b, start) in enumerate(placed):
        if i in cue:
            v, what = cue[i]
            print(f"  {int(start // 60)}:{start % 60:05.2f}  {what}" + (f"  (+{start - v:.2f}s)" if start - v > 0.05 else ""))

if __name__ == "__main__":
    main(*sys.argv[1:])
