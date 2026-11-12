"""
Servicio local de voz para "Nova en vivo".

  POST /stt   audio PCM 16 bit mono (cuerpo crudo)  ->  texto        (faster-whisper)
  POST /tts   {"text": "..."}                       ->  audio WAV    (Piper)
  GET  /health

Corre en la propia máquina y el navegador lo llama directo: así ni el audio ni el
texto salen del equipo, y PHP (que en desarrollo atiende de a una petición) no se
queda esperando a Whisper. Ver documentacion/12-nova-en-vivo.md.
"""

from __future__ import annotations

import io
import logging
import os
import re
import threading
import time
import wave
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

log = logging.getLogger("voice")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

BASE = Path(__file__).parent
VOICES_DIR = Path(os.getenv("PIPER_VOICES_DIR", BASE / "voices"))
DEFAULT_VOICE = os.getenv("PIPER_VOICE", "es_MX-claude-high")
# "base" tarda ~0,8 s por frase en CPU; "small" es más preciso pero ~2,5 s (medido en esta
# laptop). En una charla la latencia pesa más: sube a "small" si hay GPU libre o CPU de sobra.
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")  # "cuda" si sobra memoria de video
WHISPER_COMPUTE = os.getenv("WHISPER_COMPUTE", "int8")
WHISPER_THREADS = int(os.getenv("WHISPER_THREADS", "8"))
MAX_AUDIO_SECONDS = 30

# Orienta a Whisper hacia el vocabulario de la aplicación (nombres propios y términos UML).
STT_PROMPT = os.getenv(
    "STT_PROMPT",
    "Nova, diagrama de clases UML: clase, atributo, método, relación, herencia, "
    "composición, agregación, asociación, multiplicidad, uno a muchos, muchos a muchos, "
    "normalización, llave primaria, llave foránea.",
)

# Frases que Whisper inventa cuando solo hay ruido o silencio.
PHANTOMS = re.compile(
    r"(subt[ií]tulos|amara\.org|gracias por ver|suscr[ií]b|no olvides|hasta la pr[oó]xima|"
    r"dale like|www\.|\.com\b|¡?gracias\.?$)",
    re.IGNORECASE,
)

_whisper = None
_whisper_lock = threading.Lock()
_voices: dict[str, object] = {}
_piper_lock = threading.Lock()


def get_whisper():
    global _whisper
    if _whisper is None:
        from faster_whisper import WhisperModel

        log.info("Cargando Whisper '%s' (%s, %s)…", WHISPER_MODEL, WHISPER_DEVICE, WHISPER_COMPUTE)
        _whisper = WhisperModel(
            WHISPER_MODEL,
            device=WHISPER_DEVICE,
            compute_type=WHISPER_COMPUTE,
            cpu_threads=WHISPER_THREADS,
        )
    return _whisper


def available_voices() -> list[str]:
    return sorted(p.name[: -len(".onnx")] for p in VOICES_DIR.glob("*.onnx"))


def get_voice(name: str):
    if name not in _voices:
        path = VOICES_DIR / f"{name}.onnx"
        if not path.exists():
            raise HTTPException(404, f"No existe la voz '{name}'. Disponibles: {available_voices()}")

        from piper import PiperVoice

        log.info("Cargando voz '%s'…", name)
        _voices[name] = PiperVoice.load(str(path))
    return _voices[name]


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Se cargan al arrancar para que la primera frase no espere varios segundos.
    try:
        get_whisper()
        get_voice(DEFAULT_VOICE)
        log.info("Listo. Voces: %s", available_voices())
    except Exception:  # noqa: BLE001 - se informa en /health y no se tumba el servicio
        log.exception("No se pudo precargar un modelo")
    yield


app = FastAPI(title="Nova - servicio de voz", lifespan=lifespan)

# El navegador llama desde la página de la app (localhost o la IP de la red local).
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=os.getenv(
        "ALLOWED_ORIGIN_REGEX",
        r"^https?://(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$",
    ),
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-Audio-Ms", "X-Sample-Rate"],
)


@app.get("/health")
def health():
    return {
        "ok": True,
        "stt": {"model": WHISPER_MODEL, "device": WHISPER_DEVICE, "loaded": _whisper is not None},
        "tts": {"default": DEFAULT_VOICE, "voices": available_voices(), "loaded": list(_voices)},
    }


# ------------------------------------------------------------------ STT


@app.post("/stt")
async def stt(request: Request, sr: int = Query(16000, ge=8000, le=48000), lang: str = Query("es")):
    raw = await request.body()
    if len(raw) < 2 * 1600:  # menos de 0,1 s
        return {"text": "", "ms": 0, "skipped": "muy corto"}

    pcm = np.frombuffer(raw[: len(raw) - (len(raw) % 2)], dtype="<i2").astype(np.float32) / 32768.0

    if sr != 16000:  # Whisper trabaja a 16 kHz; el navegador ya lo manda así, esto es por si acaso.
        target = int(len(pcm) * 16000 / sr)
        pcm = np.interp(np.linspace(0, len(pcm) - 1, target), np.arange(len(pcm)), pcm).astype(np.float32)

    if len(pcm) > 16000 * MAX_AUDIO_SECONDS:
        pcm = pcm[-16000 * MAX_AUDIO_SECONDS :]

    # Casi silencio: Whisper inventaría texto.
    if float(np.sqrt(np.mean(pcm**2))) < 0.003:
        return {"text": "", "ms": 0, "skipped": "silencio"}

    started = time.perf_counter()
    with _whisper_lock:
        segments, info = get_whisper().transcribe(
            pcm,
            language=lang,
            beam_size=1,
            temperature=0.0,
            condition_on_previous_text=False,
            initial_prompt=STT_PROMPT,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500, "speech_pad_ms": 200},
            no_speech_threshold=0.6,
        )
        parts = [s.text.strip() for s in segments if s.no_speech_prob < 0.6]

    text = " ".join(p for p in parts if p).strip()
    if PHANTOMS.search(text) and len(text) < 60:
        text = ""

    ms = int((time.perf_counter() - started) * 1000)
    log.info("STT %.1fs de audio -> %d ms: %r", len(pcm) / 16000, ms, text[:80])
    return {"text": text, "ms": ms, "language": info.language}


# ------------------------------------------------------------------ TTS


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1500)
    voice: str | None = None
    speed: float = Field(1.0, ge=0.6, le=1.6)  # 1.2 = 20 % más rápido


@lru_cache(maxsize=96)
def _synthesize(text: str, voice_name: str, length_scale: float) -> tuple[bytes, int]:
    from piper import SynthesisConfig

    voice = get_voice(voice_name)
    config = SynthesisConfig(length_scale=length_scale)
    chunks: list[bytes] = []
    rate = 22050

    with _piper_lock:
        for chunk in voice.synthesize(text, syn_config=config):
            rate = chunk.sample_rate
            chunks.append(chunk.audio_int16_bytes)

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(b"".join(chunks))
    return buffer.getvalue(), rate


def clean_for_speech(text: str) -> str:
    """Sin markdown ni símbolos que el motor leería en voz alta."""
    text = re.sub(r"```[\s\S]*?```", " ", text)
    text = re.sub(r"[*_`#>|~]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


@app.post("/tts")
def tts(body: TtsRequest):
    text = clean_for_speech(body.text)
    if not text:
        raise HTTPException(422, "Sin texto que decir")

    started = time.perf_counter()
    voice = body.voice or DEFAULT_VOICE
    audio, rate = _synthesize(text, voice, round(1.0 / body.speed, 2))
    ms = int((time.perf_counter() - started) * 1000)
    log.info("TTS %d caracteres -> %d ms", len(text), ms)

    return Response(
        audio,
        media_type="audio/wav",
        headers={"X-Audio-Ms": str(ms), "X-Sample-Rate": str(rate), "Cache-Control": "no-store"},
    )


@app.exception_handler(Exception)
async def unexpected(_: Request, exc: Exception):
    log.exception("Error no controlado")
    return JSONResponse({"detail": str(exc)}, status_code=500)
