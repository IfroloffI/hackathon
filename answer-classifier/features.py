"""Bag of words для русских ответов и модель-обёртка над логрегом.

Токены: нижний регистр, ё→е, слова, стемминг Snowball («Архимеда» = «Архимед»), без слов-связок
(«ну», «наверное», «я думаю») — признаками остаётся только суть ответа. Признаки: униграммы
и биграммы, бинарные.

Перед векторизацией незнакомое модели слово исправляется на ближайшее из словаря (Левенштейн
≤ 1, для длинных слов ≤ 2): опечатки в чате — норма. Если знакомых слов не осталось — ответа
нет (вероятность 0), а не решение по одному свободному члену.
"""

from __future__ import annotations

import re

import numpy as np
import snowballstemmer
from scipy.sparse import csr_matrix
from sklearn.feature_extraction.text import CountVectorizer
from sklearn.linear_model import LogisticRegression

_stem = snowballstemmer.stemmer("russian").stemWord
_word = re.compile(r"[a-zа-я0-9]+")

# Слова-связки ответа (шаблоны «Например, …», «я думаю это …»): смысла «верно/неверно» не несут.
STOPWORDS = {_stem(w) for w in """
    ну может наверное я думаю это же конечно ответ мой давай скажу так уверен пусть будет хм
    знаю вот легко правильно кажется например и а или то ли да ок ты твой твоя твое ваш
    он она оно они мне мы вы ещё еще очень просто вроде типа который которая которое которые
    как в на с из у к по за о об от для до что
""".split()}


def tokenize(text: str) -> list[str]:
    text = text.lower().replace("ё", "е")
    return [t for t in (_stem(w) for w in _word.findall(text)) if t not in STOPWORDS]


def ngrams(tokens: list[str]) -> list[str]:
    return tokens + [f"{a} {b}" for a, b in zip(tokens, tokens[1:])]


def analyze(text: str) -> list[str]:
    return ngrams(tokenize(text))


def levenshtein(a: str, b: str, limit: int) -> int:
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cost = 0 if ca == cb else 1
            # перестановка соседних букв — одна правка (Дамерау): «процесор», «планште»
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost))
            if i > 1 and j > 1 and ca == b[j - 2] and a[i - 2] == cb:
                cur[j] = min(cur[j], prev2[j - 2] + 1)
        prev2, prev = prev, cur
    return prev[-1]


class AnswerModel:
    """Логрег на bag of words + исправление опечаток по словарю модели."""

    def __init__(self, C: float = 4.0) -> None:
        self.bow = CountVectorizer(analyzer=analyze, binary=True)
        # balanced: 70/30 в данных не должно превращаться в «по умолчанию пропускать».
        self.clf = LogisticRegression(C=C, class_weight="balanced", max_iter=2000)
        self.words: list[str] = []

    def fit(self, texts, labels) -> "AnswerModel":
        X = self.bow.fit_transform(texts)
        self.clf.fit(X, labels)
        self.words = [w for w in self.bow.vocabulary_ if " " not in w]
        return self

    def correct(self, token: str) -> str:
        vocab = self.bow.vocabulary_
        if token in vocab or len(token) < 4:
            return token
        limit = 1 if len(token) < 8 else 2
        best, best_d = token, limit + 1
        for w in self.words:
            d = levenshtein(token, w, limit)
            if d < best_d:
                best, best_d = w, d
        return best

    def features(self, text: str) -> list[str]:
        """Известные модели признаки ответа (после исправления опечаток)."""
        vocab = self.bow.vocabulary_
        return [g for g in dict.fromkeys(ngrams([self.correct(t) for t in tokenize(text)])) if g in vocab]

    def predict_proba(self, texts) -> np.ndarray:
        rows, cols = [], []
        for i, text in enumerate(texts):
            for g in self.features(text):
                rows.append(i)
                cols.append(self.bow.vocabulary_[g])
        X = csr_matrix((np.ones(len(rows)), (rows, cols)), shape=(len(texts), len(self.bow.vocabulary_)))
        p = self.clf.predict_proba(X)[:, 1]
        p[np.asarray(X.getnnz(axis=1)) == 0] = 0.0  # ни одного знакомого слова — не ответ
        return p

    def predict(self, texts, threshold: float = 0.5) -> np.ndarray:
        return (self.predict_proba(texts) >= threshold).astype(int)
