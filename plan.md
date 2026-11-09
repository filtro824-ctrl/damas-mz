# Plano de migração do DAMAS MZ para Cloudflare

## Implementação

A versão Cloudflare será um Worker Module servido por Workers Static Assets. O Worker expõe a API REST e encaminha WebSockets para Durable Objects. O D1 será a fonte persistente de contas, sessões, perfis, pontos, rankings, salas, histórico, auditoria e configurações. Cada partida terá um Durable Object nomeado pelo `gameId`; o DO mantém o estado autoritativo da partida, valida lances com o motor existente em `shared/engine.js`, persiste o snapshot e os lances no D1 e usa a API de WebSocket Hibernation para reduzir custo quando estiver ocioso. R2 será opcional para avatares; a primeira versão mantém o avatar no D1/R2 apenas quando o binding existir.

A base SQLite original não será alterada nem apagada. `scripts/export-sqlite.mjs` cria um dump JSONL validado e `scripts/import-d1.mjs` aplica o dump em lotes ao D1, preservando IDs, relações e hashes. A migração SQL inicial é versionada em `migrations/0001_initial.sql`; todas as mudanças posteriores deverão ser novas migrações.

O servidor Node original e os 48 testes ficam preservados como referência de compatibilidade durante a transição, mas não fazem parte do caminho de produção Cloudflare. O Worker usa apenas APIs Web padrão e Cloudflare; não importa `node:sqlite`, `DatabaseSync`, caminhos locais ou armazenamento persistente local.

## Estrutura

- `src/index.js`: roteamento Worker, cabeçalhos, autenticação de sessão, assets e encaminhamento de WebSocket.
- `src/db.js`: helpers assíncronos D1, transações e queries parametrizadas.
- `src/auth.js`: hash PBKDF2 com WebCrypto, sessões opacas com hash, cookies seguros e recuperação.
- `src/game-room.js`: Durable Object por partida, estado, presença, reconexão, relógios, idempotência e aplicação do motor.
- `migrations/`: esquema D1 versionado.
- `scripts/`: exportação SQLite, importação D1, verificação de integridade e relatório.
- `public/` e `shared/`: frontend e motor existentes preservados.
- `server/`: implementação Node legada mantida somente para regressão e fallback local explícito.

## Design preservado

A identidade visual, o frontend JavaScript/CSS, o menu, o painel administrativo e o motor de Damas Portuguesas permanecem os existentes. A única alteração de cliente necessária para produção é trocar o endpoint de WebSocket para a rota de partida Cloudflare e manter o mesmo protocolo de mensagens (`hello`, `game`, `ack`, `match`, `notice`, `error`).

## Decisões de segurança

Senhas nunca são armazenadas em texto simples. Sessões usam tokens aleatórios, somente o hash vai para D1 e o cookie de produção usa `HttpOnly; Secure; SameSite=None`. Mutação exige validação de `Origin`, permissões são verificadas no backend e o motor nunca aceita um caminho que não seja legal. Nenhum pagamento é simulado ou ativado.

## Compatibilidade e custos

A configuração usa bindings D1, Durable Objects e Workers Static Assets, sem VPS. R2 só é necessário se avatares forem habilitados em produção. IDs de conta e estados legados são preservados pelo importador; a validação gera contagens por tabela, somas de ledger, usuários sem perfil/ranking e órfãos antes de qualquer cutover.
