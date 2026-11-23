import { db } from '../db.js';

const roleLabel = { core: '核心交换机', aggregation: '汇聚交换机', access: '接入交换机', border: '边界设备', server: '服务器' };

function deviceTypeOf(row) {
  if (row.device_type) return row.device_type;
  const name = (row.hostname || '').toUpperCase();
  const model = row.model || '';
  if (name.startsWith('FW') || /SECPATH|F100/i.test(model)) return 'firewall';
  if (name.startsWith('RT') || /MSR\s?\d/i.test(model)) return 'router';
  if (name.startsWith('SRV') || row.role === 'server') return 'server';
  return 'switch';
}

export function getOverview(config) {
  const devices = db.prepare('SELECT status, cpu, memory, role FROM devices').all();
  const alerts = db.prepare('SELECT severity, type, device_ip FROM alerts WHERE active=1').all();
  const online = devices.filter((d) => d.status === 'online' || d.status === 'warning' || d.status === 'critical').length;
  const avg = (field) => devices.length ? Math.round(devices.reduce((s, d) => s + (d[field] || 0), 0) / devices.length) : 0;
  const links = db.prepare('SELECT COUNT(*) AS n FROM links').get()?.n ?? 0;
  const byRole = Object.keys(roleLabel).map((role) => ({ role, label: roleLabel[role], count: devices.filter((d) => d.role === role).length }));
  return {
    mode: config.mode,
    totalDevices: devices.length,
    online,
    offline: devices.length - online,
    linkCount: links,
    alertCount: alerts.length,
    criticalCount: alerts.filter((a) => a.severity === 'critical').length,
    warningCount: alerts.filter((a) => a.severity === 'warning').length,
    avgCpu: avg('cpu'),
    avgMemory: avg('memory'),
    byRole,
    lastPoll: db.prepare('SELECT MAX(ts) AS ts FROM metrics').get()?.ts ?? null,
    updatedAt: new Date().toISOString()
  };
}

export function getDevices() {
  const rows = db.prepare(`SELECT d.*,
    (SELECT COUNT(*) FROM interfaces i WHERE i.device_id=d.id) AS interface_count,
    (SELECT COUNT(*) FROM alerts a WHERE a.device_id=d.id AND a.active=1) AS alert_count
    FROM devices d ORDER BY CASE d.role WHEN 'core' THEN 0 WHEN 'aggregation' THEN 1 WHEN 'border' THEN 2 WHEN 'access' THEN 3 ELSE 4 END, d.ip`);
  return rows.all().map((row) => ({ ...row, deviceType: deviceTypeOf(row), roleLabel: roleLabel[row.role] ?? row.role }));
}

export function getDeviceDetail(id) {
  const device = db.prepare('SELECT * FROM devices WHERE id=?').get(id);
  if (!device) return null;
  const interfaces = db.prepare('SELECT * FROM interfaces WHERE device_id=? ORDER BY if_index').all(id);
  const metrics = db.prepare('SELECT cpu, memory, in_traffic, out_traffic, ts FROM metrics WHERE device_id=? ORDER BY ts DESC LIMIT 60').all(id).reverse();
  const alerts = db.prepare('SELECT * FROM alerts WHERE device_id=? ORDER BY created_at DESC LIMIT 20').all(id);
  const configs = db.prepare('SELECT id, hash, captured_at, LENGTH(content) AS bytes FROM configs WHERE device_id=? ORDER BY captured_at DESC LIMIT 20').all(id);
  return { ...device, deviceType: deviceTypeOf(device), roleLabel: roleLabel[device.role] ?? device.role, interfaces, metrics, alerts, configs };
}

export function getTopology() {
  const devices = db.prepare('SELECT id, ip, hostname, role, device_type, status, cpu, memory, model, location FROM devices').all();
  const deviceByIp = new Map(devices.map((d) => [d.ip, d]));
  const links = db.prepare('SELECT * FROM links').all();
  const seen = new Set();
  const edges = [];

  for (const link of links) {
    const localIp = link.local_device_id ? devices.find((d) => d.id === link.local_device_id)?.ip ?? null : null;
    const remoteIp = link.remote_ip || (link.remote_device_id ? devices.find((d) => d.id === link.remote_device_id)?.ip : null);
    if (!localIp || !remoteIp || localIp === remoteIp) continue;
    const key = [localIp, remoteIp].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const up = deviceByIp.get(localIp)?.status !== 'offline' && deviceByIp.get(remoteIp)?.status !== 'offline';
    edges.push({
      id: `e-${key}`,
      source: localIp,
      target: remoteIp,
      label: link.bandwidth || '',
      bandwidth: link.bandwidth || '',
      localPort: link.local_port,
      remotePort: link.remote_port,
      status: up ? 'up' : 'down'
    });
  }

  const nodes = devices.map((d) => ({
    id: d.ip,
    label: d.hostname || d.ip,
    ip: d.ip,
    role: d.role,
    deviceType: deviceTypeOf(d),
    roleLabel: roleLabel[d.role] ?? d.role,
    status: d.status,
    cpu: d.cpu,
    memory: d.memory,
    model: d.model,
    location: d.location,
    size: { core: 52, aggregation: 42, border: 40, access: 32, server: 30 }[d.role] ?? 32
  }));

  return { nodes, edges, updatedAt: new Date().toISOString() };
}

export function getAlerts(activeOnly = false) {
  const sql = activeOnly ? 'SELECT * FROM alerts WHERE active=1 ORDER BY created_at DESC' : 'SELECT * FROM alerts ORDER BY active DESC, created_at DESC';
  return db.prepare(sql).all().map((row) => ({ ...row, deviceName: db.prepare('SELECT hostname FROM devices WHERE id=?').get(row.device_id)?.hostname ?? row.device_ip }));
}

export function getConfigs(deviceId) {
  return db.prepare('SELECT * FROM configs WHERE device_id=? ORDER BY captured_at DESC').all(deviceId);
}

export function getConfigContent(id) {
  return db.prepare('SELECT * FROM configs WHERE id=?').get(id) ?? null;
}

export function getMetrics(deviceId, limit = 120) {
  return db.prepare('SELECT cpu, memory, in_traffic, out_traffic, ts FROM metrics WHERE device_id=? ORDER BY ts DESC LIMIT ?').all(deviceId, limit).reverse();
}
