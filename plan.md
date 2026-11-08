# Plano de transformação — DAMAS MZ

## Base técnica encontrada

O arquivo recebido contém uma aplicação Node.js 22+ em módulos ES, sem dependências de terceiros: servidor HTTP e WebSocket próprio, SQLite via `node:sqlite`, interface SPA em JavaScript/CSS nativos, PWA e 48 testes existentes. O motor de Damas Portuguesas em `shared/engine.js`, autenticação e sessão em `server/auth.js`, sincronização/reconexão em `server/games.js` e o painel em `public/js/admin.js` são funcionalidades que devem ser preservadas. Não há hoje pagamentos reais, mas o fluxo de salas/partidas debita pontos como “entrada” e credita um “prémio” ao vencedor; esse fluxo é a principal lógica a retirar.

## Abordagem de implementação

1. **Jogo e economia virtual:** manter o motor, regras, autenticação, WebSocket, reconexão, denúncias e torneios gratuitos. Eliminar a entrada de pontos de salas/partidas, verificações de saldo mínimo, débitos, reembolsos e prémios proporcionais à entrada. Introduzir uma atribuição fixa de pontos de progressão por resultado, sem transferência entre jogadores nem resgate; a regra será centralizada no servidor e coberta por testes. Atualizar os textos, histórico, perfil, ajuda e painel para não expor a economia antiga.
2. **Persistência compatível:** acrescentar migrações SQLite versionadas e executáveis em base isolada. Remover a semântica de entrada do esquema de salas/partidas; adicionar visibilidade/código de convite a salas, sequência de vitórias e eventos de classificação quando necessários, além de tabelas para planos, subscrições e tentativas/histórico de pagamento. Preservar utilizadores e resultados; transformar saldo virtual legado em saldo inicial de progressão, sem conservar transações de entrada/prémio. Nenhuma base de produção será migrada durante o desenvolvimento.
3. **Salas e partidas:** as salas públicas e a fila aleatória passam a usar apenas categoria/rating, nunca saldo. Salas privadas serão acessíveis por código de convite e não aparecerão na lista pública. Pesquisa avançada, intervalo de rating e salas privadas/personalizadas serão autorizados no servidor conforme plano ativo. Convites serão links/códigos compartilháveis, sem exigir uma rede social de amizades inexistente no projeto.
4. **Rankings, perfis e histórico:** estender os dados do resultado para ranking geral, semanal e mensal; mostrar rating, XP acumulado, nível, vitórias/derrotas/empates, sequência e conquistas derivadas de critérios verificáveis. Manter a lista/replay de partidas e acrescentar o histórico completo como benefício VIP, sempre com controle de acesso no backend.
5. **Planos e pagamentos:** criar planos Free (0 MT), Premium (99 MT/mês) e VIP (199 MT/mês), com preços configuráveis pela administração. Todas as verificações de funcionalidade serão feitas no servidor e a expiração rebaixará o acesso para Free. A integração terá contrato/adaptador de provedor e endpoints preparados para M-Pesa/e-Mola, mas, sem credenciais e confirmação assinada do provedor, pedidos permanecerão pendentes/não configurados; não serão simulados pagamentos nem ativações.
6. **Administração e interface:** preservar as telas/roles atuais e acrescentar administração de planos, subscrições, salas, partidas, rankings, estatísticas e estado/histórico de pagamentos, com trilha de auditoria. Reutilizar componentes, cores, tipografia, marca DAMAS MZ, tema claro/escuro e padrões responsivos já presentes; não aplicar template genérico.
7. **Documentação e entrega:** atualizar README com instalação, configuração de planos, contrato/credenciais do gateway, migrações e limites externos; entregar relatório de mudanças e testes, além de ZIP do projeto atualizado.

## Estrutura do projeto

- `shared/engine.js`: regras puras do jogo; manter intacto salvo necessidade comprovada.
- `server/`: API, autenticação/autorização, partidas, salas, ranking/XP, planos/pagamentos e banco/migrações.
- `public/js/`: SPA e páginas existentes; atualizar navegação, salas, perfil, rankings e painel administrativo.
- `public/css/` e `public/*.html`: identidade visual e estrutura estática existentes.
- `test/`: testes de motor e integração HTTP/WebSocket; ampliar cobrindo migrações, matchmaking, permissões, expiração e ausência de débitos/prémios por entrada.
- `docs/`: documentação do gateway e do modelo de permissões, sem credenciais.

## Direção de design

**Movimento:** produto competitivo de xadrez/damas contemporâneo, com contenção editorial e sinais subtis de torneio. **Princípios:** preservar a marca existente; leitura rápida de rating/estado; hierarquia funcional; controles acessíveis e responsivos. **Cor:** manter os tokens e os temas claro/escuro atuais; reservar a cor de destaque da DAMAS MZ para ação primária e progressão. **Layout:** conservar cabeçalho e menu lateral móvel, com conteúdo por página, painéis compactos e listas legíveis — sem transformar o jogo num dashboard genérico. **Elementos distintivos:** marca/ícone de tabuleiro existente; chips de categoria/estado; indicadores de XP e posição. **Interação/animação:** aproveitar padrões existentes, usar transições breves e respeitar movimento reduzido; não atrasar ações de partida. **Tipografia:** manter a pilha tipográfica existente e a hierarquia já definida no CSS. **Essência da marca:** competição de Damas Portuguesas online para Moçambique, com progressão transparente e sem apostas; personalidade: competitiva, acessível e confiável. **Tom:** direto e desportivo (ex.: “Encontre um adversário à sua medida.”; “Cada partida conta para a classificação.”). **Logótipo:** preservar o wordmark e o símbolo DAMAS MZ existentes. **Cor de marca:** manter a cor própria de destaque já definida nos tokens CSS.

## Restrições e decisões de produto

A aplicação atual foi desenhada para uma única instância e estado de fila/presença em memória; o trabalho preservará essa implantação. A autenticação e os papéis atuais serão reutilizados. Pontos são exclusivamente progressão virtual, não moeda, saldo de aposta ou direito económico. Os preços iniciais serão os indicados no briefing, alteráveis por administrador. Integração financeira real, renovação automática e confirmação de pagamento dependem de credenciais, configuração do provedor e webhook autenticado, não fornecidos neste momento.
