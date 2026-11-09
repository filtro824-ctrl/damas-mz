export const one = async (db, sql, ...args) => db.prepare(sql).bind(...args).first();
export const many = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
export const run = async (db, sql, ...args) => db.prepare(sql).bind(...args).run();
export const batch = async (db, statements) => db.batch(statements);
export const stmt = (db, sql, ...args) => db.prepare(sql).bind(...args);
export const bool = (v) => v ? 1 : 0;
