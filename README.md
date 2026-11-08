# DAMAS MZ

Plataforma online de competição de Damas Portuguesas para Moçambique, construída sobre o projeto fornecido. Preserva o motor e a lógica do jogo, o sistema de contas, o tempo real, a reconexão e o painel existente; acrescenta XP virtual, progressão, rankings por período, planos, personalização e salas privadas.

O XP serve apenas para classificação e reconhecimento dentro da plataforma. Não tem valor monetário, não é transferível e não pode ser levantado, convertido ou trocado por recompensas económicas. As subscrições pagas são um componente separado do XP.

## Instalação e execução

Requisitos: **Node.js 22.5 ou superior** (inclui `node:sqlite`). Não há dependências externas: não é necessário executar `npm install`.

```bash
# Descompacte o projeto, entre na pasta e defina uma senha forte antes do primeiro arranque.
ADMIN_PASSWORD='defina-uma-senha-forte' npm start
```

Abra `http://localhost:3000` para jogar e `http://localhost:3000/admin.html` para o painel. Configure também `ADMIN_USERNAME` se não quiser utilizar `admin`. A conta administrativa é criada apenas se ainda não existir. Se omitir `ADMIN_PASSWORD`, o servidor gera uma senha aleatória e mostra-a uma única vez na consola do primeiro arranque; não existe credencial fixa no código.

Para iniciar em desenvolvimento com reinício ao editar ficheiros: `npm run dev`. Para executar as verificações: `npm test`.

### Variáveis principais

| Variável | Omissão | Utilização |
|---|---:|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Endereço de escuta HTTP e WebSocket. |
| `DATA_DIR` | `./data` | Pasta persistente para SQLite e avatares. |
| `DB_PATH` | dentro de `DATA_DIR` | Caminho alternativo explícito para SQLite. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / aleatória | Credenciais da conta criada na inicialização. Defina senha forte antes do primeiro arranque. |
| `STARTING_POINTS` | `0` | XP virtual inicial. Não é saldo de jogo nem crédito monetário. |
| `CLOCK_MINUTES` | `10` | Tempo por jogador. |
| `START_TIMEOUT_SECONDS` | `180` | Prazo para os dois participantes entrarem na partida; o cancelamento não altera XP. |
| `OFFLINE_GRACE_MS` | `4000` | Tolerância a uma queda rápida/recarregamento. |
| `REVIEW_AFTER_MINUTES` | `10` | Prazo para uma partida interrompida passar a análise da moderação. |
| `QUEUE_SECONDS` | `60` | Tempo máximo da fila de matchmaking. |
| `TOURNAMENT_START_TIMEOUT_MINUTES` | `15` | Prazo para iniciar torneios. |
| `REGISTER_LIMIT_PER_HOUR` | `10` | Limite de registos por endereço IP. |
| `TRUST_PROXY=1` | desativado | Lê cabeçalhos de IP de proxy inverso confiável. |
| `COOKIE_SECURE=1` | desativado | Marca cookie de sessão como HTTPS; ative em produção atrás de HTTPS. |

A aplicação foi projetada para uma instância, com presença e fila em memória e base SQLite em armazenamento persistente.

## Funcionalidades

### Partidas, XP e progressão

- Damas Portuguesas conforme as regras da FPDJ (2025), com validação autoritativa de cada lance pelo servidor.
- Salas públicas, partida aleatória e matchmaking em tempo real; reconexão preserva tabuleiro, relógios e vez.
- XP por resultado, fixado no servidor: vitória **25 XP**, empate **10 XP** por participante, participação em derrota **5 XP**. Partidas canceladas antes de iniciar não alteram XP; não há débito ou distribuição entre adversários.
- Níveis de experiência (250 XP por nível), rating, vitórias, derrotas, empates, sequência atual/melhor e conquistas baseadas em marcos verificáveis.
- Rankings geral por rating e classificações semanais/mensais por XP obtido no período.
- Perfil, estatísticas, lista de partidas e replay permanecem disponíveis; o histórico completo é um benefício VIP e a restrição é aplicada no backend. O Premium pode gravar biografia de até 160 caracteres e usar temas especiais; o VIP vê, além do resumo por categoria, métricas detalhadas de resultados e média de lances por partidas concluídas.

### Planos e funcionalidades

Os três planos são persistidos na base e os preços podem ser alterados pela administração. As permissões são sempre verificadas no servidor.

| Plano | Preço padrão | Recursos principais |
|---|---:|---|
| Gratuito | **0 MT** | Partidas normais, adversários aleatórios, XP virtual, ranking básico, perfil e funcionalidades essenciais. |
| Premium | **99 MT/mês** | Pesquisa avançada (nome/rating), limites de pontuação, salas públicas personalizadas, biografia de perfil de até 160 caracteres, temas especiais e estatísticas avançadas. |
| VIP | **199 MT/mês** | Inclui recursos Premium e salas privadas avançadas com convite/código, tema exclusivo, histórico completo, métricas detalhadas por categoria e emblema especial. |

A validade vem do registo de subscrição ativa no servidor. A aplicação rebaixa o acesso para Gratuito ao expirar, mesmo antes da atualização de estado persistido. As salas privadas não aparecem nas listas públicas e exigem código de convite e acesso VIP.

## Estado e configuração de pagamentos

**O checkout real ainda não está implementado.** A integração preparada contém registo de tentativas, histórico, contratos de callback e validação HMAC-SHA256, mas falta um adaptador específico para uma conta de comerciante M-Pesa, e-Mola ou outro provedor disponível. Sem o adaptador oficial e credenciais não há cobrança, tentativa fica `not_configured` e o plano não é ativado. O painel não tem confirmação manual.

A ativação de um plano exige uma tentativa pendente e uma confirmação válida do backend; uma confirmação é aplicada de modo transacional e idempotente. O endpoint de callback documentado é `POST /api/payments/webhook/:provider`, com header `X-Damas-Signature: sha256=<hex>` e corpo JSON `{ "status":"paid", "paymentId":"...", "providerRef":"..." }`. O HMAC genérico atual **não é automaticamente compatível com qualquer gateway**: o adaptador deve seguir a documentação e o mecanismo de assinatura oficiais do provedor antes de produção.

Variáveis reservadas para a futura integração (não tornam o checkout disponível neste pacote): `PAYMENT_PROVIDER=mpesa|emola`, `PAYMENT_API_URL`, `PAYMENT_API_TOKEN`, `PAYMENT_CHECKOUT_URL` e `PAYMENT_WEBHOOK_SECRET`. Não coloque credenciais no frontend, no repositório, em logs ou em argumentos de terminal. Obtenha credenciais da conta de comerciante do provedor, implemente e teste o adaptador, valide callbacks em ambiente de sandbox e só então habilite cobranças.

Leia [`docs/PAGAMENTOS_E_MIGRACOES.md`](docs/PAGAMENTOS_E_MIGRACOES.md) antes de integrar um provedor ou publicar alterações de schema.

## Administração

Aceda a `/admin.html`. O painel preserva gestão de contas, partidas, salas abertas (moderadores podem cancelá-las, com auditoria), torneios, denúncias, segurança, auditoria e relatórios; acrescenta edição auditada de preços/estado dos planos, listagem/cancelamento de subscrições, leitura de tentativas e referências de pagamento, e rankings geral/semanal/mensal. Configurações de runtime são apresentadas em modo de leitura porque vêm do ambiente/servidor. Ajustes manuais de XP/rating exigem papel e justificação e são registados na auditoria. Administradores não confirmam pagamentos manualmente.

Papéis existentes: suporte (leitura), moderador (gestão de partidas/denúncias) e administrador principal (gestão de planos e parâmetros sensíveis), sujeitos a autorização por rota.

## Base de dados e migração

A aplicação usa SQLite, e `server/db.js` mantém migrações versionadas em `schema_migrations`. A migração incluída remove colunas antigas de entrada das tabelas de sala/partida, adiciona campos para convites, XP, sequências, planos, subscrições e pagamentos, preserva contas, rankings e jogos, e converte o saldo virtual líquido legado para uma linha neutra de XP, sem carregar histórico antigo de entradas/prémios para a nova progressão.

**Não execute a migração em produção durante o desenvolvimento.** Antes da implantação, faça cópia de segurança, teste a migração numa cópia isolada do SQLite e confirme a reversibilidade/estratégia de restauração. Os testes deste pacote usam apenas bases de teste ou temporárias.

## Estrutura

- `shared/engine.js`: motor original de regras.
- `server/`: HTTP/WebSocket, autenticação, partidas, matchmaking/salas, XP, planos, pagamentos e SQLite.
- `public/`: interface SPA em JavaScript, CSS, painel administrativo e metadados/ícones PWA. No ZIP fonte recebido, o modo autónomo não é ativado pelo cliente.
- `test/`: regras, integração do servidor e migração de um esquema legado.
- `docs/`: detalhes de migrações e de integração externa ainda necessária.

A aplicação mantém tokens CSS e componentes/ícones DAMAS MZ existentes, com layout responsivo. Continua a ser necessário validar em dispositivos físicos iOS/Android e browsers além do Chromium.

## Verificações

Execute `npm test` para rodar as verificações de regras, endpoints de contas e sessão, matchmaking concorrente, salas públicas/privadas, jogadas WebSocket, XP e ranking, planos Free/Premium/VIP, expiração, gestão administrativa, torneios, denúncias e migração. Para subir a aplicação com os dados persistidos, defina `DATA_DIR` e `ADMIN_PASSWORD` e execute `npm start`.
