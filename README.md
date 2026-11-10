# BASECOM CRM

CRM interno da BASECOM, parceiro NOS Empresas.

| Pasta | O que é |
| --- | --- |
| `apps/server` | Servidor (Node.js/TypeScript, PostgreSQL) |
| `apps/desktop` | Aplicação de computador (Electron + React), Windows e Mac |
| `apps/android` | App BASECOM para os telemóveis Android (fase 4) |
| `packages/shared` | Regras de negócio partilhadas (ciclos, pontos, comissões) |

As regras do projeto e as ligações para a especificação estão em [CLAUDE.md](CLAUDE.md).

## Desenvolvimento local

```bash
pnpm install
pnpm db:up                      # PostgreSQL local em Docker
cp apps/server/.env.example apps/server/.env
pnpm --filter @basecom/server db:migrate
pnpm dev:server                 # servidor em http://localhost:3000/health
pnpm dev:desktop                # aplicação de computador
pnpm test                       # testes automáticos
```
