# Imagem de produção do servidor. Construída a partir da raiz do repositório:
#   docker build -f apps/server/Dockerfile .
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server
# O certificado extra só é usado em testes locais atrás de um proxy; em produção não existe.
RUN --mount=type=secret,id=ca,required=false \
    export NODE_EXTRA_CA_CERTS=/run/secrets/ca; \
    pnpm install --frozen-lockfile --filter @basecom/server... \
 && pnpm --filter @basecom/shared build \
 && pnpm --filter @basecom/server build \
 && pnpm --filter @basecom/server deploy --prod --legacy /out

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out ./
COPY --from=build /app/apps/server/drizzle ./drizzle
EXPOSE 3000
USER node
# Aplica as migrações da base de dados e arranca o servidor.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
