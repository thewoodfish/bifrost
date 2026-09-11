import json, os, subprocess, sys
frames = json.load(open("frames.json")); marks = json.load(open("marks.json"))
t0 = frames[0]["t"]; end = [m for m in marks if m.get("id") == "end"][0]["t"]
lines = []
for i, f in enumerate(frames):
    nxt = frames[i+1]["t"] if i + 1 < len(frames) else end
    d = max(nxt - f["t"], 0.001)
    lines.append(f"file '{os.path.abspath(os.path.basename(f['file']) and os.path.join('frames', os.path.basename(f['file'])))}'\nduration {d:.4f}")
lines.append(f"file '{os.path.abspath(os.path.join('frames', os.path.basename(frames[-1]['file'])))}'")
open("concat.txt", "w").write("\n".join(lines))
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "concat.txt",
  "-vf", "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "slow",
  "-crf", "18", "-movflags", "+faststart", "-t", f"{end - t0 + 0.4:.2f}", sys.argv[1]], check=True)
rel = [({"id": m["id"], "title": m["title"]} if "id" in m else {"beat": m["beat"]}) | {"at": round(m["t"] - t0, 2)} for m in marks]
json.dump(rel, open("timeline.json", "w"), indent=2)
for m in rel: print(f'{int(m["at"]//60)}:{m["at"]%60:05.2f}  ' + (m["id"] if "id" in m else "    · " + m["beat"]))
