# Estado da migração

Em 9 de novembro de 2026, o projeto original foi auditado e a suíte existente passou com **48/48 testes**. O motor em `shared/engine.js` não foi alterado.

A primeira etapa adicionou uma configuração Wrangler com D1, Durable Object `GameRoom`, Workers Static Assets, migração SQL inicial, exportador SQLite→JSONL, gerador de importação D1, autenticação PBKDF2/WebCrypto e um Worker Cloudflare independente do servidor Node.

A origem SQLite permanece intacta. Não foi executado deployment remoto, não foi criado D1 real e não foram configurados secrets. Portanto esta etapa **não deve ser descrita como migração completa ou produção pronta**.

Ainda falta portar toda a superfície de API do painel e dos módulos legados para operações D1 assíncronas, integrar completamente salas/matchmaking/pontos/torneios/admin com o Durable Object, adaptar o cliente para o endpoint de partida e criar testes Miniflare/Wrangler para D1 e WebSockets. Esses itens permanecem abertos em `TODO.md`.
