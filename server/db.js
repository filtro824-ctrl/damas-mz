// SQLite síncrono, sem dependências externas. Migrações aplicadas no arranque, apenas na base configurada.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

let db = null;
const stmts = new Map();
let depth = 0;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL, recovery_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', status TEXT NOT NULL DEFAULT 'active',
  status_reason TEXT, created_at INTEGER NOT NULL, last_seen INTEGER, last_ip TEXT
);
CREATE TABLE IF NOT EXISTS profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id), avatar_ext TEXT, avatar_ts INTEGER,
  theme_id TEXT NOT NULL DEFAULT 'classic', bio TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, ip TEXT, ua TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY, creator_id INTEGER NOT NULL REFERENCES users(id), category TEXT NOT NULL,
  wait_s INTEGER NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  joined_by INTEGER REFERENCES users(id), game_id TEXT, visibility TEXT NOT NULL DEFAULT 'public',
  invite_code TEXT, title TEXT NOT NULL DEFAULT 'Desafio aberto', min_rating INTEGER, max_rating INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status, expires_at);
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY, white_id INTEGER NOT NULL REFERENCES users(id), black_id INTEGER NOT NULL REFERENCES users(id),
  category TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'room', status TEXT NOT NULL, result TEXT, reason TEXT,
  state_json TEXT NOT NULL, ply INTEGER NOT NULL DEFAULT 0, clock_w INTEGER NOT NULL, clock_b INTEGER NOT NULL,
  turn_started_at INTEGER, created_at INTEGER NOT NULL, started_at INTEGER, ended_at INTEGER, interrupted_since INTEGER,
  disconnects_w INTEGER NOT NULL DEFAULT 0, disconnects_b INTEGER NOT NULL DEFAULT 0, settled INTEGER NOT NULL DEFAULT 0,
  tournament_id INTEGER, match_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_games_white ON games(white_id);
CREATE INDEX IF NOT EXISTS idx_games_black ON games(black_id);
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
CREATE TABLE IF NOT EXISTS game_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT NOT NULL REFERENCES games(id), ply INTEGER NOT NULL,
  move_id TEXT NOT NULL, color TEXT NOT NULL, notation TEXT NOT NULL, path_json TEXT NOT NULL,
  captured_json TEXT NOT NULL, think_ms INTEGER, created_at INTEGER NOT NULL,
  UNIQUE(game_id, ply), UNIQUE(game_id, move_id)
);
CREATE TABLE IF NOT EXISTS game_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT NOT NULL, user_id INTEGER, kind TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_events_game ON game_events(game_id);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount >= 0), game_id TEXT, note TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_created ON ledger(created_at);
CREATE TABLE IF NOT EXISTS rankings (
  user_id INTEGER NOT NULL REFERENCES users(id), category TEXT NOT NULL, rating INTEGER NOT NULL DEFAULT 1000,
  wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, draws INTEGER NOT NULL DEFAULT 0,
  win_streak INTEGER NOT NULL DEFAULT 0, best_streak INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, category)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
  text TEXT NOT NULL, data_json TEXT, created_at INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, reporter_id INTEGER NOT NULL REFERENCES users(id), target_user_id INTEGER REFERENCES users(id),
  game_id TEXT, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL,
  handled_by INTEGER REFERENCES users(id), note TEXT, handled_at INTEGER
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id INTEGER, action TEXT NOT NULL, target TEXT, detail_json TEXT, ip TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, kind TEXT NOT NULL, detail_json TEXT, ip TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sec_kind ON security_events(kind, created_at);
CREATE TABLE IF NOT EXISTS tournaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, size INTEGER NOT NULL, status TEXT NOT NULL,
  created_by INTEGER, created_at INTEGER NOT NULL, current_round INTEGER NOT NULL DEFAULT 0, winner_id INTEGER
);
CREATE TABLE IF NOT EXISTS tournament_players (
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id), user_id INTEGER NOT NULL REFERENCES users(id),
  joined_at INTEGER NOT NULL, PRIMARY KEY(tournament_id, user_id)
);
CREATE TABLE IF NOT EXISTS tournament_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tournament_id INTEGER NOT NULL REFERENCES tournaments(id), round INTEGER NOT NULL,
  slot INTEGER NOT NULL, p1 INTEGER NOT NULL, p2 INTEGER NOT NULL, winner_id INTEGER, games INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS plans (
  code TEXT PRIMARY KEY, name TEXT NOT NULL, price_mzn INTEGER NOT NULL CHECK(price_mzn >= 0), duration_days INTEGER NOT NULL,
  features_json TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), plan_code TEXT NOT NULL REFERENCES plans(code),
  status TEXT NOT NULL, starts_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, provider TEXT, provider_ref TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sub_user_expiry ON subscriptions(user_id, status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_active_user ON subscriptions(user_id) WHERE status='active';
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), plan_code TEXT NOT NULL REFERENCES plans(code),
  amount_mzn INTEGER NOT NULL CHECK(amount_mzn >= 0), provider TEXT NOT NULL, status TEXT NOT NULL,
  provider_ref TEXT UNIQUE, checkout_url TEXT, metadata_json TEXT, created_at INTEGER NOT NULL,
  confirmed_at INTEGER, confirmation_source TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status, created_at);
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL);
`;

const tableColumns = (name) => db.prepare(`PRAGMA table_info(${name})`).all().map((r) => r.name);
const hasColumn = (table, column) => tableColumns(table).includes(column);

function migrate() {
  const applied = db.prepare('SELECT version FROM schema_migrations WHERE version=1').get();
  if (applied) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    // Preserva a progressão virtual existente como saldo inicial, mas apaga o antigo histórico de entradas/prémios.
    const legacyBalances = db.prepare('SELECT user_id, MAX(0, SUM(amount)) AS balance FROM ledger GROUP BY user_id').all();
    if (hasColumn('rooms', 'entry')) db.exec('ALTER TABLE rooms DROP COLUMN entry');
    if (hasColumn('games', 'entry')) db.exec('ALTER TABLE games DROP COLUMN entry');
    if (!hasColumn('rooms', 'visibility')) db.exec("ALTER TABLE rooms ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'");
    if (!hasColumn('rooms', 'invite_code')) db.exec('ALTER TABLE rooms ADD COLUMN invite_code TEXT');
    if (!hasColumn('rooms', 'title')) db.exec("ALTER TABLE rooms ADD COLUMN title TEXT NOT NULL DEFAULT 'Desafio aberto'");
    if (!hasColumn('rooms', 'min_rating')) db.exec('ALTER TABLE rooms ADD COLUMN min_rating INTEGER');
    if (!hasColumn('rooms', 'max_rating')) db.exec('ALTER TABLE rooms ADD COLUMN max_rating INTEGER');
    if (!hasColumn('rankings', 'win_streak')) db.exec('ALTER TABLE rankings ADD COLUMN win_streak INTEGER NOT NULL DEFAULT 0');
    if (!hasColumn('rankings', 'best_streak')) db.exec('ALTER TABLE rankings ADD COLUMN best_streak INTEGER NOT NULL DEFAULT 0');
    if (!hasColumn('profiles', 'theme_id')) db.exec("ALTER TABLE profiles ADD COLUMN theme_id TEXT NOT NULL DEFAULT 'classic'");
    if (!hasColumn('profiles', 'bio')) db.exec("ALTER TABLE profiles ADD COLUMN bio TEXT NOT NULL DEFAULT ''");
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_invite_code ON rooms(invite_code) WHERE invite_code IS NOT NULL');
    db.exec('CREATE INDEX IF NOT EXISTS idx_ledger_created ON ledger(created_at)');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_active_user ON subscriptions(user_id) WHERE status=\'active\'');
    db.exec('DELETE FROM ledger');
    const insert = db.prepare('INSERT INTO ledger(user_id,kind,amount,game_id,note,created_at) VALUES(?,?,?,?,?,?)');
    const now = Date.now();
    for (const row of legacyBalances) if (row.balance > 0) insert.run(row.user_id, 'MIGRACAO_XP', row.balance, null, 'Saldo virtual convertido para progressão; sem valor monetário.', now);
    db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(1,?,?)').run('remove-stakes-add-progression-subscriptions', now);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* a migração já foi revertida */ }
    throw error;
  }
}

export function init(file) {
  if (db) throw new Error('BD já inicializada');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec(SCHEMA);
  migrate();
  return db;
}

export function close() {
  if (db) { stmts.clear(); db.close(); db = null; }
}

const norm = (a) => a.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
function st(sql) {
  let s = stmts.get(sql);
  if (!s) { s = db.prepare(sql); stmts.set(sql, s); }
  return s;
}
export const q = {
  get: (sql, ...p) => st(sql).get(...norm(p)),
  all: (sql, ...p) => st(sql).all(...norm(p)),
  run: (sql, ...p) => st(sql).run(...norm(p)),
};

/** Transação síncrona, atómica em SQLite. */
export function tx(fn) {
  if (depth > 0) return fn();
  db.exec('BEGIN IMMEDIATE'); depth++;
  try { const r = fn(); depth--; db.exec('COMMIT'); return r; }
  catch (e) { depth--; try { db.exec('ROLLBACK'); } catch { /* já revertida */ } throw e; }
}
