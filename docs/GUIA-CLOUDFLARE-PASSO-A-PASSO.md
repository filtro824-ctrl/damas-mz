# DAMAS MZ — Guia passo a passo para Cloudflare

> Importante: o pacote atual é a **Etapa 1**. Ele já contém Worker, D1, Durable Object, migração inicial e autenticação Cloudflare, mas ainda não porta toda a API administrativa, matchmaking, pontos, torneios e todas as regras de presença para produção. Execute primeiro em ambiente local e de teste.

## 1. Instalar os requisitos

No computador, instale:

- Node.js 22 ou superior.
- Uma conta Cloudflare.
- Wrangler, a ferramenta oficial da Cloudflare.
- Git, opcional, mas recomendado para guardar versões.

Verifique o Node e instale o Wrangler:

```bash
node --version
npm --version
npm install --save-dev wrangler
npx wrangler --version
```

Se estiver a usar apenas o telemóvel, a opção mais prática é abrir o **Cloudflare Dashboard > Workers & Pages > Create application** e usar um repositório GitHub. Para executar migrações e comandos D1, recomenda-se computador ou Cloud Shell.

## 2. Extrair o projeto

Extraia `damas-mz-cloudflare-etapa1.zip` e entre na pasta:

```bash
unzip damas-mz-cloudflare-etapa1.zip
cd damas-mz/damas-mz
npm install
```

Confirme que o motor e os testes originais continuam funcionando:

```bash
npm test
```

O resultado esperado nesta etapa é:

```text
# tests 48
# pass 48
# fail 0
```

## 3. Fazer login no Cloudflare

Execute:

```bash
npx wrangler login
```

O navegador abrirá a autorização da Cloudflare. Depois confirme a conta ligada:

```bash
npx wrangler whoami
```

Se aparecer mais de uma conta, use o Account ID correto no Dashboard ou acrescente `account_id` ao `wrangler.jsonc`.

## 4. Criar o banco D1

Crie o banco de produção:

```bash
npx wrangler d1 create damas-mz
```

O comando devolverá um `database_id`. Abra `wrangler.jsonc` e substitua:

```jsonc
"database_id": "REPLACE_WITH_D1_DATABASE_ID"
```

pelo ID verdadeiro, por exemplo:

```jsonc
"database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Não publique o `database_id` como segredo. Ele pode ficar na configuração; palavras-passe e chaves privadas não.

## 5. Aplicar a estrutura D1 localmente

Antes de tocar na base remota, aplique a migração local:

```bash
npx wrangler d1 migrations apply damas-mz --local
```

Verifique as tabelas:

```bash
npx wrangler d1 execute damas-mz --local --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

A migração inicial deve criar utilizadores, perfis, sessões, salas, partidas, movimentos, eventos, ledger, rankings, notificações, denúncias, auditoria e torneios.

## 6. Configurar secrets

Crie uma palavra-passe forte para o administrador e um segredo aleatório para sessões:

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_PEPPER
```

Quando o terminal pedir o valor, cole-o e pressione Enter. Não coloque esses valores no `wrangler.jsonc`, no GitHub ou no ZIP.

## 7. Testar o Worker localmente

Inicie o servidor Cloudflare:

```bash
npx wrangler dev
```

Abra o endereço local mostrado pelo Wrangler, geralmente:

```text
http://localhost:8787
```

Teste a saúde da API:

```bash
curl http://localhost:8787/api/health
```

O resultado deve conter `"ok":true` e `"runtime":"cloudflare-workers"`.

Teste a configuração:

```bash
curl http://localhost:8787/api/config
```

Não use ainda a base de produção durante estes testes.

## 8. Migrar os dados antigos com segurança

Primeiro faça uma cópia do SQLite original. Nunca trabalhe diretamente sobre a única cópia:

```bash
cp /caminho/para/damas.db ./damas-backup-antes-da-migracao.db
```

Exporte os dados sem apagar a base original:

```bash
node scripts/export-sqlite.mjs ./damas-backup-antes-da-migracao.db ./migration-export
```

Leia o relatório:

```bash
cat ./migration-export/report.json
```

Depois gere o SQL de importação:

```bash
node scripts/import-d1.mjs ./migration-export
```

O ficheiro gerado será:

```text
./migration-export/import.sql
```

Antes de importar, confirme principalmente:

- Número de utilizadores.
- Soma do ledger de pontos.
- Número de partidas.
- Número de movimentos.
- Rankings.
- Torneios.
- Ausência de partidas órfãs.

## 9. Aplicar a migração estrutural remota

Só depois de rever a exportação, aplique a estrutura D1 remota:

```bash
npx wrangler d1 migrations apply damas-mz --remote
```

Verifique a estrutura remota:

```bash
npx wrangler d1 execute damas-mz --remote --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

## 10. Importar os dados remotos

A importação deve ser feita apenas depois da migração estrutural:

```bash
npx wrangler d1 execute damas-mz --remote --file=./migration-export/import.sql
```

Depois valide as contagens. Exemplos:

```bash
npx wrangler d1 execute damas-mz --remote --command="SELECT COUNT(*) AS users FROM users"
npx wrangler d1 execute damas-mz --remote --command="SELECT COUNT(*) AS games FROM games"
npx wrangler d1 execute damas-mz --remote --command="SELECT COALESCE(SUM(amount),0) AS ledger_total FROM ledger"
```

Não elimine o SQLite original. Mantenha-o guardado até concluir o cutover e os testes de integridade.

## 11. Conferir o Durable Object

O `wrangler.jsonc` declara o Durable Object `GameRoom`. Cada partida deve usar um nome estável baseado no `gameId`.

Durante a primeira publicação, o Wrangler criará a classe declarada na migração `v1`. Não renomeie `GameRoom` depois de publicar sem criar uma migração de Durable Object adequada.

O WebSocket de teste usa a rota:

```text
/ws?gameId=ID_DA_PARTIDA
```

O cliente só deve conectar depois de possuir uma sessão válida. Para produção, valide ainda os jogadores, a cor, a vez, o `ply`, o `moveId`, os relógios e o estado persistido no D1 antes de liberar partidas reais.

## 12. Decidir sobre R2

O `wrangler.jsonc` inclui R2 para avatares. Se ainda não quiser usar avatares em R2, remova temporariamente o bloco `r2_buckets` antes do deploy ou crie os buckets indicados:

```bash
npx wrangler r2 bucket create damas-mz-avatars
npx wrangler r2 bucket create damas-mz-avatars-preview
```

A criação do bucket pode depender da conta e das permissões disponíveis. Não é necessário R2 para testar o motor de damas.

## 13. Fazer um dry-run

Antes de publicar:

```bash
npx wrangler deploy --dry-run
```

Corrija erros de configuração, principalmente:

- `database_id` ainda com valor de exemplo.
- Binding D1 incorreto.
- Bucket R2 inexistente.
- Classe `GameRoom` não exportada.
- Ficheiros da pasta `public` ausentes.

## 14. Publicar o Worker

Quando o dry-run estiver limpo:

```bash
npx wrangler deploy
```

O Wrangler mostrará o endereço `workers.dev`. Teste imediatamente:

```bash
curl https://SEU-WORKER.workers.dev/api/health
```

Depois abra no navegador:

```text
https://SEU-WORKER.workers.dev/
```

## 15. Testes mínimos após publicação

Faça estes testes num ambiente de teste:

1. Abrir a página inicial.
2. Registar uma conta.
3. Confirmar que o cookie de sessão tem `HttpOnly`, `Secure` e `SameSite=None`.
4. Sair e entrar novamente.
5. Tentar abrir uma rota protegida sem sessão.
6. Criar uma sala.
7. Abrir a aplicação em dois navegadores.
8. Testar a conexão WebSocket.
9. Criar uma partida de teste.
10. Enviar um movimento legal e um movimento ilegal.
11. Confirmar que o movimento ilegal é rejeitado pelo servidor.
12. Verificar a base D1 e os logs do Worker.

## 16. Ligar domínio próprio

No Cloudflare Dashboard:

1. Abra **Workers & Pages**.
2. Selecione o Worker `damas-mz`.
3. Abra **Settings > Domains & Routes**.
4. Adicione o domínio ou subdomínio desejado.
5. Aguarde a propagação.
6. Teste novamente `/api/health`, login e WebSocket usando HTTPS.

Não use `http://` em produção. WebSocket de produção deve usar `wss://` e o cookie deve permanecer `Secure`.

## 17. O que ainda não deve ser feito

Não ative pagamentos M-Pesa ou e-Mola nesta etapa. Não declare Premium ou VIP como pagos sem confirmação real do provedor. Não elimine o SQLite original. Não coloque a versão atual em produção com dinheiro real, porque a integração completa de matchmaking, painel, ledger, reconexão e validação do Durable Object ainda precisa ser concluída e testada.

## 18. Comandos resumidos

```bash
npm install
npm test
npx wrangler login
npx wrangler d1 create damas-mz
# editar wrangler.jsonc e inserir database_id
npx wrangler d1 migrations apply damas-mz --local
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_PEPPER
npx wrangler dev
node scripts/export-sqlite.mjs ./backup.db ./migration-export
node scripts/import-d1.mjs ./migration-export
npx wrangler d1 migrations apply damas-mz --remote
npx wrangler d1 execute damas-mz --remote --file=./migration-export/import.sql
npx wrangler deploy --dry-run
npx wrangler deploy
```
