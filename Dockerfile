FROM python:3.11-slim
WORKDIR /app

COPY server/ ./server/
COPY overlay/dist/ ./overlay/dist/
COPY mobile/dist/ ./mobile/dist/

WORKDIR /app/server
RUN pip install --no-cache-dir -r requirements.txt

ENV TUNNEL=false

CMD ["python", "main.py"]
