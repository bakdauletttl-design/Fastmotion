FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY cloud/requirements.txt cloud/requirements.txt
RUN pip install --no-cache-dir -r cloud/requirements.txt
# общий код нарезки из настольной версии + облачный сервис
COPY hypecut hypecut
COPY cloud/hypecut_cloud cloud/hypecut_cloud
ENV PYTHONPATH=/app:/app/cloud HYPECUT_DATA=/data PORT=8080
VOLUME /data
EXPOSE 8080
CMD ["python", "-m", "hypecut_cloud"]
