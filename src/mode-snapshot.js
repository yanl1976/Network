import { db } from './db.js';

const DATA_TABLES = ['devices', 'interfaces', 'links', 'configs', 'alerts', 'metrics'];

export function captureDataset() {
  const snapshot = {};
  for (const table of DATA_TABLES) {
    snapshot[table] = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
  }
  return snapshot;
}

export function restoreDataset(snapshot) {
  db.transaction(() => {
    for (const table of DATA_TABLES) db.prepare(`DELETE FROM ${table}`).run();
    for (const table of DATA_TABLES) {
      const rows = snapshot?.[table] ?? [];
      if (!rows.length) continue;
      const columns = Object.keys(rows[0]);
      const placeholders = columns.map(() => '?').join(', ');
      const stmt = db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`);
      for (const row of rows) stmt.run(...columns.map((col) => row[col] ?? null));
    }
  })();
}

export function saveModeSnapshot(mode, snapshot) {
  db.prepare(`
    INSERT INTO mode_data_snapshots (mode, data, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(mode) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(mode, JSON.stringify(snapshot), new Date().toISOString());
}

export function loadModeSnapshot(mode) {
  const row = db.prepare('SELECT data FROM mode_data_snapshots WHERE mode = ?').get(mode);
  return row ? JSON.parse(row.data) : null;
}

export function hasModeSnapshot(mode) {
  return Boolean(db.prepare('SELECT 1 FROM mode_data_snapshots WHERE mode = ?').get(mode));
}
