FROM node:22-bookworm-slim AS build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=""
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
ENV NEXT_PUBLIC_API_URL=/api
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium tini ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3000 PUPPETEER_SKIP_DOWNLOAD=true PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY backend/ ./
WORKDIR /app
COPY --from=build /app/frontend ./frontend
COPY package.json ./
COPY scripts/ ./scripts/
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "scripts/start.mjs"]
