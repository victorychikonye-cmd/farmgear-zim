"""
ClipAI backend: upload a long video, get back short captioned vertical clips.

Pipeline: FFmpeg audio -> faster-whisper transcript (word timestamps)
          -> Claude picks the best moments -> FFmpeg cuts, crops 9:16, burns captions.

Run locally:  uvicorn main:app --host 0.0.0.0 --port 8000
Needs: ffmpeg on PATH, and the ANTHROPIC_API_KEY environment variable.
"""
import json
import os
import re
import subprocess
import threading
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

BASE = Path(__file__).parent.resolve()
DATA = Path(os.getenv("DATA_DIR", BASE / "jobs")).resolve()
DATA.mkdir(parents=True, exist_ok=True)

LLM_MODEL = os.getenv("CLIP_LLM_MODEL", "claude-sonnet-5-5")
WHISPER_SIZE = os.getenv("WHISPER_MODEL", "base")  # tiny / base / small / medium
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "500"))
ACCESS_KEY = os.getenv("ACCESS_KEY", "")  # optional: require this key from the website
MAX_CLIPS = int(os.getenv("MAX_CLIPS", "20"))
MAX_VIDEO_MINUTES = int(os.getenv("MAX_VIDEO_MINUTES", "180"))  # for pasted links

LENGTHS = {"short": (20, 40), "medium": (30, 60), "long": (60, 90)}

app = FastAPI(title="ClipAI")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_whisper = None
_whisper_lock = threading.Lock()
_status_lock = threading.Lock()


# ---------- helpers ----------

def job_dir(job_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{12}", job_id):
        raise HTTPException(404, "Job not found")
    return DATA / job_id


def set_status(job_id: str, **kw):
    path = DATA / job_id / "status.json"
    with _status_lock:
        cur = json.loads(path.read_text()) if path.exists() else {}
        cur.update(kw)
        path.write_text(json.dumps(cur))


def run(cmd, cwd=None):
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"{cmd[0]} failed: {p.stderr[-600:]}")
    return p.stdout


def probe_duration(video: Path) -> float:
    out = run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(video),
    ])
    return float(out.strip())


def get_whisper():
    global _whisper
    with _whisper_lock:
        if _whisper is None:
            from faster_whisper import WhisperModel
            _whisper = WhisperModel(WHISPER_SIZE, device="cpu", compute_type="int8")
        return _whisper


# ---------- pipeline steps ----------

def transcribe(video: Path, work: Path):
    audio = work / "audio.wav"
    run(["ffmpeg", "-y", "-i", str(video), "-vn", "-ac", "1", "-ar", "16000", str(audio)])
    model = get_whisper()
    segments, _info = model.transcribe(str(audio), word_timestamps=True, vad_filter=True)
    segs, words = [], []
    for s in segments:
        segs.append({"start": s.start, "end": s.end, "text": s.text.strip()})
        for w in (s.words or []):
            words.append({"w": w.word.strip(), "start": w.start, "end": w.end})
    audio.unlink(missing_ok=True)
    return segs, words


def pick_moments(segs, duration, count, min_len, max_len):
    import anthropic

    transcript = "\n".join(f"[{s['start']:.1f}] {s['text']}" for s in segs)
    transcript = transcript[:150_000]
    prompt = f"""You are an expert short-form video editor. Below is a timestamped transcript
(timestamps are seconds from the start) of a video that is {duration:.0f} seconds long.

Pick the {count} best moments to turn into standalone short clips for TikTok, Reels and Shorts.
Rules:
- Each clip must be between {min_len} and {max_len} seconds long.
- Start on a strong hook (a bold claim, question, story start or surprise).
- End on a complete thought, never mid-sentence.
- Prefer moments that make sense with no outside context.
- Clips must not overlap.
- Use only timestamps that exist in the transcript.

Return ONLY a JSON array, no other text. Each item:
{{"start": <seconds>, "end": <seconds>, "title": "<catchy title, max 8 words>", "reason": "<one short sentence>"}}

TRANSCRIPT:
{transcript}"""

    client = anthropic.Anthropic()
    msg = client.messages.create(
        model=LLM_MODEL,
        max_tokens=4000,
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    a, b = text.find("["), text.rfind("]")
    if a == -1 or b == -1:
        raise RuntimeError("The AI did not return clip suggestions. Try again.")
    raw = json.loads(text[a:b + 1])

    moments = []
    for m in raw:
        try:
            start = max(0.0, float(m["start"]))
            end = min(duration, float(m["end"]))
        except (KeyError, TypeError, ValueError):
            continue
        if end - start < 8:
            continue
        if end - start > max_len + 15:
            end = start + max_len
        moments.append({
            "start": start,
            "end": end,
            "title": str(m.get("title", "Clip"))[:80],
            "reason": str(m.get("reason", ""))[:200],
        })
    moments.sort(key=lambda x: x["start"])
    # drop overlaps
    clean = []
    for m in moments:
        if not clean or m["start"] >= clean[-1]["end"]:
            clean.append(m)
    return clean[:count]


def ass_time(t: float) -> str:
    t = max(0.0, t)
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def build_ass(words, start, end, path: Path):
    header = (
        "[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
        "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
        "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        "Style: Default,Arial,76,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,1,0,0,0,"
        "100,100,0,0,1,5,2,2,60,60,420,1\n\n"
        "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    inside = [w for w in words if w["start"] >= start - 0.05 and w["end"] <= end + 0.3]
    lines = []
    for i in range(0, len(inside), 3):
        group = inside[i:i + 3]
        g_start = group[0]["start"] - start
        g_end = group[-1]["end"] - start
        text = " ".join(w["w"] for w in group).upper()
        text = text.replace("{", "(").replace("}", ")").replace("\\", "")
        lines.append(f"Dialogue: 0,{ass_time(g_start)},{ass_time(g_end)},Default,,0,0,0,,{text}")
    path.write_text(header + "\n".join(lines) + "\n", encoding="utf-8")


def make_clip(video: Path, work: Path, idx: int, m, words, captions: bool):
    out = work / f"clip_{idx}.mp4"
    vf = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920"
    if captions:
        ass_name = f"clip_{idx}.ass"
        build_ass(words, m["start"], m["end"], work / ass_name)
        vf += f",ass={ass_name}"
    run([
        "ffmpeg", "-y", "-ss", f"{m['start']:.2f}", "-i", str(video),
        "-t", f"{m['end'] - m['start']:.2f}",
        "-vf", vf,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
        str(out),
    ], cwd=str(work))
    return out


def check_url(url: str):
    from urllib.parse import urlparse
    u = urlparse(url)
    host = (u.hostname or "").lower()
    if u.scheme not in ("http", "https") or not host:
        raise HTTPException(400, "Paste a full link starting with http:// or https://")
    if host in ("localhost", "0.0.0.0") or host.endswith(".local") or host.endswith(".internal"):
        raise HTTPException(400, "That link is not allowed.")
    import ipaddress
    try:
        ip = ipaddress.ip_address(host)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise HTTPException(400, "That link is not allowed.")
    except ValueError:
        pass  # a normal hostname


def download_video(url: str, work: Path) -> Path:
    """Download a video from a link (YouTube and most video sites) with yt-dlp."""
    cmd = [
        "yt-dlp", "--no-playlist", "--no-warnings",
        "--match-filter", f"duration<={MAX_VIDEO_MINUTES * 60}",
        "--max-filesize", f"{MAX_UPLOAD_MB * 4}M",
        "-f", "bv*[height<=1080]+ba/b[height<=1080]/b",
        "--merge-output-format", "mp4",
        "-o", str(work / "source.%(ext)s"),
        url,
    ]
    cookies = os.getenv("YTDLP_COOKIES_FILE")
    if cookies and Path(cookies).exists():
        cmd[1:1] = ["--cookies", cookies]
    try:
        run(cmd)
    except FileNotFoundError:
        raise RuntimeError("Link download is not set up on this server (yt-dlp missing).")
    except RuntimeError as e:
        msg = str(e)
        if "Sign in" in msg or "confirm you" in msg or "bot" in msg.lower():
            raise RuntimeError(
                "The site blocked the download from this server. Try uploading the "
                "video file instead, or ask the server owner to add a cookies file.")
        raise RuntimeError("Could not download that link. Check it is a public video.")
    files = sorted(work.glob("source.*"))
    if not files:
        raise RuntimeError(
            f"No video was downloaded. It may be longer than {MAX_VIDEO_MINUTES} minutes "
            "or too large.")
    return files[0]


def process(job_id: str, video: Path | None, url: str | None, count: int,
            length: str, captions: bool):
    work = DATA / job_id
    try:
        if url:
            set_status(job_id, stage="downloading", progress=5,
                       message="Downloading the video from your link...")
            video = download_video(url, work)
        set_status(job_id, stage="transcribing", progress=10,
                   message="Transcribing the audio (this is the slowest step)...")
        duration = probe_duration(video)
        segs, words = transcribe(video, work)
        if not segs:
            raise RuntimeError("No speech was found in this video.")

        set_status(job_id, stage="finding", progress=45,
                   message="AI is finding the best moments...")
        min_len, max_len = LENGTHS.get(length, LENGTHS["medium"])
        moments = pick_moments(segs, duration, count, min_len, max_len)
        if not moments:
            raise RuntimeError("The AI could not find usable moments. Try a longer video.")

        clips = []
        for i, m in enumerate(moments, start=1):
            set_status(job_id, stage="cutting",
                       progress=50 + int(45 * (i - 1) / len(moments)),
                       message=f"Creating clip {i} of {len(moments)}...")
            make_clip(video, work, i, m, words, captions)
            clips.append({
                "title": m["title"], "reason": m["reason"],
                "start": round(m["start"], 1), "end": round(m["end"], 1),
                "url": f"/files/{job_id}/clip_{i}.mp4",
            })
            set_status(job_id, clips=clips)

        set_status(job_id, stage="done", progress=100,
                   message=f"Done. {len(clips)} clips ready.", clips=clips)
    except Exception as e:  # noqa: BLE001
        set_status(job_id, stage="error", message=str(e))
    finally:
        for f in work.glob("source.*"):  # free disk space
            f.unlink(missing_ok=True)


# ---------- API ----------

def check_key(key: str | None):
    if ACCESS_KEY and key != ACCESS_KEY:
        raise HTTPException(401, "Wrong or missing access key.")


@app.post("/api/jobs")
async def create_job(
    file: UploadFile | None = File(None),
    url: str = Form(""),
    clips: int = Form(5),
    length: str = Form("medium"),
    captions: bool = Form(True),
    x_access_key: str | None = Header(default=None),
):
    check_key(x_access_key)
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise HTTPException(500, "Server is missing ANTHROPIC_API_KEY.")
    clips = max(1, min(clips, MAX_CLIPS))
    url = url.strip()
    if not url and (file is None or not file.filename):
        raise HTTPException(400, "Paste a video link or choose a file.")
    if url:
        check_url(url)

    job_id = uuid.uuid4().hex[:12]
    work = DATA / job_id
    work.mkdir(parents=True)
    video = None

    if not url:
        suffix = Path(file.filename or "video.mp4").suffix.lower() or ".mp4"
        if suffix not in {".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi", ".mp3", ".wav", ".m4a"}:
            raise HTTPException(400, "Unsupported file type.")
        video = work / f"source{suffix}"
        size = 0
        with video.open("wb") as f:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_MB * 1024 * 1024:
                    f.close()
                    video.unlink(missing_ok=True)
                    raise HTTPException(413, f"File is larger than {MAX_UPLOAD_MB} MB.")
                f.write(chunk)

    set_status(job_id, stage="queued", progress=3, message="Starting...", clips=[])
    threading.Thread(
        target=process, args=(job_id, video, url or None, clips, length, captions), daemon=True
    ).start()
    return {"job_id": job_id}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    path = job_dir(job_id) / "status.json"
    if not path.exists():
        raise HTTPException(404, "Job not found")
    return json.loads(path.read_text())


@app.get("/api/health")
def health():
    return {"ok": True}


# clips are served from /files/<job_id>/clip_N.mp4
app.mount("/files", StaticFiles(directory=str(DATA)), name="files")


@app.get("/")
def index():
    return FileResponse(BASE / "index.html")


@app.get("/app.js")
def appjs():
    return FileResponse(BASE / "app.js", media_type="application/javascript")
