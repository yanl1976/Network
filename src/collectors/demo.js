import { db, clearAllData, upsertDevice, replaceInterfaces, replaceLinks, addMetric, raiseAlert, resolveAlert } from '../db.js';

const OFFLINE_IP = '192.168.20.15';
const LINKS = [
  ['192.168.10.1', '192.168.10.2', '10G'],
  ['192.168.10.1', '192.168.10.11', '10G'],
  ['192.168.10.1', '192.168.10.12', '10G'],
  ['192.168.10.1', '192.168.10.13', '10G'],
  ['192.168.10.2', '192.168.10.11', '10G'],
  ['192.168.10.2', '192.168.10.12', '10G'],
  ['192.168.10.2', '192.168.10.13', '10G'],
  ['192.168.10.11', '192.168.20.11', '1G'],
  ['192.168.10.11', '192.168.20.12', '1G'],
  ['192.168.10.11', '192.168.20.13', '1G'],
  ['192.168.10.12', '192.168.20.14', '1G'],
  ['192.168.10.12', '192.168.20.15', '1G'],
  ['192.168.10.12', '192.168.20.16', '1G'],
  ['192.168.10.13', '192.168.20.17', '1G'],
  ['192.168.10.13', '192.168.20.18', '1G'],
  ['192.168.10.11', '192.168.10.254', '1G'],
  ['192.168.10.254', '192.168.10.253', '1G'],
  ['192.168.10.1', '192.168.30.11', '1G'],
  ['192.168.10.1', '192.168.30.12', '1G'],
  ['192.168.10.2', '192.168.30.13', '1G'],
  ['192.168.10.2', '192.168.30.14', '1G']
];

function portName(role, i) {
  if (role === 'core' || role === 'aggregation') return `XGE1/0/${i}`;
  return `GE1/0/${i}`;
}

function portCount(role) {
  return { core: 24, aggregation: 24, access: 28, border: 8, server: 2 }[role] ?? 24;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function seedDemo(config) {
  clearAllData();
  const idMap = new Map();
  const ts = new Date();

  for (const device of config.devices) {
    const offline = device.ip === OFFLINE_IP;
    const baseCpu = device.ip === '192.168.10.1' ? 82 : offline ? 0 : rand(18, 52);
    const baseMem = device.ip === '192.168.10.12' ? 78 : offline ? 0 : rand(30, 62);
    const id = upsertDevice({
      ip: device.ip,
      hostname: device.name,
      sysDescr: `H3C Comware Software, Version 7.1.070, ${device.model}`,
      model: device.model,
      serial: `H3C${device.ip.split('.').pop().padStart(4, '0')}X`,
      role: device.role,
      deviceType: device.type ?? 'switch',
      location: device.location,
      status: offline ? 'offline' : 'online',
      cpu: Math.round(baseCpu),
      memory: Math.round(baseMem),
      uptime: offline ? '-' : `${Math.floor(rand(30, 200))}天${Math.floor(rand(0, 23))}小时`,
      last_seen: offline ? new Date(Date.now() - 1000 * 60 * 42).toISOString() : new Date().toISOString()
    });
    idMap.set(device.ip, id);

    const interfaces = Array.from({ length: portCount(device.role) }, (_, i) => {
      const up = !offline && i < portCount(device.role) - (device.role === 'access' ? 3 : 1);
      const speed = device.role === 'core' || device.role === 'aggregation' ? 10000000000 : 1000000000;
      const inUtil = up ? rand(2, device.role === 'core' ? 68 : 45) : 0;
      const outUtil = up ? rand(1, device.role === 'core' ? 55 : 38) : 0;
      return {
        ifIndex: i + 1,
        name: portName(device.role, i + 1),
        descr: `${portName(device.role, i + 1)} Interface`,
        speed,
        operStatus: up ? 1 : 2,
        inOctets: Math.round(inUtil * speed / 800 * 3600),
        outOctets: Math.round(outUtil * speed / 800 * 3600),
        inUtil,
        outUtil
      };
    });
    replaceInterfaces(id, interfaces);

    for (let h = 24; h >= 0; h--) {
      const point = new Date(ts.getTime() - h * 3600_000);
      point.setMinutes(0, 0, 0);
      const wave = Math.sin((24 - h) / 3) * 8;
      addMetric(id, offline ? 0 : clamp(baseCpu + wave + rand(-5, 5), 1, 99), offline ? 0 : clamp(baseMem + wave * 0.4 + rand(-3, 3), 5, 99), rand(20, 180), rand(15, 140));
      db.prepare('UPDATE metrics SET ts=? WHERE id=last_insert_rowid()').run(point.toISOString());
    }
  }

  for (const [local, remote, bandwidth] of LINKS) {
    const localId = idMap.get(local);
    const remoteId = idMap.get(remote);
    if (!localId || !remoteId) continue;
    replaceLinks(localId, [{
      localPort: portName(config.devices.find((d) => d.ip === local)?.role, 1),
      remoteIp: remote,
      remoteDeviceId: remoteId,
      remotePort: portName(config.devices.find((d) => d.ip === remote)?.role, 1),
      remoteChassis: remote,
      bandwidth
    }]);
  }

  raiseAlert({ deviceId: idMap.get(OFFLINE_IP), deviceIp: OFFLINE_IP, severity: 'critical', type: 'offline', message: '设备失联，SNMP 连续 3 次轮询无响应', value: '离线' });
  raiseAlert({ deviceId: idMap.get('192.168.10.1'), deviceIp: '192.168.10.1', severity: 'warning', type: 'cpu_high', message: 'CPU 利用率超过告警阈值', value: '82%' });
  raiseAlert({ deviceId: idMap.get('192.168.10.12'), deviceIp: '192.168.10.12', severity: 'warning', type: 'memory_high', message: '内存利用率超过告警阈值', value: '78%' });
  raiseAlert({ deviceId: idMap.get('192.168.20.13'), deviceIp: '192.168.20.13', severity: 'warning', type: 'port_down', message: 'GE1/0/26 端口链路中断', value: 'DOWN' });
}

export function tickDemo(config) {
  const thresholds = config.poll.thresholds;
  const devices = db.prepare('SELECT * FROM devices').all();
  const changes = [];

  for (const device of devices) {
    const offline = device.ip === OFFLINE_IP;
    if (offline) {
      resolveAlert('cpu_high', device.id);
      resolveAlert('memory_high', device.id);
      raiseAlert({ deviceId: device.id, deviceIp: device.ip, severity: 'critical', type: 'offline', message: '设备失联，SNMP 连续 3 次轮询无响应', value: '离线' });
      changes.push({ ip: device.ip, status: 'offline' });
      continue;
    }

    const cpu = Math.round(clamp((device.cpu || 30) + rand(-8, 8), 5, 98));
    const memory = Math.round(clamp((device.memory || 45) + rand(-3, 3), 10, 95));
    const status = cpu >= thresholds.cpuCritical ? 'critical' : cpu >= thresholds.cpuWarn || memory >= thresholds.memWarn ? 'warning' : 'online';

    db.prepare('UPDATE devices SET cpu=?, memory=?, status=?, last_seen=?, updated_at=? WHERE id=?')
      .run(cpu, memory, status, new Date().toISOString(), new Date().toISOString(), device.id);
    addMetric(device.id, cpu, memory, rand(20, 180), rand(15, 140));
    changes.push({ ip: device.ip, cpu, memory, status });

    if (cpu >= thresholds.cpuWarn) raiseAlert({ deviceId: device.id, deviceIp: device.ip, severity: cpu >= thresholds.cpuCritical ? 'critical' : 'warning', type: 'cpu_high', message: 'CPU 利用率超过告警阈值', value: `${cpu}%` });
    else resolveAlert('cpu_high', device.id);
    if (memory >= thresholds.memWarn) raiseAlert({ deviceId: device.id, deviceIp: device.ip, severity: memory >= thresholds.memCritical ? 'critical' : 'warning', type: 'memory_high', message: '内存利用率超过告警阈值', value: `${memory}%` });
    else resolveAlert('memory_high', device.id);
  }

  db.prepare(`DELETE FROM metrics WHERE id NOT IN (SELECT id FROM metrics ORDER BY ts DESC LIMIT ?)`).run(config.poll.historyLimit);
  return changes;
}
