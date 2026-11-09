import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || './migration-export';
const out = process.argv[3] || path.join(dir, 'import.sql');
const order = ['users','profiles','sessions','rankings','ledger','rooms','games','game_moves','game_events','notifications','reports','audit_logs','security_events','tournaments','tournament_players','tournament_matches'];
const esc = (v) => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `X'${Buffer.from(String(v)).toString('hex')}'`;
const sql = ['PRAGMA defer_foreign_keys = true;', 'BEGIN;']; const report = { generatedAt: new Date().toISOString(), tables: {} };
for (const table of order) {
  const file = path.join(dir, `${table}.jsonl`); if (!fs.existsSync(file)) continue;
  const rows = fs.readFileSync(file, 'utf8').trim() ? fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse) : [];
  report.tables[table] = rows.length; if (!rows.length) continue;
  const cols = Object.keys(rows[0]);
  for (const r of rows) sql.push(`INSERT OR IGNORE INTO "${table}" (${cols.map(c => `"${c}"`).join(',')}) VALUES (${cols.map(c => esc(r[c])).join(',')});`);
}
sql.push('COMMIT;'); fs.writeFileSync(out, sql.join('\n') + '\n'); fs.writeFileSync(path.join(dir, 'import-report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ out, ...report }, null, 2));
