# Imagem de produção do servidor (Scaleway). Construída a partir da raiz do repositório.
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter @basecom/server... && pnpm --filter @basecom/shared build && pnpm --filter @basecom/server build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/server
EXPOSE 3000
CMD ["node", "dist/index.js"]
