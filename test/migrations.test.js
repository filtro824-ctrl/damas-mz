import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { init, close, q } from '../server/db.js';

test('migração legada mantém utilizadores e jogos, remove entradas e converte saldo virtual líquido para XP', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'damas-migration-'));
  const file = path.join(dir, 'legacy.db');
  const legacy = new DatabaseSync(file);
  legacy.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users(id INTEGER PRIMARY KEY,public_id TEXT,username TEXT,pass_hash TEXT,recovery_hash TEXT,role TEXT,status TEXT,status_reason TEXT,created_at INTEGER,last_seen INTEGER,last_ip TEXT);
    CREATE TABLE profiles(user_id INTEGER PRIMARY KEY,avatar_ext TEXT,avatar_ts INTEGER);
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER,created_at INTEGER,expires_at INTEGER,ip TEXT,ua TEXT);
    CREATE TABLE rooms(id TEXT PRIMARY KEY,creator_id INTEGER,category TEXT,entry INTEGER,wait_s INTEGER,status TEXT,created_at INTEGER,expires_at INTEGER,joined_by INTEGER,game_id TEXT);
    CREATE TABLE games(id TEXT PRIMARY KEY,white_id INTEGER,black_id INTEGER,category TEXT,entry INTEGER,source TEXT,status TEXT,result TEXT,reason TEXT,state_json TEXT,ply INTEGER,clock_w INTEGER,clock_b INTEGER,turn_started_at INTEGER,created_at INTEGER,started_at INTEGER,ended_at INTEGER,interrupted_since INTEGER,disconnects_w INTEGER,disconnects_b INTEGER,settled INTEGER,tournament_id INTEGER,match_id INTEGER);
    CREATE TABLE rankings(user_id INTEGER,category TEXT,rating INTEGER,wins INTEGER,losses INTEGER,draws INTEGER,PRIMARY KEY(user_id,category));
    CREATE TABLE ledger(id INTEGER PRIMARY KEY,user_id INTEGER,kind TEXT,amount INTEGER,game_id TEXT,note TEXT,created_at INTEGER);
    INSERT INTO users VALUES(1,'DM123456','antigo','x','y','user','active',NULL,1,NULL,NULL);
    INSERT INTO profiles VALUES(1,NULL,NULL);
    INSERT INTO rankings VALUES(1,'geral',1100,4,2,1);
    INSERT INTO rooms VALUES('r1',1,'bronze',100,20,'open',1,9999999999999,NULL,NULL);
    INSERT INTO games VALUES('g1',1,1,'bronze',100,'room','finished','w','captured','{}',10,1000,1000,NULL,1,1,2,NULL,0,0,1,NULL,NULL);
    INSERT INTO ledger(user_id,kind,amount,game_id,note,created_at) VALUES(1,'BONUS',500,NULL,'saldo',1),(1,'ENTRADA',-100,'g1','entrada',2),(1,'PREMIO',200,'g1','prémio',3);
  `);
  legacy.close();
  try {
    init(file);
    assert.equal(q.get("SELECT username FROM users WHERE id=1").username, 'antigo');
    assert.equal(q.get('SELECT COUNT(*) n FROM games WHERE id=\'g1\'').n, 1);
    assert.equal(q.get('SELECT SUM(amount) n FROM ledger WHERE user_id=1').n, 600);
    assert.equal(q.get('SELECT kind FROM ledger WHERE user_id=1').kind, 'MIGRACAO_XP');
    assert.equal(q.all('PRAGMA table_info(rooms)').some((x) => x.name === 'entry'), false);
    assert.equal(q.all('PRAGMA table_info(games)').some((x) => x.name === 'entry'), false);
    assert.equal(q.all('PRAGMA table_info(rankings)').some((x) => x.name === 'best_streak'), true);
    assert.equal(q.all('PRAGMA table_info(profiles)').some((x) => x.name === 'theme_id'), true);
    assert.equal(q.get('SELECT COUNT(*) n FROM schema_migrations WHERE version=1').n, 1);
    close();
  } finally {
    try { close(); } catch { /* já fechado */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
