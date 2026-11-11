# BASECOM CRM — regras do projeto

CRM interno da BASECOM (parceiro NOS Empresas). Empresa fiscal: INCOGNIT TRUTH UNIPESSOAL LDA (BASECOM é o nome comercial); as contas Scaleway e OVHcloud faturam em nome dela. Dono do produto: Leonardo Rocha (Administrador).
Desenvolvimento feito pelo Leonardo e pelo Claude, em sessões de trabalho.

## Como trabalhar neste repositório

- Fala com o Leonardo em **português de Portugal**, simples, sem jargão.
- **Não inventar regras de negócio nem valores.** Se faltar informação, perguntar.
- **Não mudar decisões aprovadas** sem justificar e sem confirmação.
- Tudo o que for regra ou lista deve ser **configurável pelo Administrador** no ecrã de Configurações (não fixo no código), salvo indicação em contrário.
- Código e identificadores em inglês; textos do ecrã em português de Portugal (datas 10/11/2026, valores 1.234,56 €).
- Cada alteração de regra de cálculo leva testes automáticos com os exemplos aprovados.
- Commits pequenos e frequentes; o ambiente de desenvolvimento é apagado no fim da sessão.

## Documentos de especificação (fonte da verdade)

| Documento | Ligação |
| --- | --- |
| Fecho da Fase 01 (arquitetura) — confidencial | https://claude.ai/artifact/1N7DQjx7TFYuacRvD5ZA4h |
| Revisão final Fase 01 | https://claude.ai/artifact/RTwy6hQVPQdWvQBbpf94Zi |
| Regras de faturação e comissões — uso interno | https://claude.ai/artifact/Y1wa7MPwctfksZSr8wVjsk |
| Catálogos operacionais | https://claude.ai/artifact/FU4Xt7DmviRfR1Vj6gKekQ |
| Matriz de permissões | https://claude.ai/artifact/QUuyDfbYyAerDKQcV5Z5iZ |
| Fluxos | https://claude.ai/artifact/RuHe3yaKF2pxmN2kkr9hfz |
| Importação e reconciliação | https://claude.ai/artifact/FWbWQiUD9gd6Mqrpqa4iZM |
| Painéis e relatórios | https://claude.ai/artifact/Ty1hhr549i4uWmS2sBodiD |
| Telefonia | https://claude.ai/artifact/W86TGJyVSS2yfkQanBHnmC |
| Infraestrutura na nuvem | https://claude.ai/artifact/B1qerZhudSfrdrXQfdU2PA |
| Requisitos de qualidade | https://claude.ai/artifact/8rhy7pH2FBVrD7XSbcDHdk |
| Plano de desenvolvimento | https://claude.ai/artifact/QmPqfgCq7nHHLSwcF3Sjr4 |
| Maquetas (canvas) | https://claude.ai/artifact/DfABgUMPdPaZDmtnkXYEqy |
| Design System BASECOM | https://claude.ai/artifact/RmcbGNzBXqYt8L29F3Viki |

Em caso de dúvida, os documentos mandam sobre este resumo.

## Arquitetura

- `apps/server` — servidor Node.js/TypeScript (monólito modular), PostgreSQL, em Docker. Produção: Scaleway em Amesterdão (servidor DEV1-M + PostgreSQL gerido DB-DEV-S, rede privada); cópias externas de hora a hora na OVHcloud (Object Storage, Gravelines). Ver `deploy/README.md`.
- `apps/desktop` — aplicação de computador Electron + React (Windows 10/11 e MacBook Pro 2019 Intel).
- `apps/android` — app BASECOM para Android (fase 4): recebe o número do CRM, liga, devolve início/fim/chamadas recebidas. Telemóveis: 2× TCL 505 5G, 1× OPPO CPH2695.
- `packages/shared` — tipos e regras de negócio puras (pontos, ciclos, comissões), testadas.
- Acesso por HTTPS em crm.basecom.pt, sem restrição por IP, 2FA obrigatório. Dados na UE.
- Recuperação: perda máxima 1 h (RPO); 1–2 h numa falha normal, até 1 dia útil se o fornecedor falhar (RTO).

## Regras de negócio essenciais (resumo)

- **Ciclos:** 28 dias; C1/2026 começa a 5 jan 2026. Uma venda conta no ciclo da **data de ativação**.
- **Tipos de venda:** NN, XSell, FID, Upsell. Carteira **NC** por omissão; **FC** só por alteração manual. FC conta 50 % em tudo.
- **Valor concluído** = Receita Ponderada do RUN da NOS (XSell/Upsell: só o aumento de mensalidade; FID incompleta: mensalidade ÷ 15 × meses ganhos; completa se ≤ 9 meses por cumprir para 24, ou ≤ 21 para 36).
- **Pontos por €:** NN 6 · XSell 3 · FID 1 · Upsell 0,5.
- **Escalões:** 2.750 → 150 € · 3.250 → 400 € · 3.750 → 700 € · 4.500 → 1.150 € · 5.500 → 1.700 € · +0,30 €/ponto acima de 5.500.
- **RAA** (NN + XSell) mínima 250 €; abaixo, comissão a 50 %. **Campeão de NIFs:** +10 % (mín. 15 NIFs; empate pela RAA).
- **Chargeback:** CB Total (linha desativada) ou CB Parcial (mensalidade baixou). Recalcula o ciclo original; diferença descontada no pagamento seguinte. Ao comercial é sempre 100 % durante 12 meses (a NOS cobra 50 % à empresa após 6 meses — só gerência vê). Pagamento N+60.
- **Receita NOS** (multiplicadores, incentivos, % CB) — **só gerência**. Retenção de 250 € conta como 0.
- **Carteiras:** conquista na primeira venda; se nenhuma linha ativar, a empresa volta a ficar sem carteira. Todas as NN entram sem carteira. Só o Administrador transfere, com justificação, na mudança de ciclo.
- **Power Dialer:** 15 s para registar o resultado (excesso avisa o Chefe de Equipa); 10 s até marcar a seguinte; pausa para mudar de campanha 2 min/dia; formação 5 min/dia; intervalo 24 min/dia (excesso avisa o Administrador). Horas de login = registo de ponto.
- **Visibilidade de tempos:** comercial vê os seus; Chefe de Equipa a equipa; Administrador toda a estrutura.

## Comerciais e horário

- Comerciais atuais: Angela Dias, Catarina Machado. Ex-comerciais (sem comissão): Rute Pereira, Ana Margarida Almeida.
- Horário: segunda a sexta 08h45–19h35; sábado 08h45–13h00. Manutenção fora deste horário.

## Plano (arranque A até 6 dez 2026)

1. Fundações — servidor, login 2FA, utilizadores e perfis, configurações, auditoria, aplicação de computador.
2. Empresas — importação (ensaio 500, depois 21.225), ficha com RGU, pesquisa, carteiras.
3. Trabalho comercial — campanhas, scripts, Power Dialer, Clientes atuais, Carteira, resultados, Agenda, ponto.
4. App Android (em paralelo com a 3).

Arranque B (C13/2026 e C1/2027): vendas e NOS (RUN/CB, export 1870), comissões, painéis, relatórios, piloto.
