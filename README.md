# ClipAI

Paste a video link (or upload a file), get short vertical clips with captions.

Files (keep them all in one folder):
- `main.py` backend and website server
- `index.html`, `app.js` the website
- `requirements.txt`, `Dockerfile` for deploying

## What you need
1. An Anthropic API key (console.anthropic.com). The AI picks the best moments.
2. A server with FFmpeg and some CPU. A free hosting tier is too weak for long videos. A small VPS or a Docker host (Render, Railway, Fly.io) with 2+ GB RAM works.

## Deploy with Docker (easiest)
1. Put all 6 files in a GitHub repo.
2. Create a new web service on Render or Railway from that repo, using the Dockerfile.
3. Set environment variables:
   - `ANTHROPIC_API_KEY` = your key (required)
   - `ACCESS_KEY` = any password you choose (recommended, so strangers can't spend your credits)
   - `WHISPER_MODEL` = `base` (use `small` for better accuracy, slower)
   - `MAX_UPLOAD_MB` = `500`
   - `MAX_CLIPS` = `20` (most clips one job can make)
   - `MAX_VIDEO_MINUTES` = `180` (longest video accepted from a link)
4. Open the service URL. The website and the server are the same address.
5. Tap Settings on the website, type your ACCESS_KEY, and save.

## Run on a computer
```
pip install -r requirements.txt
export ANTHROPIC_API_KEY=your-key
uvicorn main:app --host 0.0.0.0 --port 8000
```
Needs FFmpeg installed. Open http://localhost:8000

## Pasting links
Links are downloaded with yt-dlp (YouTube and most video sites). Public videos only.
YouTube often blocks downloads from cloud servers ("confirm you're not a bot"). If that happens, upload the file instead, or set `YTDLP_COOKIES_FILE` to a cookies.txt path on the server.
Keep yt-dlp updated (`pip install -U yt-dlp`) because sites change often.

## Notes
- Transcription is the slow step: roughly real-time on a small CPU server, so a 1 hour video can take about an hour on `base`.
- Clips are stored on the server disk in the `jobs` folder. Delete old ones now and then.
- Jobs run in the server's memory-light background threads. If the server restarts mid-job, that job is lost.
- Only upload videos you own or have permission to use.
