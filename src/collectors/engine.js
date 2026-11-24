import { db, upsertDevice, replaceInterfaces, replaceLinks, addMetric, raiseAlert, resolveAlert, replaceMacEntries, listMacEntries, getPortAlertCandidates } from '../db.js';
import { collectSnmp, normalizeMac, lookupMacOnDevice, collectMacTable } from './snmp.js';
import { scanSubnets, fetchConfig } from './network.js';
import { seedDemo, tickDemo } from './demo.js';
import { getDeviceCredentials } from '../config.js';
import { getPathFromDevice } from '../services/view.js';

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

  // 端口中断：仅对"曾 UP 过、现在 DOWN"的端口告警（未启用端口 oper_status 恒为 2，不告警）
  const { downPorts, highTraffic } = getPortAlertCandidates(deviceId, t.portUtilWarn ?? 80);
  if (downPorts.length) {
    const shown = downPorts.slice(0, 5).join('、');
    const more = downPorts.length > 5 ? ` 等 ${downPorts.length} 个端口` : '';
    raiseAlert({ deviceId, deviceIp: ip, severity: 'warning', type: 'port_down', message: `${shown}${more} 链路中断（曾 UP 后转 DOWN）`, value: `${downPorts.length} 个端口 DOWN` });
  } else resolveAlert('port_down', deviceId);

  // 流量异常：UP 端口利用率超阈值（入或出任一方向）
  if (highTraffic.length) {
    const shown = highTraffic.slice(0, 5).map((p) => `${p.name} 入${p.inUtil.toFixed(0)}%/出${p.outUtil.toFixed(0)}%`).join('、');
    const more = highTraffic.length > 5 ? ` 等 ${highTraffic.length} 个端口` : '';
    raiseAlert({ deviceId, deviceIp: ip, severity: 'warning', type: 'port_traffic_high', message: `${shown}${more} 流量利用率超阈值`, value: `阈值 ${t.portUtilWarn ?? 80}%` });
  } else resolveAlert('port_traffic_high', deviceId);
}

export function computeInterfaceTraffic(deviceId, interfaces) {
  const prev = db.prepare('SELECT if_index, in_octets, out_octets, updated_at FROM interfaces WHERE device_id=?').all(deviceId);
  if (!prev.length || !interfaces?.length) return { in: 0, out: 0 };
  const t0 = Date.parse(prev[0].updated_at);
  const dt = (Date.now() - t0) / 1000;
  if (!Number.isFinite(dt) || dt <= 0 || dt > 3600) return { in: 0, out: 0 };
  const prevMap = new Map(prev.map((r) => [r.if_index, r]));
  let inBytes = 0;
  let outBytes = 0;
  for (const itf of interfaces) {
    const old = prevMap.get(itf.ifIndex);
    if (!old) continue;
    inBytes += Math.max(0, Number(itf.inOctets ?? 0) - Number(old.in_octets ?? 0));
    outBytes += Math.max(0, Number(itf.outOctets ?? 0) - Number(old.out_octets ?? 0));
  }
  return {
    in: Number(((inBytes * 8) / dt / 1e6).toFixed(2)),
    out: Number(((outBytes * 8) / dt / 1e6).toFixed(2))
  };
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
      const traffic = computeInterfaceTraffic(deviceId, data.interfaces);
      replaceInterfaces(deviceId, data.interfaces);
      const neighbors = data.neighbors.map((n) => {
        const r = resolveRemoteDevice(n, config);
        return { localPort: n.localPort, remoteIp: r.ip, remoteDeviceId: r.deviceId, remotePort: n.remotePort, remoteChassis: r.ip, bandwidth: null };
      });
      replaceLinks(deviceId, neighbors);
      addMetric(deviceId, data.cpu, data.memory, traffic.in, traffic.out);
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

export async function collectAllMacTables(config) {
  const targets = config.devices.filter((d) => d.enabled !== false && d.type !== 'server');
  const results = await Promise.allSettled(targets.map(async (device) => {
    const rows = await collectMacTable(device, config.snmp);
    replaceMacEntries(device.ip, rows.map((r) => ({ ...r, device_id: db.prepare('SELECT id FROM devices WHERE ip=?').get(device.ip)?.id ?? null, device_ip: device.ip, device_name: device.name })));
    return { ip: device.ip, name: device.name, count: rows.length };
  }));
  return results.map((r) => r.status === 'fulfilled' ? r.value : { ip: '-', count: 0, error: r.reason?.message });
}

export async function lookupMac(config, macInput) {
  const raw = String(macInput ?? '').trim();
  const hex = raw.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (!hex || hex.length < 2 || hex.length > 12 || hex.length % 2 !== 0) {
    throw new Error('MAC 地址格式无效，请输入偶数位十六进制（如 46:47 或 46:47:0a:1b:2c:3d）');
  }
  if (hex.length < 12) {
    const rows = listMacEntries({ mac: hex, limit: 200 });
    const matches = rows.map((r) => {
      const pathInfo = getPathFromDevice(r.device_ip);
      return {
        mac: r.mac,
        deviceIp: r.device_ip,
        deviceName: r.device_name,
        port: r.port,
        ifIndex: r.if_index,
        vlan: r.vlan,
        source: r.source,
        found: true,
        ok: true,
        fragment: true,
        path: pathInfo.path || []
      };
    });
    return { mac: raw, mode: 'fragment', matches, checked: rows.length, errors: [] };
  }
  const mac = normalizeMac(raw);
  const targets = config.devices.filter((d) => d.enabled !== false);
  const results = await Promise.allSettled(targets.map(async (device) => {
    try {
      const hit = await lookupMacOnDevice(device, config.snmp, mac);
      return { deviceIp: device.ip, deviceName: device.name, ...hit };
    } catch (error) {
      return { deviceIp: device.ip, deviceName: device.name, found: false, ok: false, error: error.message };
    }
  }));
  const matches = [];
  const errors = [];
  for (const r of results) {
    const value = r.status === 'fulfilled' ? r.value : null;
    if (!value || value.ok === false) errors.push(value || { deviceIp: '-', error: '查询失败' });
    else if (value.found) {
      const pathInfo = getPathFromDevice(value.deviceIp);
      matches.push({ ...value, path: pathInfo.path || [] });
    }
  }
  return { mac, matches, checked: targets.length, errors };
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
