import { db, upsertDevice, replaceInterfaces, replaceLinks, addMetric, raiseAlert, resolveAlert } from '../db.js';
import { collectSnmp } from './snmp.js';
import { scanSubnets, fetchConfig } from './network.js';
import { seedDemo, tickDemo } from './demo.js';
import { getDeviceCredentials } from '../config.js';

export function isSeeded() {
  return (db.prepare('SELECT COUNT(*) AS n FROM devices').get()?.n ?? 0) > 0;
}

function resolveRemoteDevice(neighbor, config) {
  const name = (neighbor.remoteSysName || '').trim().toUpperCase();
  const chassis = (neighbor.remoteChassis || '').trim();
  const mac = chassis.toLowerCase();
  const found = config.devices.find((d) => d.name?.toUpperCase() === name || d.ip === chassis || d.ip === neighbor.remoteIp || (d.mac && d.mac.toLowerCase() === mac));
  return { ip: found?.ip ?? chassis, deviceId: found ? db.prepare('SELECT id FROM devices WHERE ip=?').get(found.ip)?.id ?? null : null, name: found?.name ?? neighbor.remoteSysName ?? '' };
}

function applyThresholds(deviceId, ip, cpu, memory, interfaces, config) {
  const t = config.poll.thresholds;
  if (cpu >= t.cpuWarn) raiseAlert({ deviceId, deviceIp: ip, severity: cpu >= t.cpuCritical ? 'critical' : 'warning', type: 'cpu_high', message: 'CPU 利用率超过告警阈值', value: `${cpu}%` });
  else resolveAlert('cpu_high', deviceId);
  if (memory >= t.memWarn) raiseAlert({ deviceId, deviceIp: ip, severity: memory >= t.memCritical ? 'critical' : 'warning', type: 'memory_high', message: '内存利用率超过告警阈值', value: `${memory}%` });
  else resolveAlert('memory_high', deviceId);
  const down = interfaces.find((i) => i.operStatus === 2);
  if (down) raiseAlert({ deviceId, deviceIp: ip, severity: 'warning', type: 'port_down', message: `${down.name} 端口链路中断`, value: 'DOWN' });
  else resolveAlert('port_down', deviceId);
}

export function initialize(config) {
  if (isSeeded()) return { seeded: false, mode: config.mode };
  if (config.mode === 'demo') {
    seedDemo(config);
    return { seeded: true, mode: 'demo' };
  }
  return pollOnce(config);
}

export async function pollOnce(config) {
  if (config.mode === 'demo') {
    const changes = tickDemo(config);
    return { mode: 'demo', scanned: changes.length, online: changes.filter((c) => c.status !== 'offline').length, offline: changes.filter((c) => c.status === 'offline').length, changes };
  }

  const results = await Promise.allSettled(config.devices.filter((d) => d.enabled !== false).map(async (device) => {
    try {
      const data = await collectSnmp(device, config.snmp);
      const deviceId = upsertDevice({
        ip: device.ip, hostname: data.hostname || device.name, sysDescr: data.sysDescr, model: data.model,
        role: device.role, deviceType: device.type ?? 'switch', location: device.location, status: 'online', cpu: data.cpu, memory: data.memory,
        uptime: data.uptime, last_seen: new Date().toISOString()
      });
      replaceInterfaces(deviceId, data.interfaces);
      const neighbors = data.neighbors.map((n) => {
        const r = resolveRemoteDevice(n, config);
        return { localPort: n.localPort, remoteIp: r.ip, remoteDeviceId: r.deviceId, remotePort: n.remotePort, remoteChassis: r.ip, bandwidth: null };
      });
      replaceLinks(deviceId, neighbors);
      addMetric(deviceId, data.cpu, data.memory);
      applyThresholds(deviceId, device.ip, data.cpu, data.memory, data.interfaces, config);
      resolveAlert('offline', deviceId);
      return { ip: device.ip, ok: true };
    } catch (error) {
      const row = db.prepare('SELECT id FROM devices WHERE ip=?').get(device.ip);
      if (row) {
        db.prepare('UPDATE devices SET status="offline", last_seen=? WHERE id=?').run(new Date().toISOString(), row.id);
        raiseAlert({ deviceId: row.id, deviceIp: device.ip, severity: 'critical', type: 'offline', message: `SNMP 采集失败：${error.message}`, value: '离线' });
      }
      return { ip: device.ip, ok: false, error: error.message };
    }
  }));

  const changes = results.map((r) => r.status === 'fulfilled' ? r.value : { ok: false });
  return {
    mode: 'live', scanned: changes.length,
    online: changes.filter((c) => c.ok).length,
    offline: changes.filter((c) => !c.ok).length,
    changes
  };
}

export async function scanOnce(config) {
  const result = await scanSubnets(config.scan);
  const known = new Set(db.prepare('SELECT ip FROM devices').all().map((d) => d.ip));
  const discovered = result.found.filter((item) => !known.has(item.ip));
  return { ...result, discovered, newlyAdded: discovered.length };
}

export async function backupConfigs(config, deviceIps = []) {
  const targets = config.devices.filter((d) => deviceIps.length === 0 || deviceIps.includes(d.ip));
  const results = await Promise.allSettled(targets.map(async (device) => {
    const result = await fetchConfig(device, { ...config.ssh, ...getDeviceCredentials(device.ip, config.ssh) });
    if (!result.ok) return { ip: device.ip, ok: false, error: result.error };
    const row = db.prepare('SELECT id FROM devices WHERE ip=?').get(device.ip);
    if (!row) return { ip: device.ip, ok: false, error: '设备未入库' };
    const crypto = await import('node:crypto');
    const hash = crypto.createHash('md5').update(result.output).digest('hex');
    const prev = db.prepare('SELECT hash FROM configs WHERE device_id=? ORDER BY captured_at DESC LIMIT 1').get(row.id);
    db.prepare('INSERT INTO configs (device_id, ip, content, hash, captured_at) VALUES (?, ?, ?, ?, ?)')
      .run(row.id, device.ip, result.output, hash, new Date().toISOString());
    return { ip: device.ip, ok: true, hash, changed: prev ? prev.hash !== hash : true, bytes: result.output.length };
  }));
  return results.map((r) => r.status === 'fulfilled' ? r.value : { ok: false, error: r.reason?.message });
}
