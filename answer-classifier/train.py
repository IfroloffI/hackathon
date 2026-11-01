"""Обучает 5 бинарных классификаторов «ответ верный?» — логрег на bag of words.

    python train.py            # data/<npc>.csv → models/<npc>.joblib + models/metrics.json

Оценка — ровно тот путь, что в сервисе (исправление опечаток, «нет знакомых слов → нет»):
  * cv      — 5-fold стратифицированная кросс-валидация по строкам: знакомые сущности
              в новых формулировках и с новыми опечатками;
  * unseen  — GroupKFold по сущностям: модель ни разу не видела это имя/открытие. Для bag
              of words новое имя — пустое слово, так что тут ожидаемо отказ; полнота словаря
              датасета важнее модели.
"""

from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, f1_score
from sklearn.model_selection import GroupKFold, StratifiedKFold

from features import AnswerModel

ROOT = Path(__file__).parent
NPCS = list(json.loads((ROOT / "questions.json").read_text(encoding="utf-8")))


def oof_predict(X: np.ndarray, y: np.ndarray, splits) -> np.ndarray:
    pred = np.zeros_like(y)
    for train, test in splits:
        pred[test] = AnswerModel().fit(X[train], y[train]).predict(X[test])
    return pred


def scores(y: np.ndarray, pred: np.ndarray) -> dict:
    return {"accuracy": round(accuracy_score(y, pred), 3), "f1": round(f1_score(y, pred), 3),
            "false_accept": int(((pred == 1) & (y == 0)).sum()), "false_reject": int(((pred == 0) & (y == 1)).sum())}


def main() -> None:
    out = ROOT / "models"
    out.mkdir(exist_ok=True)
    metrics = {}
    for npc in NPCS:
        df = pd.read_csv(ROOT / "data" / f"{npc}.csv", keep_default_na=False)
        X, y = df["text"].to_numpy(), df["label"].to_numpy()
        cv = oof_predict(X, y, StratifiedKFold(5, shuffle=True, random_state=0).split(X, y))
        # Мусор — одна «сущность» на всех: его в unseen делим по тексту, а не целиком.
        groups = np.where(df["entity"] == "junk", df["text"], df["entity"])
        unseen = oof_predict(X, y, GroupKFold(5).split(X, y, groups))
        model = AnswerModel().fit(X, y)
        joblib.dump(model, out / f"{npc}.joblib")
        metrics[npc] = {"rows": len(df), "positive_share": round(float(y.mean()), 2),
                        "vocab": len(model.bow.vocabulary_), "cv": scores(y, cv), "unseen_entities": scores(y, unseen)}
        m = metrics[npc]
        print(f"{npc:13s} n={m['rows']} vocab={m['vocab']:4d}  cv acc={m['cv']['accuracy']:.3f} f1={m['cv']['f1']:.3f}"
              f" FA={m['cv']['false_accept']:2d} FR={m['cv']['false_reject']:2d}"
              f"  | unseen acc={m['unseen_entities']['accuracy']:.3f} FA={m['unseen_entities']['false_accept']:2d}"
              f" FR={m['unseen_entities']['false_reject']:2d}")
    (out / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
