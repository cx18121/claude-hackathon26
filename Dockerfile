FROM node:20-slim AS overlay-builder
WORKDIR /overlay
COPY overlay/ ./
RUN npm ci && npm run build

FROM node:20-slim AS mobile-builder
WORKDIR /mobile
COPY mobile/ ./
RUN npm ci && npm run build

FROM python:3.11-slim
WORKDIR /app
COPY server/ ./server/
COPY --from=overlay-builder /overlay/dist/ ./overlay/dist/
COPY --from=mobile-builder /mobile/dist/ ./mobile/dist/
WORKDIR /app/server
RUN pip install --no-cache-dir -r requirements.txt

ENV TUNNEL=false

CMD ["python", "main.py"]
