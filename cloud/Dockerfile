FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY cloud/requirements.txt cloud/requirements.txt
RUN pip install --no-cache-dir -r cloud/requirements.txt
# модель распознавания речи скачиваем при сборке, чтобы первый клип не ждал
ARG WHISPER_MODEL=small
ENV WHISPER_MODEL=${WHISPER_MODEL}
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL}', device='cpu', compute_type='int8')"
# общий код нарезки из настольной версии + облачный сервис
COPY hypecut hypecut
COPY cloud/hypecut_cloud cloud/hypecut_cloud
ENV PYTHONPATH=/app:/app/cloud HYPECUT_DATA=/data PORT=8080
VOLUME /data
EXPOSE 8080
CMD ["python", "-m", "hypecut_cloud"]
