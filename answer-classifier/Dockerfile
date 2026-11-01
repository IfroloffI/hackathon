FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY questions.json features.py generate_datasets.py train.py server.py ./
COPY data ./data
# Модели обучаются при сборке из датасетов в репозитории: образ всегда в sync с data/.
RUN python train.py
ENV PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
