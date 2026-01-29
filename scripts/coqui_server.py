"""
Local Coqui TTS server for the app's /tts-flashcards page.

Usage (recommended steps):
1) python3 -m venv .venv-coqui && source .venv-coqui/bin/activate
2) pip install -r coqui-requirements.txt
3) export COQUI_MODEL="tts_models/en/vctk/vits"   # or any model listed by `tts --list_models`
4) uvicorn scripts.coqui_server:app --host 127.0.0.1 --port 5005

Then set NEXT_PUBLIC_TTS_ENDPOINT=http://127.0.0.1:5005/speak in .env.local and restart Next.js dev server.
"""

import os
import subprocess
import tempfile
import uuid

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

MODEL = os.environ.get("COQUI_MODEL", "tts_models/en/vctk/vits")
# leave empty to skip speaker_idx for single-speaker models; set to e.g. "p225" for vctk
SPEAKER = os.environ.get("COQUI_SPEAKER", "").strip()

app = FastAPI(title="Coqui TTS Proxy", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "model": MODEL}


@app.post("/speak")
async def speak(payload: dict):
    text = payload.get("text", "")
    if not text:
        return JSONResponse({"error": "text is required"}, status_code=400)

    tmp_wav = os.path.join(tempfile.gettempdir(), f"{uuid.uuid4()}.wav")
    # Invoke Coqui CLI
    cmd = ["tts", "--text", text, "--model_name", MODEL, "--out_path", tmp_wav]
    if SPEAKER:
        cmd.extend(["--speaker_idx", SPEAKER])
    subprocess.run(cmd, check=True)
    return FileResponse(
        tmp_wav,
        media_type="audio/wav",
        filename="tts.wav",
    )
