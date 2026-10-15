# bcrypt e sqlite3 compilam binario nativo: a etapa de build precisa das toolchains,
# que ficam fora da imagem final.
FROM node:22-slim AS deps
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# O SQLite vive em /app/database. Monte um volume nesse caminho, senao os dados
# se perdem a cada recriacao do container.
RUN mkdir -p database && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "app.js"]
