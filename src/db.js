import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(import.meta.dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'network.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL UNIQUE,
  hostname TEXT,
  sys_descr TEXT,
  model TEXT,
  serial TEXT,
  vendor TEXT DEFAULT 'H3C',
  role TEXT DEFAULT 'access',
  device_type TEXT DEFAULT 'switch',
  location TEXT,
  status TEXT DEFAULT 'unknown',
  cpu REAL DEFAULT 0,
  memory REAL DEFAULT 0,
  uptime TEXT,
  last_seen TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS interfaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL,
  if_index INTEGER NOT NULL,
  if_name TEXT,
  if_descr TEXT,
  if_speed INTEGER DEFAULT 0,
  oper_status INTEGER DEFAULT 2,
  in_octets INTEGER DEFAULT 0,
  out_octets INTEGER DEFAULT 0,
  in_util REAL DEFAULT 0,
  out_util REAL DEFAULT 0,
  updated_at TEXT,
  FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE,
  UNIQUE(device_id, if_index)
);

CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_device_id INTEGER NOT NULL,
  local_port TEXT,
  remote_ip TEXT,
  remote_device_id INTEGER,
  remote_port TEXT,
  remote_chassis TEXT,
  bandwidth TEXT,
  updated_at TEXT,
  FOREIGN KEY(local_device_id) REFERENCES devices(id) ON DELETE CASCADE,
  UNIQUE(local_device_id, local_port, remote_chassis, remote_port)
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER,
  device_ip TEXT,
  severity TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT,
  value TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL,
  ip TEXT,
  content TEXT,
  hash TEXT,
  captured_at TEXT,
  FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL,
  cpu REAL,
  memory REAL,
  in_traffic REAL DEFAULT 0,
  out_traffic REAL DEFAULT 0,
  ts TEXT,
  FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS topology_layouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  positions TEXT NOT NULL,
  active INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_interfaces_device ON interfaces(device_id);
CREATE INDEX IF NOT EXISTS idx_links_local ON links(local_device_id);
CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(active, created_at);
CREATE INDEX IF NOT EXISTS idx_metrics_device_ts ON metrics(device_id, ts);
`);

const columns = db.prepare('PRAGMA table_info(devices)').all().map((c) => c.name);
if (!columns.includes('device_type')) db.exec("ALTER TABLE devices ADD COLUMN device_type TEXT DEFAULT 'switch'");

const now = () => new Date().toISOString();

export function upsertDevice(info) {
  const ts = now();
  if (info.sysDescr && !info.sys_descr) info.sys_descr = info.sysDescr;
  const existing = db.prepare('SELECT id FROM devices WHERE ip = ?').get(info.ip);
  if (existing) {
    db.prepare(`UPDATE devices SET hostname=?, sys_descr=?, model=?, serial=?, role=?, device_type=?, location=?, status=?, cpu=?, memory=?, uptime=?, last_seen=?, updated_at=? WHERE ip=?`)
      .run(info.hostname ?? null, info.sys_descr ?? null, info.model ?? null, info.serial ?? null, info.role ?? 'access', info.deviceType ?? 'switch', info.location ?? null, info.status ?? 'online', info.cpu ?? 0, info.memory ?? 0, info.uptime ?? null, ts, ts, info.ip);
    return existing.id;
  }
  const result = db.prepare(`INSERT INTO devices (ip, hostname, sys_descr, model, serial, role, device_type, location, status, cpu, memory, uptime, last_seen, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(info.ip, info.hostname ?? null, info.sys_descr ?? null, info.model ?? null, info.serial ?? null, info.role ?? 'access', info.deviceType ?? 'switch', info.location ?? null, info.status ?? 'online', info.cpu ?? 0, info.memory ?? 0, info.uptime ?? null, ts, ts, ts);
  return Number(result.lastInsertRowid);
}

export function replaceInterfaces(deviceId, list) {
  const ts = now();
  const stmt = db.prepare(`INSERT INTO interfaces (device_id, if_index, if_name, if_descr, if_speed, oper_status, in_octets, out_octets, in_util, out_util, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(device_id, if_index) DO UPDATE SET if_name=excluded.if_name, if_descr=excluded.if_descr, if_speed=excluded.if_speed,
      oper_status=excluded.oper_status, in_octets=excluded.in_octets, out_octets=excluded.out_octets,
      in_util=excluded.in_util, out_util=excluded.out_util, updated_at=excluded.updated_at`);
  const tx = db.transaction((rows) => rows.forEach((r) => stmt.run(deviceId, r.ifIndex, r.name, r.descr, r.speed, r.operStatus, r.inOctets, r.outOctets, r.inUtil ?? 0, r.outUtil ?? 0, ts)));
  tx(list);
}

export function replaceLinks(localDeviceId, list) {
  const ts = now();
  const stmt = db.prepare(`INSERT INTO links (local_device_id, local_port, remote_ip, remote_device_id, remote_port, remote_chassis, bandwidth, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(local_device_id, local_port, remote_chassis, remote_port) DO UPDATE SET
      remote_ip=excluded.remote_ip, remote_device_id=excluded.remote_device_id, remote_port=excluded.remote_port,
      bandwidth=excluded.bandwidth, updated_at=excluded.updated_at`);
  const tx = db.transaction((rows) => rows.forEach((r) => stmt.run(localDeviceId, r.localPort, r.remoteIp ?? null, r.remoteDeviceId ?? null, r.remotePort ?? null, r.remoteChassis ?? '', r.bandwidth ?? null, ts)));
  tx(list);
}

export function addMetric(deviceId, cpu, memory, inTraffic = 0, outTraffic = 0) {
  db.prepare('INSERT INTO metrics (device_id, cpu, memory, in_traffic, out_traffic, ts) VALUES (?, ?, ?, ?, ?, ?)')
    .run(deviceId, cpu, memory, inTraffic, outTraffic, now());
}

export function raiseAlert({ deviceId, deviceIp, severity, type, message, value }) {
  const active = db.prepare('SELECT id FROM alerts WHERE device_id=? AND type=? AND active=1').get(deviceId, type);
  if (active) {
    db.prepare('UPDATE alerts SET severity=?, message=?, value=?, created_at=? WHERE id=?')
      .run(severity, message, value ?? null, now(), active.id);
    return { id: active.id, created: false };
  }
  const result = db.prepare(`INSERT INTO alerts (device_id, device_ip, severity, type, message, value, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`)
    .run(deviceId, deviceIp, severity, type, message, value ?? null, now());
  return { id: Number(result.lastInsertRowid), created: true };
}

export function resolveAlert(type, deviceId) {
  db.prepare('UPDATE alerts SET active=0, resolved_at=? WHERE device_id=? AND type=? AND active=1').run(now(), deviceId, type);
}

const parsePositions = (row) => row ? { ...row, positions: JSON.parse(row.positions || '{}') } : null;

export function listLayouts() {
  return db.prepare('SELECT * FROM topology_layouts ORDER BY active DESC, updated_at DESC').all().map(parsePositions);
}

export function getActiveLayout() {
  return parsePositions(db.prepare('SELECT * FROM topology_layouts WHERE active=1 ORDER BY updated_at DESC LIMIT 1').get());
}

export function saveLayout(name, positions) {
  const ts = now();
  const cleanName = String(name ?? '').trim();
  if (!cleanName) throw new Error('布局名称不能为空');
  const existing = db.prepare('SELECT id FROM topology_layouts WHERE name=?').get(cleanName);
  const json = JSON.stringify(positions && typeof positions === 'object' ? positions : {});
  if (existing) {
    db.prepare('UPDATE topology_layouts SET positions=?, updated_at=? WHERE id=?').run(json, ts, existing.id);
    return parsePositions(db.prepare('SELECT * FROM topology_layouts WHERE id=?').get(existing.id));
  }
  const active = db.prepare('SELECT COUNT(*) n FROM topology_layouts').get().n === 0 ? 1 : 0;
  const result = db.prepare('INSERT INTO topology_layouts (name, positions, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(cleanName, json, active, ts, ts);
  return parsePositions(db.prepare('SELECT * FROM topology_layouts WHERE id=?').get(Number(result.lastInsertRowid)));
}

export function deleteLayout(id) {
  return db.prepare('DELETE FROM topology_layouts WHERE id=?').run(Number(id)).changes > 0;
}

export function activateLayout(id) {
  const row = db.prepare('SELECT * FROM topology_layouts WHERE id=?').get(Number(id));
  if (!row) throw new Error('布局版本不存在');
  db.transaction(() => {
    db.prepare('UPDATE topology_layouts SET active=0').run();
    db.prepare('UPDATE topology_layouts SET active=1, updated_at=? WHERE id=?').run(now(), Number(id));
  })();
  return parsePositions(db.prepare('SELECT * FROM topology_layouts WHERE id=?').get(Number(id)));
}

export function clearAllData() {
  db.exec('DELETE FROM metrics; DELETE FROM alerts; DELETE FROM links; DELETE FROM interfaces; DELETE FROM configs; DELETE FROM devices;');
}
