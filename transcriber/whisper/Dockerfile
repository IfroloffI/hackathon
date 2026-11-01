FROM python:3.12-slim
WORKDIR /app
# PyAV (декодирование аудио) и CTranslate2 приходят готовыми колёсами — ffmpeg из apt не нужен.
RUN pip install --no-cache-dir \
      faster-whisper==1.2.1 \
      # av ≥ 16 убрал open(metadata_errors=…), который зовёт faster-whisper 1.2.1.
      av==15.1.0 \
      fastapi==0.162.0 \
      uvicorn==0.54.0 \
      python-multipart==0.0.32
COPY server.py .
ENV PYTHONUNBUFFERED=1 HF_HOME=/models/hf
EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
