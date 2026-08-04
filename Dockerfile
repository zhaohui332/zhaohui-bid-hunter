FROM node:24-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-noto-cjk \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY . .

RUN npx playwright install chromium 2>/dev/null || true

ENV NODE_ENV=production
EXPOSE 8710

CMD ["node", "server/index.js"]
