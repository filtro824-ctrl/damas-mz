# DAMAS MZ no Cloudflare

## Preparação

Instale Wrangler e autentique a conta Cloudflare. Crie um banco D1 e substitua `REPLACE_WITH_D1_DATABASE_ID` em `wrangler.jsonc`. O bucket R2 de avatares é opcional; se não for usado, remova o binding antes do deploy.

Defina os secrets sem os guardar no repositório:

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_PEPPER
```

`SESSION_PEPPER` deve ser um valor aleatório longo. Não reutilize a palavra-passe do administrador em outros serviços.

## Desenvolvimento local

```bash
npx wrangler d1 migrations apply damas-mz --local
npx wrangler dev
```

O Worker serve os ficheiros de `public/`, encaminha `/api/*` para a API e usa o binding `GAME_ROOMS` para WebSockets. A base local é descartável para desenvolvimento; nunca use o export de produção como teste destrutivo.

## Migração reversível

Pare as escritas no servidor legado ou coloque-o em manutenção. Faça uma cópia da base, sem apagar a original:

```bash
node scripts/export-sqlite.mjs /caminho/para/damas.db ./migration-export
node scripts/import-d1.mjs ./migration-export
npx wrangler d1 execute damas-mz --remote --file=./migration-export/import.sql
```

Confirme `report.json`, `import-report.json`, contagens por tabela, soma total do ledger, utilizadores, rankings e jogos. Só depois altere o DNS/rota para o Worker. O script usa `INSERT OR IGNORE`, preserva IDs e não modifica a base SQLite de origem.

## Verificação

```bash
npm test
npx wrangler deploy --dry-run
curl https://SEU-DOMINIO/api/health
```

O deployment não deve ser considerado concluído até que a migração remota, o health check, registo/login, uma sala e uma partida entre dois clientes sejam verificados no domínio real. M-Pesa, e-Mola e subscrições pagas continuam desativados até existir confirmação real do provedor.
