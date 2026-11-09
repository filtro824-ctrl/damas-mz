import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const input = process.argv[2] || process.env.DB_PATH || './data/damas.db';
const outDir = process.argv[3] || './migration-export';
fs.mkdirSync(outDir, { recursive: true });
const db = new DatabaseSync(input, { readOnly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x => x.name);
const report = { source: path.resolve(input), exportedAt: new Date().toISOString(), tables: {}, errors: [] };
for (const table of tables) {
  const rows = db.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}"`).all();
  const file = path.join(outDir, `${table}.jsonl`);
  fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  report.tables[table] = { rows: rows.length, file };
}
const orphan = db.prepare('SELECT COUNT(*) n FROM games WHERE white_id NOT IN (SELECT id FROM users) OR black_id NOT IN (SELECT id FROM users)').get().n;
if (orphan) report.errors.push(`games órfãos: ${orphan}`);
const ledger = db.prepare('SELECT COALESCE(SUM(amount),0) n FROM ledger').get().n;
report.ledgerTotal = ledger;
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.errors.length) process.exitCode = 2;
