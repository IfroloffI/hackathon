"""Whisper-сервис расшифровки речи (faster-whisper, CPU).

Совместим с OpenAI: POST /v1/audio/transcriptions (multipart: file, language?, prompt?)
→ {"text", "language", "duration", "segments"}. GET /health — 200, когда модель загружена.

Модель качается с HuggingFace при первом старте в /models (docker volume) и дальше
работает без интернета.
"""

from __future__ import annotations

import io
import logging
import os
import threading
import time
import wave
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from faster_whisper import WhisperModel

MODEL_NAME = os.environ.get("WHISPER_MODEL", "small")
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
CPU_THREADS = int(os.environ.get("WHISPER_CPU_THREADS", "4"))
BEAM_SIZE = int(os.environ.get("WHISPER_BEAM_SIZE", "5"))
DEFAULT_LANGUAGE = os.environ.get("WHISPER_LANGUAGE", "ru") or None
MODELS_DIR = os.environ.get("WHISPER_MODELS_DIR", "/models")
# Сегменты, где модель сама уверена, что речи нет, — выбрасываем (галлюцинации на шуме).
NO_SPEECH_THRESHOLD = float(os.environ.get("WHISPER_NO_SPEECH_THRESHOLD", "0.6"))
SAMPLE_RATE = 16000  # Whisper работает на 16 кГц

# Классические галлюцинации Whisper на тишине/шуме в русском (обучение на субтитрах).
HALLUCINATIONS = (
    "продолжение следует",
    "субтитры сделал",
    "субтитры создавал",
    "субтитры подготовил",
    "редактор субтитров",
    "корректор",
    "спасибо за просмотр",
    "подписывайтесь на канал",
    "dimatorzok",
)

log = logging.getLogger("whisper")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

model: WhisperModel | None = None
# Одна расшифровка за раз: параллельные вызовы на CPU только мешают друг другу.
lock = threading.Lock()


def load_audio(data: bytes) -> np.ndarray | io.BytesIO:
    """PCM16-WAV (так шлёт агент) → float32 16 кГц без ffmpeg; прочие форматы декодирует PyAV."""
    try:
        with wave.open(io.BytesIO(data)) as w:
            if w.getsampwidth() != 2:
                raise wave.Error("не PCM16")
            pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
            channels, rate = w.getnchannels(), w.getframerate()
    except (wave.Error, EOFError):
        return io.BytesIO(data)
    audio = pcm.reshape(-1, channels).mean(axis=1).astype(np.float32) / 32768.0
    if rate != SAMPLE_RATE:
        n = int(len(audio) * SAMPLE_RATE / rate)
        audio = np.interp(np.linspace(0, len(audio) - 1, n), np.arange(len(audio)), audio).astype(np.float32)
    return audio


def is_hallucination(text: str) -> bool:
    low = text.lower()
    return any(h in low for h in HALLUCINATIONS)


@asynccontextmanager
async def lifespan(_: FastAPI):
    global model
    t0 = time.monotonic()
    log.info("загружаю модель %s (%s, %d потоков)…", MODEL_NAME, COMPUTE_TYPE, CPU_THREADS)
    model = WhisperModel(
        MODEL_NAME,
        device="cpu",
        compute_type=COMPUTE_TYPE,
        cpu_threads=CPU_THREADS,
        download_root=MODELS_DIR,
    )
    log.info("модель готова за %.1f с", time.monotonic() - t0)
    yield


app = FastAPI(title="chronolet-whisper", lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    if model is None:
        raise HTTPException(503, "модель загружается")
    return {"ok": True, "model": MODEL_NAME, "compute_type": COMPUTE_TYPE}


@app.post("/v1/audio/transcriptions")
def transcribe(
    file: UploadFile = File(...),
    language: str | None = Form(None),
    prompt: str | None = Form(None),
) -> dict:
    if model is None:
        raise HTTPException(503, "модель загружается")
    audio = load_audio(file.file.read())
    t0 = time.monotonic()
    with lock:
        segments, info = model.transcribe(
            audio,
            language=language or DEFAULT_LANGUAGE,
            beam_size=BEAM_SIZE,
            initial_prompt=prompt or None,
            # Куски уже нарезаны VAD агента; контекст между ними не тянем — меньше зацикливаний.
            vad_filter=False,
            condition_on_previous_text=False,
        )
        kept = []
        for s in segments:
            text = s.text.strip()
            if not text or s.no_speech_prob > NO_SPEECH_THRESHOLD or is_hallucination(text):
                continue
            kept.append({"start": round(s.start, 2), "end": round(s.end, 2), "text": text})
    text = " ".join(s["text"] for s in kept).strip()
    log.info("%.1f с аудио → %.2f с: %r", info.duration, time.monotonic() - t0, text[:120])
    return {"text": text, "language": info.language, "duration": info.duration, "segments": kept}
