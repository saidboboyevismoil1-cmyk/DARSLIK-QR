// Anonim, agregat statistika (shaxsiy ma'lumotsiz).
const day = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 10);

const create = (db, isEnabled = () => true) => ({
  day,
  inc(metric, dim1 = '', dim2 = '', value = 1, ts) {
    if (!isEnabled()) return;
    db.run(`INSERT INTO telemetry_daily (day, metric, dim1, dim2, value) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (day, metric, dim1, dim2) DO UPDATE SET value = value + excluded.value`, [day(ts), metric, String(dim1), String(dim2), value]);
  },
  range(from, to) { return db.all('SELECT day, metric, dim1, dim2, value FROM telemetry_daily WHERE day >= ? AND day <= ? ORDER BY day, metric', [from, to]); },
});
module.exports = { create, day };
