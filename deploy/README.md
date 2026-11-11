# Instalação em produção (Scaleway)

- Servidor DEV1-M (Ubuntu 24.04) em Amesterdão (nl-ams-1; em Paris a Scaleway não disponibiliza DEV1 a contas novas), com rede privada até à base de dados gerida (DB-DEV-S, PostgreSQL 16).
- O servidor arranca com `cloud-init`: instala Docker, copia o repositório com uma chave só de leitura (deploy key) e arranca `docker-compose.prod.yml`.
- **Atualizar a produção:** enviar o código aprovado para o ramo `production`. O servidor verifica de 5 em 5 minutos e instala sozinho (só fora do horário de trabalho, por regra).
- Variáveis secretas em `/opt/basecom/.env` no servidor (DATABASE_URL, ENCRYPTION_KEY). Cópia guardada no Secret Manager da Scaleway.
- HTTPS automático pelo Caddy para crm.basecom.pt (o registo DNS A aponta para o IP do servidor).
