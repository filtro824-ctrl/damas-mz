# DAMAS MZ

Plataforma online de Damas para Moçambique. **Primeira versão funcional (demonstração)**, baseada nas
*Regras Básicas do Jogo de Damas Portuguesas* (FPDJ, homologadas em 25/01/2025).

> **Demonstração.** Os pontos são fictícios, não têm valor real, não são transferíveis nem convertíveis em
> dinheiro. Não existem apostas, pagamentos nem levantamentos. Qualquer funcionalidade com dinheiro dependeria
> de análise jurídica, licenciamento e autorização de prestadores de pagamento.

## Como executar

Requisitos: **Node.js 22.5 ou superior**. Não há dependências a instalar (`npm install` não é necessário).

```bash
cd damas-mz
ADMIN_PASSWORD='uma-palavra-passe-forte' npm start
# abrir http://localhost:3000        (jogo)
# abrir http://localhost:3000/admin.html   (painel administrativo; utilizador "admin")
```

- A conta de administrador é criada no primeiro arranque. Sem `ADMIN_PASSWORD`, é gerada uma palavra-passe
  aleatória e mostrada **uma só vez** na consola (não há palavra-passe fixa por omissão). Guarde-a e altere-a.
- Para testar com duas pessoas: abra duas janelas (uma anónima), registe duas contas, crie uma sala numa e entre
  na outra, ou use o emparelhamento automático nas duas.
- `npm run dev` reinicia o servidor ao alterar ficheiros. `npm test` corre os testes (48).

### Variáveis de ambiente

| Variável | Omissão | Descrição |
|---|---|---|
| `PORT` / `HOST` | 3000 / 0.0.0.0 | Endereço de escuta |
| `DATA_DIR` | `./data` | Pasta da base de dados SQLite e dos avatares |
| `DB_PATH` | (em `DATA_DIR`) | Caminho explícito da base de dados |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | admin / — | Conta de administrador principal |
| `STARTING_POINTS` | 5000 | Pontos demonstrativos iniciais |
| `CLOCK_MINUTES` | 10 | Tempo total por jogador |
| `START_TIMEOUT_SECONDS` | 180 | Tempo para ambos entrarem na partida; senão é cancelada e a entrada devolvida |
| `OFFLINE_GRACE_MS` | 4000 | Tolerância antes de contar uma desconexão (recarregar a página não conta) |
| `REVIEW_AFTER_MINUTES` | 10 | Desconexão sem regresso → partida "Em análise" |
| `QUEUE_SECONDS` | 60 | Tempo máximo no emparelhamento automático |
| `TOURNAMENT_START_TIMEOUT_MINUTES` | 15 | Limite para arranque de torneios |
| `REGISTER_LIMIT_PER_HOUR` | 10 | Registos por hora e por IP (antiabuso) |
| `TRUST_PROXY=1` | — | Usar `X-Forwarded-For` (atrás de proxy) |
| `COOKIE_SECURE=1` | — | Cookie de sessão só por HTTPS (**ligar em produção**) |

## O que está implementado

- **Contas**: registo, login, recuperação por código, perfil, ID único, avatar, histórico, estatísticas, rating.
- **Menu ☰ único** com os 10 itens: abre ao clicar; fecha com X, clique fora, ESC ou ao escolher uma opção.
- **Salas** Bronze 100 / Prata 250 / Ouro 500 / Diamante 1.000 pts, espera de 20 ou 30 s controlada pelo servidor;
  reserva atómica do lugar (duas pessoas nunca ocupam o mesmo).
- **Emparelhamento automático** por categoria.
- **Jogo**: Damas Portuguesas, todas as jogadas validadas no servidor. Cada jogador só controla as suas peças
  (cor atribuída pelo servidor; verifica identidade, cor, vez, validade e estado).
- **Tela de jogo limpa**: o **único** botão é *Expandir / ecrã inteiro*. Sem desistir, reiniciar ou controlo do adversário.
- **Reconexão**: perder a ligação não dá vitória a ninguém. O adversário é avisado, os relógios param, e o jogador
  volta à **mesma partida** com tabuleiro, relógio e vez exatos (automaticamente ao reabrir a aplicação).
  Sem regresso após `REVIEW_AFTER_MINUTES` → **Em análise**, ninguém é penalizado; a moderação decide
  (vitória/empate/cancelar/retomar) e fica no registo de auditoria.
- **Estados**: Em andamento · Interrompida · Aguardando reconexão · Concluída · Empate · Em análise (+ Cancelada).
- **Torneios gratuitos** e **classificações**.
- **Antifraude/auditoria**: eventos de segurança, limites de tentativas, denúncias; **nunca** há banimento automático
  por taxa de vitórias elevada.
- **Painel administrativo** (`/admin.html`): Dashboard, Utilizadores, Partidas, Salas, Torneios, Classificações,
  Denúncias, Segurança (eventos + auditoria), Relatórios, Configurações. Papéis: Administrador principal,
  Moderador, Suporte (só leitura).
- **Livro-razão de pontos** separado das partidas e resultados (`ENTRADA`, `PREMIO`, `REEMBOLSO_*`, `AJUSTE_ADMIN`, `BONUS_INICIAL`).
- **PWA** (instalável, service worker que nunca guarda `/api`, `/ws` ou avatares), tema claro/escuro/sistema,
  responsivo (telemóvel, tablet, PC) sem scroll horizontal.

## Regras implementadas (Damas Portuguesas, FPDJ 2025)

Tabuleiro 8×8, 32 casas escuras numeradas 1–32, 12 peças por jogador, as brancas começam. Peão move-se e
**captura só para a frente**. Dama voa (qualquer distância, frente e trás). **Captura obrigatória** com lei da
quantidade e depois da qualidade. Peças capturadas saem no fim do lance. Promoção só se o lance **termina** na
última fila. Empates: 20 lances de cada lado sem avanço de peão/captura, tripla repetição, regra dos 12 lances
(3 damas contra 1). Vitória por captura total, bloqueio ou tempo.

**Nota:** o segundo PDF enviado (manual de jogos de tabuleiro) descreve damas ao estilo brasileiro (peões capturam
para trás, etc.). Não foi usado; seguiu-se o regulamento FPDJ, como pedido ("regras originais"). O motor está em
`shared/engine.js` e a variante é uma constante (`VARIANT`), por isso é possível acrescentar outra variante depois.

## Arquitetura

```
shared/engine.js     Motor de regras (puro, sem dependências). Autoridade no servidor.
server/              http.js (API REST + estáticos), ws.js (WebSocket RFC 6455), realtime.js (mensagens),
                     games.js (partidas, relógios, reconexão), lobby.js (salas e fila), tournaments.js,
                     points.js (livro-razão), auth.js, security.js, notify.js, db.js (SQLite), config.js
public/              SPA em JavaScript puro (módulos ES), CSS com tokens, PWA; admin.html = painel
test/                engine.test.js (regras, 19) + server.test.js (integração, 29)
```

Princípios: o **servidor é a única fonte de verdade**; cada jogada leva `gameId`, `moveId` (idempotência) e `ply`
esperado, com `UNIQUE(game_id, ply)` na base de dados; relógios no servidor (o cliente só os desenha); CSP estrita
(sem scripts ou estilos inline); verificação de `Origin` em pedidos que alteram dados.

### Protocolo WebSocket (`/ws`, mensagens JSON)

Cliente → servidor: `{t:'ping'}`, `{t:'join', gameId}`, `{t:'move', gameId, moveId, ply, path:[casas]}`.
Servidor → cliente: `hello`, `pong`, `game` (estado completo), `ack` (`moveId`, `ok`), `match`, `notice`, `error`.

### API REST (resumo)

`/api/auth/{register,login,logout,recover}`, `/api/me`, `/api/points`, `/api/rooms` (+ `/:id/join`, `/:id/cancel`),
`/api/queue`, `/api/games/mine`, `/api/games/:id`, `/api/rankings`, `/api/tournaments`, `/api/reports`,
`/api/admin/*` (com verificação de papel em cada rota).

## O que foi testado

- `npm test`: **48/48** — regras (incluindo casos do diagrama FPDJ), registo/login/limites, recuperação, CSP,
  papéis, salas com concorrência (24 entradas simultâneas → exatamente uma partida), emparelhamento, imposição de
  cor/vez, jogadas duplicadas e atrasadas, desconexão/reconexão com tabuleiro exato, "Em análise" e decisão do
  moderador com auditoria, cancelamento com reembolso, tempo esgotado, persistência após reinício, torneios, denúncias.
- Ensaios no Chromium (telemóvel 390 px e PC 1280 px): menu ☰, tela de jogo com um só botão, exclusividade de cor,
  sincronização de jogadas, modo expandido, aviso de desconexão do adversário, regresso automático à mesma partida
  após fechar e reabrir o separador, painel admin sem scroll horizontal e sem erros de consola.

## O que NÃO foi testado / precisa de infraestrutura externa

- **Dispositivos e navegadores reais** (Android, iPhone/Safari, Firefox, Edge): só foi testado Chromium emulado.
  Instalação PWA e ecrã inteiro em iOS (usa um modo expandido alternativo) têm de ser validados em aparelhos reais.
- **Alojamento com HTTPS** e WebSockets persistentes (VPS, Railway, Fly.io…). Ligar `COOKIE_SECURE=1`, `TRUST_PROXY=1`
  e definir `ADMIN_PASSWORD` (antes do primeiro arranque). O disco tem de ser persistente (SQLite em `DATA_DIR`) e a aplicação corre numa só instância.
- **Envio real de e-mail/SMS** (recuperação de conta só por código; notificações são internas).
- **Escala**: para várias instâncias, migrar SQLite → PostgreSQL e o estado em memória (presença, fila) → Redis.
  O esquema SQL e os módulos estão separados para facilitar essa migração.
- **Dinheiro real** (M-Pesa, e-Mola, etc.): deliberadamente fora desta versão.

## Desvios em relação ao documento mestre

- **Stack**: JavaScript puro, `node:sqlite` e WebSocket próprio em vez de React/Next/Tailwind/Socket.IO/PostgreSQL/Redis,
  porque neste ambiente não era possível instalar pacotes. Funcionalmente equivalente; a migração está descrita acima.
- O botão ☰ do cabeçalho continua visível na tela de jogo como navegação global (não é um controlo da partida);
  no modo expandido o cabeçalho fica oculto.
- Questões em aberto: existência de desistência e o tempo para "Em análise" (10 min por omissão, configurável).
