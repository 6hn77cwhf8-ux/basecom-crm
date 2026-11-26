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

Aprovado (17/11, fim do dia): desenhos 13 a 18.
- Cores sóbrias (ecrã 18 «Cor com calma»): ícones do menu com cor suave, painel do dia com caixas de cor, ponto pequeno nos estados e etiquetas, linha fina nas etapas; números do menu a cinzento, só as não atendidas a laranja.
- **Sem pontos de cor nos botões de resultado** (Recusa, Callback, …): ficam brancos; o escolhido fica preto.

Construído na 0.12.0 (17/11, por publicar): itens acima, exceto assinaturas do WhatsApp (à espera) e chamadas desligadas logo a seguir (por decidir).
Por testar pelo Leonardo no telemóvel: Mute (depende do modelo), janela ao atender, não atendidas durante outra chamada.

## Correções de 18/11/2026 — para o fim do dia (NÃO fazer antes de o Leonardo dizer)

O Leonardo vai juntando correções durante o dia; só se constrói quando ele disser. Podem chegar mais.

1. **Mudar cliente para ex-cliente (ou NN) na ficha.** As bases estão desatualizadas. Na ficha, carregar no NC/FC (ou em «Cliente») e escolher NN ou Ex-cliente; a empresa passa a ser ex-cliente e sai da base de clientes atuais para a de ex-clientes.
   (Hoje: tipo de conta = Cliente/NN; «EX-CLIENTE» vem do estado no portal NOS e é usado nos filtros de campanha.)
2. **Recusa nova «Insatisfeito NOS».** Mesmo efeito do RGPD (Não contactar): sai de todas as campanhas e não se liga durante **1 ano**; depois do ano pode voltar a entrar.
3. **«O meu dia»: número de recusas** do dia (além das chamadas, atendidas, propostas e vendas).
4. **Próxima ação na proposta: escolher de uma lista** — Follow-up SMS, Follow-up email, Follow-up WhatsApp, Follow-up chamada — com o calendário à frente para a data.
5. **Feedback anterior com o resultado escolhido.** Hoje mostra data, comercial e o texto; tem de mostrar sempre o resultado (Recusa · motivo, Não atende, Callback, etc.). Linhas sem comentário aparecem vazias (print de 18/11).
6. **Não atende / voicemail: passar ao número seguinte.** Quando um número esgota o ciclo de não atende ou voicemail, fica em quarentena com a nota «Não atende permanentemente» / «Voicemail permanente» (não «incorreto») e entra o número seguinte. Ligar a todos os números. Sem mais números: a empresa fica em quarentena.
7. **Botão «Abrir ficha» sempre à mão** enquanto se trata um cliente: no resultado (feedback), na proposta, no Em cliente. Num canto, sem atrapalhar.

8. **Chamadas em simultâneo (muito importante).** O CRM tem de mostrar sempre o cliente que está de facto no telemóvel, seja recebida ou feita. Já aconteceu: o script ia avançar para o cliente seguinte, entrou uma chamada, o comercial falou com quem ligou, desligou e deu o feedback — e o feedback ficou no cliente que ia ser marcado, não no que ligou.
9. **Botão «Abrir script» no aviso de chamada a entrar.**
10. **Carregar num número ou email não abre logo o script.** Hoje, carregar num número abre a janela da chamada e não há forma de voltar atrás: é obrigatório pôr «Não atende» para fechar. Tem de perguntar primeiro (ex.: «Ligar e abrir script» · «Copiar» · «Cancelar»; no email «Abrir email» · «Copiar») e deixar fechar sem registar resultado quando ainda não se falou.

11. **Caixa «Cliente NOS sem NC/FC» no resultado: acrescentar NN** (ao lado de NC e FC). Escolher NN = a empresa já não é cliente → passa a ex-cliente (mesmo efeito do ponto 1).
12. **Agenda: os callbacks antigos** (de antes da 0.12) passam para a fila de cada comercial; as atrasadas vêm primeiro.
13. **Chamadas desligadas logo a seguir** (decidido 18/11): religar a mesma empresa antes de guardar o resultado põe a contagem em pausa (não recomeça); chamadas com menos de **5 s** (configurável) não contam no rating; religar conta como 1 chamada; CE e Administrador veem «chamadas curtas» na Equipa comercial. Sem códigos nem avisos.

14. **Menos avisos:** o aviso ao CE/Administrador de «resultado registado tarde» passa a ser só **a partir dos 100 s** (configurável). O comercial continua a ver os 15 s no ecrã, sem aviso.
15. **SMS «Tentámos ligar» no 1.º não atende** (desenho 19, por aprovar): no 1.º não atende de cada empresa, o resultado traz a SMS já escrita (decisor, empresa, comercial); «Não atende + SMS» grava e abre a SMS no telemóvel BASECOM; «Guardar sem SMS» só grava. Só telemóveis. Texto aprovado (18/11): «Bom dia, {decisor}. Tentámos ligar-lhe da NOS Empresas sobre as comunicações da {empresa}. Ligue-nos para este número quando lhe der jeito — são 2 minutos. {comercial} · NOS Empresas» (sem «BASECOM»; «Boa tarde» depois das 13h). Configurável em Mensagens rápidas.
16. **Editar o L2B na ficha** (mensalidade e meses de permanência; ex.: paga 200 € mas o L2B em Vpro é 130 €): qualquer perfil edita; fica no histórico (antigo → novo); a empresa **troca logo de campanha** (sai das que já não cumpre, entra nas que passa a cumprir); as importações seguintes não apagam a correção.

### Respostas do Leonardo (18/11)
- **Ex-cliente:** todos os perfis podem mudar, **com justificação** (auditoria e histórico). Sai das campanhas de clientes atuais, **perde a carteira NC/FC** e entra nas campanhas de ex-clientes (ex.: «NN | Ex-Cliente»). Só existe uma opção: **Ex-cliente** (não há «mudar para NN» separado).
- **Insatisfeito NOS:** motivo dentro de **Recusa**; sai de todas as campanhas; **12 meses configurável**; a ficha mostra «Insatisfeito NOS até dd/mm/aaaa»; o Administrador pode retirar antes; volta sozinha no fim do prazo.
- **Recusas:** no «O meu dia» e na Equipa comercial (por pessoa).
- **Próxima ação:** **só a lista** (Follow-up SMS · email · WhatsApp · chamada) + data, sem texto. Em Proposta (Guardar e fechar), Interessado e Em negociação. No dia: **Follow-up chamada → fila do comercial** (como os callbacks); SMS/email/WhatsApp → **Agenda** (com o botão Mensagem).
- **Números que não atendem:** **4 tentativas** (não atende ou voicemail; configurável) → o número fica em quarentena («Não atende permanentemente» / «Voicemail permanente») e passa ao seguinte. Sem mais números: a empresa **vai para o fim da fila** e só volta a sair quando já não houver empresas por contactar (não é por tempo).
- **Abrir ficha:** botão pequeno **ao lado do nome da empresa**, no resultado, na proposta e no Em cliente; abre por cima sem perder o que já escreveu.
- **Chamadas em simultâneo:** o CRM **segue o telemóvel**; só quando houver dúvida pergunta ao comercial («Está a falar com X ou com Y?»). A marcação cancelada por uma chamada a entrar volta ao **início da fila, sem contar tentativa**. Chamada em espera atendida: muda para quem ligou e volta à primeira se continuar.
- **Abrir script no aviso:** abre logo a **janela da chamada** (cliente + resultados), mesmo antes de atender; com várias empresas no número, escolhe primeiro a empresa.
- **Número/email na ficha:** menu primeiro (número: Ligar · Copiar · Cancelar; email: Abrir email · Copiar · Cancelar). Na janela da chamada, **«Fechar sem registar» só se não foi atendida**; essa chamada não conta no dia.

Prints recebidos: feedback anterior com linhas vazias; O meu dia (tema escuro); caixa NC/FC (tema escuro); Agenda ainda cheia de callbacks de 17/11.

Assinaturas recebidas a 19/11 (Ângela e Leonardo): construídas (cargo, telemóvel e email profissional por pessoa; modelo nas Configurações). Catarina ainda sem assinatura.

## Erros e pedidos de 20/11/2026 — FEITO na 0.14.0 (publicada a 23/11 à noite)

1. **Contador dos 10 s chega a 0 e não marca** (Ângela, 2 vezes). Causa provável: com uma chamada a entrar (aviso aberto) o Ligar pausa a marcação (0.13). Na app Android, uma chamada em espera que deixa de tocar durante outra chamada pode ser lida como «atendida» (o telemóvel volta ao estado «em chamada»), o que abre a janela da recebida e mantém o Ligar em pausa. A confirmar com a Ângela (viu o aviso «Chamada a entrar»?).
2. **Empresas recusadas voltaram a cair** (NIF 508657695 e 508898102). Causa provável: o resultado foi registado numa chamada fora da campanha (ex.: o cliente devolveu a chamada depois da SMS e a recusa foi dada na janela da chamada recebida, ou pela ficha). Nesse caso a entrada da campanha não é fechada e a empresa volta a ser marcada. Corrigir: um resultado com conversa, registado fora da campanha, fecha também as entradas por trabalhar dessa empresa em todas as campanhas.
   - No 508898102 o fim de fidelização ficou 19/11/2026 (o próprio dia) com o comentário «mais um ano»: o calendário deixa escolher datas passadas/hoje.
3. **Pipeline do comercial:** n.º de OPs, valor em pontos (pontos do plano: NN 6, XSell 3, FID 1, Upsell 0,5; FC 50 %), ganhos, perdidos, em atraso.
4. **Criar empresa diretamente no CRM.**
5. **Pipeline do Chefe de Equipa:** os mesmos números, por comercial e por equipa.
6. **Pipeline do Administrador:** n.º de OPs, valor em € ponderado pelos multiplicadores NOS (FID 1,5×, Upsell 1,5×, XSell 4,5×, NN 7,5×; FC ÷ 2), ganhos, perdidos, em atraso; por comercial, por equipa e total.
7. **Administrador começa no Pipeline** e não usa o Ligar.
8. **Chamada recebida: botão para abrir o script grande no Ligar.**
9. **O Administrador chama-se «Incognit Truth, Unipessoal Lda»**, não Leonardo.
10. **A SMS «Tentámos ligar» não é automática**: hoje abre a mensagem no telemóvel e é preciso carregar em enviar. Possível: a app envia sozinha (permissão de SMS na app BASECOM, que não está na Play Store).

Por publicar (feito a 19/11): assinatura no WhatsApp/email e telemóvel no fim da SMS.

### Respostas do Leonardo (20–21/11)
- **1. Contador:** ficou no ecrã da contagem, parado no 0 (sem aviso visível). Fazer: o Ligar volta a tentar sozinho se ficar parado no 0, mostra a razão quando está em pausa e guarda um registo de cada vez que devia marcar e não marcou; corrigir também a app (chamada em espera não atendida não conta como atendida).
- **2. Recusas:** um resultado com conversa registado fora da campanha fecha a empresa em todas as campanhas; o fim de fidelização só aceita datas a partir de amanhã.
- **3/5/6. Pipeline:** «N.º de OPs» e «Em atraso» = abertas agora; «Ganhos» e «Perdidos» = ciclo atual, quantidade e valor. Comercial em pontos (NN 6, XSell 3, FID 1, Upsell 0,5; FC 50 %); Administrador em € com os multiplicadores NOS (FID 1,5×, Upsell 1,5×, XSell 4,5×, NN 7,5×; FC ÷ 2), configuráveis e só visíveis ao Administrador (NN 8,5× fica para o Arranque B). CE: por comercial e por equipa; Administrador: por comercial, por equipa e total.
- **4. Criar empresa:** todos os perfis; pode preencher tudo; NN, NC ou FC; NIF validado e sem duplicados; fica sem carteira; abre logo a ficha, sem campanha.
- **7. Administrador:** começa no Pipeline e não tem o Ligar; pode ligar pela ficha.
- **8. Abrir script (chamada recebida):** abre o Ligar com o script grande dessa empresa — o da campanha onde está, ou o por omissão (NN / Cliente NOS); o resultado fecha a entrada da campanha.
- **9. Administrador** passa a chamar-se «Incognit Truth, Unipessoal Lda»; o Leonardo tem login próprio como Chefe de Equipa (assinatura e «Ligar pelo computador» nesse login).
- **10. SMS «Tentámos ligar»:** enviada sozinha pela app (autorização de SMS dada uma vez em cada telemóvel); histórico com «SMS enviada» / «falhou».

### Estado (23/11)
- Tudo construído na 0.14.0 e ensaiado com dados inventados. O prazo de segunda às 08:00 falhou (a sessão parou durante a noite); publicada na segunda, 23/11, depois das 19:35.
- Também na 0.14: o Administrador pode mudar nomes em Equipa comercial; «Receita NOS (multiplicadores)» nas Configurações.
- A confirmar no uso real: contador do Ligar (ver «Ligar parado no 0» na auditoria se voltar a acontecer); SMS automática nos 3 telemóveis.
- Por fazer pelo Leonardo: atualizar a app nos 3 telemóveis e dar a autorização de SMS; criar o login de Chefe de Equipa (Leonardo Rocha) se ainda não existir; assinatura da Catarina em falta.

## Pedidos de 23/11/2026 (noite) — Pipeline, Em cliente e Ligar (0.15)

Investigado:
- Pipeline: arrastar/«Mudar» nunca pede a OP; «Ganha» não pede o valor da venda; Ganha/Perdida no Pipeline não contam no «O meu dia» (só as chamadas contam).
- Em cliente: «Mudar para Venda/Proposta» abre um período novo → o tempo recomeça do zero (dá para aldrabar os tempos). Dá também para sair do Em cliente por outro estado sem «Guardar e fechar» (fica sem valor).

### Respostas do Leonardo (23/11)
1. **OP obrigatória** a partir de Proposta enviada (e Em negociação, Aguarda docs, Ganha): ao mudar de etapa sem OP, abre a janela a pedir a OP (7 algarismos). Interesse e Levantamento sem OP.
2. **Ganha/Perdida no Pipeline contam no dia do fecho:** Ganha = 1 venda, Perdida = 1 recusa no «O meu dia» do comercial (e nos números da equipa); sem contar duas vezes a mesma empresa fechada numa chamada.
3. **Valor da venda ao cêntimo obrigatório em todos os «Ganha»** (Pipeline, chamada, Em cliente): tipos (NN/XSell/FID/Upsell) já com os valores da proposta, que o comercial confirma ou corrige; guarda valor proposto e valor vendido.
4. **Em cliente:** mudar entre Proposta e Venda mantém a mesma contagem (a contar do início) e fica no histórico. Só se sai com «Guardar e fechar» (tipos e valor) ou «Cliente desistiu» (motivo → Perdida, conta como recusa); os outros estados ficam bloqueados enquanto está Em cliente.
5. **Nova recusa «Recusa à abordagem»:** 120 dias fora das campanhas (configurável), nos motivos de recusa e de perda.
6. **3 segundos:** depois de guardar o resultado, «Iniciar chamada» fica inativo 3 s (configurável).
7. **Chamada «Desligada» com o telemóvel ainda em chamada** (de vez em quando): a investigar (eventos da app Android/estado no Ligar).

### Estado (23/11, noite)
- 0.14.1 publicada às 19:34 (tags de campanha).
- 0.15.0 construída e ensaiada com dados inventados (OP pedida no Pipeline; Ganha com valor confirmado ao cêntimo; Em cliente: tempo contínuo ao mudar Proposta↔Venda, estados bloqueados, «Cliente desistiu»; Recusa à abordagem 120 dias; 3 s sem ligar; fechos no Pipeline/Em cliente contam no «O meu dia»). App Android 0.15: corrige o «Desligada» com a chamada ainda a decorrer (a confirmar no uso real).
- Fechos já feitos antes da 0.15 não têm valor vendido (ficam só com o valor proposto).

## Pedidos de 24/11/2026 — decididos, por construir (0.16; NÃO publicar sem ordem do Leonardo)

1. **Formação:** na Equipa comercial sai, mas o ecrã do comercial continua «Em formação» e o Ligar parado. Causa provável: o ecrã só relê o estado de 30 em 30 s e o Ligar guarda o seu próprio estado. Fazer: o sinal de presença (15 s) devolve o estado e o ecrã atualiza logo; o Ligar retoma; aviso «O seu responsável terminou a formação».
2. **Tags e juntar grupos nas campanhas:** todas as tags podem ser escolhidas (abaixo do mínimo só avisa). Juntam sempre (OU): Tags, Meses para o fim da permanência, Fim de fidelização (datas), Campanha NBO. Valor L2B: botão «Juntar / Restringir» em cada campanha. Os outros filtros restringem (E). Regra: restrições E (qualquer um dos que juntam).
3. **«Com quem está a falar?» trocado** (recebida atendida ao mesmo tempo que o script marcava): mostrar os dois números e as duas empresas; se o número que entra é da empresa do script, é a mesma conversa (não pergunta); número em várias empresas → mostrar todas (hoje apanha uma qualquer); registar cada caso.
4. **Ligar ao cliente durante a proposta (Em cliente) sem feedback:** botão «Ligar ao cliente»; no fim, nota opcional; histórico «Chamada durante a proposta · OP X · duração / não atendeu»; não conta como chamada de campanha; o tempo Em cliente continua.
5. **Callback de outra campanha:** faixa laranja larga por cima do script «CALLBACK · campanha X · marcado por Y para as HH:MM» e script rodeado a laranja.
6. **Avisos de tarefas da Agenda:** banner laranja no topo à hora marcada (em qualquer ecrã, mesmo em chamada, sem a cortar) com «Abrir» e «Daqui a 10 min»; caixa vermelha por cima de «Terminar sessão» com as tarefas em atraso até serem feitas; som curto (não toca durante uma chamada).
7. **Ganha/Perdida (Pipeline e Em cliente) fecha as tarefas dessa oportunidade** e os follow-ups de chamada dessa empresa na fila; outras tarefas da empresa ficam.
8. **Retribuir a chamada abre sempre o script grande:** «Ligar de volta» nas Chamadas recebidas e nas não atendidas (aviso e menu do número) abre o Ligar com o script dessa empresa.
9. **Ecrã proporcional em todo o CRM:** letra, caixas e espaços escalam com a janela; no Ligar o script cabe sempre inteiro, sem scroll. Ensaiar em 1280×800, 1366×768 e 1920×1080.
10. **Telemóveis:** OPPO a funcionar bem; TCL por testar (qualidade da chamada e eventos).

## Pedidos de 25/11/2026 — decididos, por construir (juntar à 0.16; NÃO publicar sem ordem do Leonardo)

Respostas do Leonardo:
- **Fidelizado recentemente (NOS)** (nova recusa): contacta-se sempre **8 meses DEPOIS do início do contrato** (corrigido a 25/11): contrato de 36 → liga quando faltarem **28**; contrato de 24 → quando faltarem **16**. Na nova fidelização, por omissão 36 (a 21: decisão nossa, em teoria 36).
- **Recusas que obrigam a deixar a informação do cliente** (mensalidade L2B e meses de permanência): só **recusa depois de proposta** (Perdida no Pipeline, «Cliente desistiu», recusa de empresa com proposta) e **Fidelizado recentemente**. As outras (ex.: Recusa à abordagem, Tem gestor) fecham só com o motivo, sem ir ao programa nem identificar NC/FC.
- **Ganha:** separar **valor ponderado** (o que se escreve por tipo, já com a FID proporcional; conta para os pontos; o total diz «Ponderado», sem «€/mês») de **nova mensalidade do cliente (L2B)** e **fidelização 24/36 meses**, obrigatórios, que atualizam a ficha.
- **L2B na venda muda no Ganha**, a contar da data do fecho (fim = fecho + 24/36 meses); quando houver a data de ativação (Arranque B), passa a contar da ativação.

Decidido pelo Claude (o Leonardo pediu para responder às perguntas):
- **O que o comercial escreve:** a **fidelização (24 ou 36 meses)** e os **meses que faltam** (a data de fim aparece logo). O CRM guarda a **data de fim de fidelização** e os meses descontam sozinhos na ficha e no L2B. Contacto automático = início do contrato + 8 meses (configurável), ou seja, quando faltarem 28 (de 36) ou 16 (de 24). Ex.: 36, faltam 34 → liga daqui a 6 meses. Se já faltarem 28/16 ou menos, entra já nas campanhas.
- **Campanhas por permanência:** o filtro passa a «**Faltam de X a Y meses**» (livre, ex.: 0–8, até 31), calculado a partir da data de fim; atalho «≤ 8 meses». Junta (OU) com os outros filtros de juntar, como decidido a 24/11.
- **Nova recusa «Tem gestor»:** volta às campanhas ao fim de **120 dias** (configurável); fecha só com o motivo.
- **Ponto em horas:** «7 h 32» (abaixo de 1 hora, «45 min»), igual na Equipa comercial, no «O meu dia» e no Excel.
- **Propostas com IA dentro do CRM:** ideia para o futuro (fim do Arranque B ou fase C); só anotado.

## Pedidos de 26/11/2026 — decididos, por construir (juntar à 0.16; NÃO publicar sem ordem do Leonardo)

1. **Empresa com oportunidade em curso no Ligar** (follow-up, callback ou campanha): etiqueta «Em oportunidade · etapa · OP» e três botões — «Iniciar chamada»; «Saltar» (sem resultado nem tentativa, volta mais tarde); «Follow-up» (dia e hora; sai da fila até lá, sem ligar). O Follow-up só aparece em empresas com oportunidade aberta.
2. **Cartão do Pipeline → «Em cliente» direto:** abre com a empresa e a OP do cartão (não se volta a escrever); só pergunta Proposta ou Venda. Sem OP no cartão, pede-a uma única vez e fica guardada.
3. **Etapa mudada numa chamada muda no Pipeline:** Interessado → Interesse; Proposta enviada → Proposta; Em negociação → Negociação; Venda → Ganha; Recusa → Perdida (mesmo motivo). Numa empresa com oportunidade, o resultado mostra «Etapa» para mudar à mão (com OP a partir de Proposta).
4. **Perdida (Pipeline, Em cliente ou recusa numa chamada) anula tudo o que está em espera dessa empresa:** callbacks, follow-ups, «Não atende» a voltar a tentar, entradas de campanha por trabalhar e tarefas da oportunidade. Só volta no fim do prazo do motivo. Tickets e tarefas que não são de vendas ficam. (Caso real: empresa dada como Perdida voltou a cair por um «Não atendeu» anterior.)
5. **Feedback do Pipeline aparece como «Importado» no Ligar** (erro): o «Feedback anterior» do Ligar marca como «Importado» tudo o que não é resultado de chamada, incluindo as notas escritas no CRM (Pipeline, atividades, Em cliente). Corrigir: «Importado» só nas notas que vieram de uma importação; as outras mostram a data e quem escreveu (`companyFeed` em `apps/server/src/dialer/service.ts` devolve se é importada; `PowerDialer.tsx` usa isso).
6. **Empresas recusadas voltam a cair (grave; caso real SERRALHARIA BRANCO, 23/11 e 26/11)** — vai na 0.16 (decisão do Leonardo):
   - Causa 1: a recusa dada dentro de uma campanha só fecha a entrada dessa campanha; a empresa continua por ligar noutras campanhas (aqui «NN | Ex-Cliente») e volta a cair (a correção da 0.14 só cobria recusas dadas fora de campanha).
   - Causa 2: a fila do Ligar não confirma, no momento de marcar, se a empresa está em prazo de recusa (`campaign_eligible_from`), «Não contactar» ou Insatisfeito NOS; só se vê ao criar/atualizar a campanha.
   - Fazer: recusa ou Perdida fecha a empresa em todas as campanhas e anula «Não atende»/callbacks/follow-ups em espera (ver ponto 4); a fila salta sempre empresas em prazo, «Não contactar» ou Insatisfeito; migração que limpa as empresas que já estão nesta situação; testes com o caso real (recusa por operadora em campanha A, empresa também pendente na campanha B).
