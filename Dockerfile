# ============================================
# DOCKERFILE – Google SERP Scraper
# ============================================
# Multi-stage build pro menší výsledný obraz.

# --- Stage 1: základ ---
FROM node:20-alpine AS base

WORKDIR /app

LABEL maintainer="rcetkovsky"
LABEL description="Google SERP Scraper – lokální vývojové prostředí"
LABEL version="1.0.0"

# --- Stage 2: vývojový obraz ---
FROM base AS development

# Kopíruje package.json zvlášť kvůli Docker build cache
COPY package*.json ./

# Plná instalace závislostí (včetně devDependencies)
RUN npm install && npm cache clean --force

# Zkopírujeme zbytek kódu
COPY . .

# Aplikace běží na portu 3000
EXPOSE 3000

ENV NODE_ENV=development
ENV PORT=3000

# Healthcheck – Docker ověřuje, jestli aplikace odpovídá
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Spuštění
CMD ["npm", "start"]
