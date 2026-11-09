// Camada de dados. SQLite (node:sqlite, sem dependências) com esquema escrito em SQL portável:
// migrar para PostgreSQL consiste em trocar este módulo (ver docs/ARQUITETURA.md).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

let db = null;
const stmts = new Map();
let depth = 0;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  status_reason TEXT,
  created_at INTEGER NOT NULL,
  last_seen INTEGER,
  last_ip TEXT
);
CREATE TABLE IF NOT EXISTS profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  avatar_ext TEXT,
  avatar_ts INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT,
  ua TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  creator_id INTEGER NOT NULL REFERENCES users(id),
  category TEXT NOT NULL,
  entry INTEGER NOT NULL,
  wait_s INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  joined_by INTEGER REFERENCES users(id),
  game_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status, expires_at);
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  white_id INTEGER NOT NULL REFERENCES users(id),
  black_id INTEGER NOT NULL REFERENCES users(id),
  category TEXT NOT NULL,
  entry INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'room',
  status TEXT NOT NULL,
  result TEXT,
  reason TEXT,
  state_json TEXT NOT NULL,
  ply INTEGER NOT NULL DEFAULT 0,
  clock_w INTEGER NOT NULL,
  clock_b INTEGER NOT NULL,
  turn_started_at INTEGER,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  interrupted_since INTEGER,
  disconnects_w INTEGER NOT NULL DEFAULT 0,
  disconnects_b INTEGER NOT NULL DEFAULT 0,
  settled INTEGER NOT NULL DEFAULT 0,
  tournament_id INTEGER,
  match_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_games_white ON games(white_id);
CREATE INDEX IF NOT EXISTS idx_games_black ON games(black_id);
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
CREATE TABLE IF NOT EXISTS game_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL REFERENCES games(id),
  ply INTEGER NOT NULL,
  move_id TEXT NOT NULL,
  color TEXT NOT NULL,
  notation TEXT NOT NULL,
  path_json TEXT NOT NULL,
  captured_json TEXT NOT NULL,
  think_ms INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(game_id, ply),
  UNIQUE(game_id, move_id)
);
CREATE TABLE IF NOT EXISTS game_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  user_id INTEGER,
  kind TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_events_game ON game_events(game_id);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  amount INTEGER NOT NULL,
  game_id TEXT,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id);
CREATE TABLE IF NOT EXISTS rankings (
  user_id INTEGER NOT NULL REFERENCES users(id),
  category TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 1000,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, category)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  data_json TEXT,
  created_at INTEGER NOT NULL,
  read INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  target_user_id INTEGER REFERENCES users(id),
  game_id TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  handled_by INTEGER REFERENCES users(id),
  note TEXT,
  handled_at INTEGER
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  action TEXT NOT NULL,
  target TEXT,
  detail_json TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  kind TEXT NOT NULL,
  detail_json TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sec_kind ON security_events(kind, created_at);
CREATE TABLE IF NOT EXISTS tournaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  current_round INTEGER NOT NULL DEFAULT 0,
  winner_id INTEGER
);
CREATE TABLE IF NOT EXISTS tournament_players (
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (tournament_id, user_id)
);
CREATE TABLE IF NOT EXISTS tournament_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
  round INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  p1 INTEGER NOT NULL,
  p2 INTEGER NOT NULL,
  winner_id INTEGER,
  games INTEGER NOT NULL DEFAULT 0
);
`;

export function init(file) {
  if (db) throw new Error('BD já inicializada');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

export function close() {
  if (db) {
    stmts.clear();
    db.close();
    db = null;
  }
}

const norm = (a) => a.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
function st(sql) {
  let s = stmts.get(sql);
  if (!s) {
    s = db.prepare(sql);
    stmts.set(sql, s);
  }
  return s;
}

export const q = {
  get: (sql, ...p) => st(sql).get(...norm(p)),
  all: (sql, ...p) => st(sql).all(...norm(p)),
  run: (sql, ...p) => st(sql).run(...norm(p)),
};

/** Transação síncrona. Como o Node é single-thread e o SQLite é síncrono, cada transação é atómica. */
export function tx(fn) {
  if (depth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  depth++;
  try {
    const r = fn();
    depth--;
    db.exec('COMMIT');
    return r;
  } catch (e) {
    depth--;
    try { db.exec('ROLLBACK'); } catch { /* já revertida */ }
    throw e;
  }
}
