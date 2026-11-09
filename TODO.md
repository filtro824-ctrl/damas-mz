# Entregas Cloudflare DAMAS MZ

- [ ] **Runtime Worker e assets** — Servir `public/` com Workers Static Assets; encaminhar `/api/*` para o Worker; manter headers de segurança, SPA e `/manus-routes.json`.
- [ ] **D1 sem SQLite em produção** — Remover do caminho Cloudflare `node:sqlite`, `DatabaseSync`, ficheiros `.db`, `DATA_DIR` e persistência local; aplicar migrações SQL próprias para D1 preservando utilizadores, credenciais, sessões, perfis, XP, rankings, histórico, planos, subscrições, configurações e auditoria.
- [ ] **Migração reversível** — Ler o SQLite original, mapear tabelas e relações, preservar identificadores e hashes, validar integridade, produzir relatório e não apagar a origem antes da confirmação.
- [ ] **Autenticação segura** — Preservar registo, login, logout, recuperação e permissões administrativas; nunca guardar palavras-passe em texto simples; usar hash, cookies e sessões seguros.
- [ ] **Partidas Durable Objects** — Criar e gerir salas, partidas, presença, WebSockets, reconexão e recuperação; cada partida tem estado próprio; validar identidade, cor, vez, `ply`, `moveId`, relógios e movimentos no servidor.
- [ ] **Motor preservado** — Não alterar desnecessariamente `shared/engine.js` nem as regras de Damas Portuguesas.
- [ ] **Planos e pagamentos** — Preservar Free/Premium/VIP e validação backend; preparar M-Pesa/e-Mola sem simular pagamentos ou ativar subscrições sem confirmação real.
- [ ] **Painel administrativo** — Preservar utilizadores, partidas, salas, rankings, planos, subscrições, estatísticas, configurações, denúncias, segurança e auditoria; bloquear utilizadores comuns.
- [ ] **Testes** — Preservar os 48 testes atuais, acrescentar testes Worker/D1/DO, autenticação, salas, emparelhamento, WebSockets, reconexão, XP, rankings, permissões, admin, migração e segurança.
- [ ] **Entrega operacional** — Fornecer código, configuração Wrangler, migrações, Durable Objects, relatório de testes, instruções por telemóvel/computador, secrets necessários, compatibilidade e custos; não declarar deploy sem execução e verificação.
