// Ma'lumotlar bazasi qatlami. Barcha SQL repos/ ichida, faqat shu interfeys orqali ishlaydi:
//   run(sql, params) / get(sql, params) / all(sql, params) / exec(sql) / transaction(fn) / migrate() / close()
// node:sqlite hozircha eksperimental. Keyinroq better-sqlite3 yoki PostgreSQL'ga o'tish uchun
// faqat shu fayl (va migrations/) almashtiriladi — repos/ o'zgarmaydi.
const fs = require('fs');
const path = require('path');

function open(file) {
  const { DatabaseSync } = require('node:sqlite');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  const cache = new Map();
  const prep = (sql) => { let s = cache.get(sql); if (!s) { s = raw.prepare(sql); cache.set(sql, s); } return s; };
  let depth = 0;

  const db = {
    run(sql, params = []) {
      const r = prep(sql).run(...params);
      return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
    },
    get(sql, params = []) { return prep(sql).get(...params) || null; },
    all(sql, params = []) { return prep(sql).all(...params); },
    exec(sql) { raw.exec(sql); },
    /** Ichma-ich chaqiruvlar uchun SAVEPOINT ishlatadi. */
    transaction(fn) {
      const name = `sp${depth++}`;
      raw.exec(depth === 1 ? 'BEGIN' : `SAVEPOINT ${name}`);
      try {
        const out = fn();
        raw.exec(depth === 1 ? 'COMMIT' : `RELEASE ${name}`);
        return out;
      } catch (e) {
        raw.exec(depth === 1 ? 'ROLLBACK' : `ROLLBACK TO ${name}`);
        throw e;
      } finally { depth--; }
    },
    migrate(dir = path.join(__dirname, 'migrations')) {
      raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
      const done = new Set(db.all('SELECT version FROM schema_migrations').map((r) => r.version));
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
      const applied = [];
      for (const f of files) {
        if (done.has(f)) continue;
        db.transaction(() => {
          raw.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
          db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [f, Date.now()]);
        });
        applied.push(f);
      }
      return applied;
    },
    close() { raw.close(); },
  };
  return db;
}

module.exports = { open };
