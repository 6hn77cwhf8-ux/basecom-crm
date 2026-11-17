# Alterações pedidas para versões futuras

Lista de pedidos do Leonardo (Administrador) que ficam para uma próxima versão.
Cada linha só sai daqui depois de feita, testada e publicada com a autorização dele.

## Exportação do ponto (Excel) — pedido de 16/11/2026, fase de testes

Não é para hoje nem para amanhã: fica para quando se juntarem as alterações dos testes.

1. **Uma folha por comercial** no ficheiro Excel.
2. **Soma do tempo diário de login**: o tempo do ponto conta só pelo login (entrada até saída, sem o almoço). Não se separa nem se soma Formação, Apoio, Office, Em cliente, Intervalo, etc.
3. **Só o Administrador exporta**, e apenas quando entra com o login de Administrador. Hoje o Chefe de Equipa também pode exportar a sua equipa; isto deixa de ser possível.

4. **No fim de cada folha, os totais do período**: número de dias de trabalho e total de horas de login.

## Tema escuro, fotos e Pipeline — pedido de 16/11/2026 (desenho por aprovar)

Desenho: https://claude.ai/artifact/U2NSSE9SRcvhQhsumFExEu

1. **Dois temas, Claro e Escuro (azul-noite)**, à escolha de cada pessoa, mais «Automático» (segue o Windows/Mac). Fica guardado por login.
2. **Fotos das pessoas** (carregadas em Equipa comercial); até lá, iniciais.
3. **Pipeline (Oportunidades)** com cores por etapa, cartão com OP, estado pela regra dos 7 dias, barra de dias sem atividade e foto do comercial; vista «Por etapa» e «Por comercial».

Decidido a 17/11/2026:
- Cores do tema escuro aprovadas (desenho, ecrãs 1 a 9).
- A vista «Por comercial» é vista pelo Administrador e pelo Chefe de Equipa.
- Campo novo «valor proposto (€/mês)» na oportunidade (soma por coluna e por comercial).
- Tudo o que é novo (Pipeline com cores, fotos, valor proposto, vista por comercial) também no **tema claro**, com as mesmas funções.

## Melhorias de 17/11/2026

Desenhos 10 a 12 em https://claude.ai/artifact/U2NSSE9SRcvhQhsumFExEu

Aprovado:
- **Callback com atalhos**: «1 hora · 1 dia · 1 semana · 1 mês» + calendário + horas (desenho 12 aprovado). **Todos os calendários do CRM passam a ter este design** (seleção de dia + horas de 30 em 30 min), em tamanho mais pequeno. No callback, **o calendário só deixa escolher até 1 mês** (configurável); sem mensagens de aviso. Nas outras datas (ex.: fim de fidelização) não há este limite.
- **«Aguarda docs»: tarefa automática** (Pedir documentos) ao fim de **2 dias**, com mensagem de lembrete pronta.
- **Mensagem rápida** WhatsApp/SMS/email (desenho 10). SMS: abre a app de mensagens do telemóvel BASECOM emparelhado com número e texto.

Por testar pelo Leonardo depois de construído:
- SMS pelo telemóvel BASECOM.

Confirmado (17/11): XSell e Upsell nunca vão juntos na mesma proposta (ou um ou outro, cada um pode juntar-se à FID).

Aprovado também:
- **Previsão de pontos** (desenho 11 aprovado): tipos de venda com até 2 por proposta (FID + XSell ou FID + Upsell; NN sozinho), valor por tipo, etiqueta «+X pontos» e caixa «Pontos do ciclo» com barra. Sem tabela de escalões.

- **Botão «Copiar» no NIF e na OP** onde aparecem (ficha, Ligar, Em cliente, oportunidades). Sem link para a extranet (o endereço da OP não traz o número).

Fora: lista «Prontos para FID» (já se faz com os filtros de campanha).

## Alterações de 17/11/2026 (tarde) — docx «Alterações ao CRM Basecom»

Desenhos 13 a 17 em https://claude.ai/artifact/U2NSSE9SRcvhQhsumFExEu (por aprovar).

Decidido:
- Cartão de chamada flutuante em todas as páginas, com **Mute**, Voltar e Desligar (desenho 13).
- Valor da proposta obrigatório (Proposta enviada, Em negociação, Venda).
- Proposta em 2 passos: só a OP → «Em cliente»; «Guardar e fechar» pede tipos, valor, canal, próxima ação; depois **volta ao Ligar normalmente** (desenhos 15 e 16).
- Canal de envio obrigatório: Email, WhatsApp, SMS, Em chamada, Presencial (configurável).
- Formação: Chefe de Equipa/Administrador põem e **tiram**; o comercial não sai sozinho; ao tirar recomeçam os 10 s.
- Terminar sessão por cima do nome.
- Ecrã «Chamadas recebidas» (não atendidas, incluindo durante outra chamada); carregar no número abre a(s) empresa(s) (desenho 14).
- Chamada recebida atendida abre janela igual à das chamadas da ficha (desenho 17).
- Números (badges) no menu: Agenda, Ligar (não atendidas), Pendências, Solicitações, Oportunidades.
- Assinatura do comercial no WhatsApp (à espera das assinaturas).
- RGPD fica como está.
- Callbacks saem da Agenda e voltam à fila do mesmo comercial à hora marcada, em qualquer campanha (opção a).
- iPhone: opção pessoal «Ligar pelo computador» (FaceTime do Mac) só no login do Leonardo.
- Foto do avatar dava «Não foi possível ler a imagem» (CSP bloqueava blob:) — corrigido.

Por decidir:
- Chamadas iniciadas e desligadas logo (contam no rating e reiniciam os tempos).
