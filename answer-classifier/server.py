"""answer-classifier: верен ли ответ игрока на вопрос-ворота NPC.

  GET  /health
  GET  /npcs                       → вопросы и реплики NPC (questions.json)
  POST /classify {npc_id, text}    → {npc_id, accepted, probability, known_words}

По npc_id запрос уходит в свою модель (логрег на bag of words, models/<npc_id>.joblib,
см. features.AnswerModel). known_words — признаки, которые модель узнала (после исправления
опечаток); пусто — ответа нет, accepted=false.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import joblib

import features  # noqa: F401 — модели в pickle ссылаются на features.AnswerModel
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

ROOT = Path(__file__).parent
QUESTIONS: dict[str, dict] = json.loads((ROOT / "questions.json").read_text(encoding="utf-8"))
MODELS = {npc: joblib.load(ROOT / "models" / f"{npc}.joblib") for npc in QUESTIONS}
METRICS = json.loads((ROOT / "models" / "metrics.json").read_text(encoding="utf-8"))
THRESHOLD = float(os.environ.get("ACCEPT_THRESHOLD", "0.5"))

app = FastAPI(title="answer-classifier")


class ClassifyRequest(BaseModel):
    npc_id: str
    text: str = Field(max_length=300)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "models": list(MODELS), "threshold": THRESHOLD}


@app.get("/npcs")
def npcs() -> dict:
    return {npc: {**q, "metrics": METRICS.get(npc)} for npc, q in QUESTIONS.items()}


@app.post("/classify")
def classify(req: ClassifyRequest) -> dict:
    model = MODELS.get(req.npc_id)
    if model is None:
        raise HTTPException(404, f"нет модели для npc_id={req.npc_id!r}; есть: {', '.join(MODELS)}")
    p = float(model.predict_proba([req.text])[0])
    return {"npc_id": req.npc_id, "accepted": p >= THRESHOLD, "probability": round(p, 3),
            "known_words": model.features(req.text)}
