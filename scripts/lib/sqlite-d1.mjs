import { DatabaseSync } from 'node:sqlite';
export function sqliteD1(schema) {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec(schema);
  const prepare = (sql, values=[]) => ({
    sql, values, bind(...params) { return prepare(sql,params); },
    async all() { return { results:sqlite.prepare(sql).all(...values) }; },
    async first() { return sqlite.prepare(sql).get(...values) || null; },
    async run() { return { meta:sqlite.prepare(sql).run(...values) }; }
  });
  return { sqlite, prepare, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const output=statements.map(statement=>{const results=sqlite.prepare(statement.sql).all(...statement.values);return {results,meta:{changes:sqlite.prepare('SELECT changes() AS n').get().n}};}); sqlite.exec('COMMIT'); return output; }
    catch(error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
}
