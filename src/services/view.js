import { db } from '../db.js';

const roleLabel = { core: '核心交换机', aggregation: '汇聚交换机', access: '接入交换机', border: '边界设备', server: '服务器' };

// 物理端口白名单：GE/XGE/TGE/25GE/40GE/100GE/FE/Ethernet 等；
// Vlanif / LoopBack / NULL / Bridge-Aggregation / Eth-Trunk / Tunnel / 管理口等一律视为逻辑口
const PHYSICAL_PORT_RE = /^(?:(?:100GE|25GE|40GE|XGE|TGE|GE|FE|CE|GigabitEthernet|Ten-GigabitEthernet|TwentyfiveGigE|FortyGigE|HundredGigE|FastEthernet|Ethernet|Eth)\s*\d)/i;

export function isPhysicalPort(name) {
  const n = String(name ?? '').trim();
  if (!n || /\.\d+$/.test(n)) return false;
  return PHYSICAL_PORT_RE.test(n);
}

function portKey(name) {
  return String(name ?? '').match(/(\d+(?:\/\d+)+)/)?.[1] || '';
}

// 端口名结构化解析：兼容三段式(GE1/0/1)与四段式(GigabitEthernet1/0/0/1)
// 四段: 成员/机框/槽/口；三段: 成员/槽/口(机框=0)；两段: 成员/口
const PORT_KINDS = [
  { re: /^(?:HundredGigE|100GE)$/i, kind: '100GE', label: '100G口' },
  { re: /^(?:FortyGigE|40GE)$/i, kind: '40GE', label: '40G口' },
  { re: /^(?:TwentyfiveGigE|25GE)$/i, kind: '25GE', label: '25G口' },
  { re: /^(?:Ten-GigabitEthernet|XGE|TGE)$/i, kind: '10GE', label: '万兆口' },
  { re: /^(?:GigabitEthernet|GE)$/i, kind: 'GE', label: '千兆口' },
  { re: /^(?:FastEthernet|FE)$/i, kind: 'FE', label: '百兆口' },
  { re: /^(?:Ethernet|Eth|CE)$/i, kind: 'ETH', label: '以太网口' }
];
const PORT_NAME_RE = /^(100GE|25GE|40GE|XGE|TGE|GE|FE|CE|GigabitEthernet|Ten-GigabitEthernet|TwentyfiveGigE|FortyGigE|HundredGigE|FastEthernet|Ethernet|Eth)\s*((?:\d+\/)*\d+)/i;

function parsePortName(name) {
  const m = String(name ?? '').trim().match(PORT_NAME_RE);
  if (!m) return null;
  const nums = m[2].split('/').map(Number);
  let unit, chassis, slot, port;
  if (nums.length >= 4) [unit, chassis, slot, port] = nums;
  else if (nums.length === 3) { [unit, slot, port] = nums; chassis = 0; }
  else if (nums.length === 2) { [unit, port] = nums; chassis = 0; slot = 0; }
  else { unit = nums[0]; chassis = 0; slot = 0; port = 0; }
  const kind = PORT_KINDS.find((k) => k.re.test(m[1])) || PORT_KINDS[PORT_KINDS.length - 1];
  return { unit, chassis, slot, port, kind: kind.kind, kindLabel: kind.label, segments: nums.length };
}

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
  const nameRows = db.prepare('SELECT device_id, if_name FROM interfaces').all();
  const physicalCount = new Map();
  for (const r of nameRows) {
    if (!isPhysicalPort(r.if_name)) continue;
    physicalCount.set(r.device_id, (physicalCount.get(r.device_id) || 0) + 1);
  }
  return rows.all().map((row) => ({
    ...row,
    interface_count: physicalCount.get(row.id) || 0,
    deviceType: deviceTypeOf(row),
    roleLabel: roleLabel[row.role] ?? row.role
  }));
}

export function getDeviceDetail(id) {
  const device = db.prepare('SELECT * FROM devices WHERE id=?').get(id);
  if (!device) return null;
  const allInterfaces = db.prepare('SELECT * FROM interfaces WHERE device_id=? ORDER BY if_index').all(id);
  const interfaces = allInterfaces.filter((i) => isPhysicalPort(i.if_name));
  const metrics = db.prepare('SELECT cpu, memory, in_traffic, out_traffic, ts FROM metrics WHERE device_id=? ORDER BY ts DESC LIMIT 60').all(id).reverse();
  const alerts = db.prepare('SELECT * FROM alerts WHERE device_id=? ORDER BY created_at DESC LIMIT 20').all(id);
  const configs = db.prepare('SELECT id, hash, captured_at, LENGTH(content) AS bytes FROM configs WHERE device_id=? ORDER BY captured_at DESC LIMIT 20').all(id);
  const linkRows = db.prepare(`SELECT l.*, peer.ip AS peer_ip, peer.hostname AS peer_hostname, peer.role AS peer_role, peer.status AS peer_status
    FROM links l LEFT JOIN devices peer ON peer.id=l.remote_device_id
    WHERE l.local_device_id=? OR l.remote_device_id=? ORDER BY l.updated_at DESC`).all(id, id);
  const links = linkRows.map((l) => {
    const isLocal = l.local_device_id === id;
    const peerIp = isLocal ? (l.remote_ip || l.peer_ip) : db.prepare('SELECT ip FROM devices WHERE id=?').get(l.local_device_id)?.ip ?? null;
    const peer = peerIp ? db.prepare('SELECT hostname, role, model, status FROM devices WHERE ip=?').get(peerIp) : null;
    const localPort = isLocal ? l.local_port : l.remote_port;
    const remotePort = isLocal ? l.remote_port : l.local_port;
    const known = !!peer;
    const up = known && device.status !== 'offline' && peer.status !== 'offline';
    return {
      id: l.id,
      peerIp: peerIp || l.remote_chassis || '',
      peerName: peer?.hostname || l.peer_hostname || '',
      peerRole: peer?.role || l.peer_role || '',
      peerModel: peer?.model || '',
      localPort: localPort || '',
      remotePort: remotePort || '',
      direction: isLocal ? 'out' : 'in',
      known,
      status: known ? (up ? 'up' : 'down') : 'unknown',
      bandwidth: l.bandwidth || '',
      updatedAt: l.updated_at
    };
  });
  const uplinkKeys = new Set(links.filter((l) => l.direction === 'out').map((l) => portKey(l.localPort)).filter(Boolean));
  const physicalInterfaces = interfaces.map((i) => {
    const p = parsePortName(i.if_name) || { unit: 0, chassis: 0, slot: 0, port: 0, kind: 'ETH', kindLabel: '以太网口', segments: 0 };
    return { ...i, ...p, uplink: uplinkKeys.has(portKey(i.if_name)) };
  });
  const unitMap = new Map();
  const groupMap = new Map();
  for (const i of physicalInterfaces) {
    if (!unitMap.has(i.unit)) unitMap.set(i.unit, { unit: i.unit, total: 0, up: 0, down: 0 });
    const us = unitMap.get(i.unit);
    us.total++;
    if (i.oper_status === 1) us.up++; else us.down++;
    const key = `${i.unit}/${i.chassis}/${i.kind}`;
    if (!groupMap.has(key)) groupMap.set(key, {
      key, unit: i.unit, chassis: i.chassis, kind: i.kind, kindLabel: i.kindLabel,
      total: 0, up: 0, down: 0
    });
    const gs = groupMap.get(key);
    gs.total++;
    if (i.oper_status === 1) gs.up++; else gs.down++;
  }
  const portUnits = [...unitMap.values()].sort((a, b) => a.unit - b.unit);
  const portGroups = [...groupMap.values()].sort((a, b) =>
    a.unit - b.unit || a.chassis - b.chassis || a.kind.localeCompare(b.kind));
  const portStats = {
    total: interfaces.length,
    up: interfaces.filter((i) => i.oper_status === 1).length,
    down: interfaces.filter((i) => i.oper_status !== 1).length,
    hidden: allInterfaces.length - interfaces.length,
    units: portUnits.length,
    chassis: new Set(physicalInterfaces.map((i) => i.chassis)).size,
    stackMode: physicalInterfaces.some((i) => i.segments >= 4) && portUnits.length > 1
  };
  return {
    ...device, deviceType: deviceTypeOf(device), roleLabel: roleLabel[device.role] ?? device.role,
    interfaces: physicalInterfaces, portStats, portUnits, portGroups, metrics, alerts, configs, links
  };
}

const ROLE_RANK = { core: 5, aggregation: 4, border: 3, access: 2, server: 1 };

export function getPathFromDevice(ip) {
  const devices = db.prepare('SELECT id, ip, hostname, role, status FROM devices').all();
  const byId = new Map(devices.map((d) => [d.id, d]));
  const byIp = new Map(devices.map((d) => [d.ip, d]));
  const start = byIp.get(ip);
  if (!start) return { path: [], error: '设备不在清单中' };
  const links = db.prepare('SELECT * FROM links').all();
  const adjacency = new Map(devices.map((d) => [d.ip, []]));
  for (const link of links) {
    const local = byId.get(link.local_device_id)?.ip;
    const remote = link.remote_ip || (link.remote_device_id ? byId.get(link.remote_device_id)?.ip : null);
    if (!local || !remote || local === remote || !adjacency.has(remote)) continue;
    adjacency.get(local).push({ next: remote, localPort: link.local_port || '', remotePort: link.remote_port || '', bandwidth: link.bandwidth || '' });
  }
  const rank = (d) => ROLE_RANK[d?.role] ?? 0;
  const path = [{ ip: start.ip, name: start.hostname || start.ip, role: start.role, rank: rank(start) }];
  const visited = new Set([start.ip]);
  let current = start;
  while (rank(current) < ROLE_RANK.core) {
    const options = (adjacency.get(current.ip) || [])
      .filter((edge) => !visited.has(edge.next) && rank(byIp.get(edge.next)) > rank(current))
      .sort((a, b) => rank(byIp.get(b.next)) - rank(byIp.get(a.next)));
    if (!options.length) break;
    const edge = options[0];
    const peer = byIp.get(edge.next);
    path[path.length - 1].uplinkPort = edge.localPort;
    path.push({ ip: peer.ip, name: peer.hostname || peer.ip, role: peer.role, rank: rank(peer), downlinkPort: edge.remotePort, bandwidth: edge.bandwidth });
    visited.add(peer.ip);
    current = peer;
  }
  return { path };
}

// 影响范围分析：以指定设备为故障点，沿链路图反推上游依赖与下游受影响设备
export function getImpactAnalysis(ip) {
  const devices = db.prepare('SELECT id, ip, hostname, role, status, device_type FROM devices').all();
  const byId = new Map(devices.map((d) => [d.id, d]));
  const byIp = new Map(devices.map((d) => [d.ip, d]));
  const target = byIp.get(ip);
  if (!target) return { error: '设备不在清单中' };
  const links = db.prepare('SELECT * FROM links').all();
  const adj = new Map(devices.map((d) => [d.ip, []]));
  for (const l of links) {
    const local = byId.get(l.local_device_id)?.ip;
    const remote = l.remote_ip || (l.remote_device_id ? byId.get(l.remote_device_id)?.ip : null);
    if (!local || !remote || local === remote || !adj.has(remote)) continue;
    adj.get(local).push({ next: remote, localPort: l.local_port || '', remotePort: l.remote_port || '' });
    adj.get(remote).push({ next: local, localPort: l.remote_port || '', remotePort: l.local_port || '' });
  }
  const rank = (d) => ROLE_RANK[d?.role] ?? 0;
  const node = (d, via) => ({ ip: d.ip, name: d.hostname || d.ip, role: d.role, rank: rank(d), status: d.status, viaPort: via || '' });

  // 上游：角色比目标高或直接相连的核心/汇聚，BFS 找所有可达的更高角色设备
  const upstream = [];
  const upVisited = new Set([target.ip]);
  const upQueue = [target.ip];
  while (upQueue.length) {
    const cur = upQueue.shift();
    for (const e of adj.get(cur) || []) {
      if (upVisited.has(e.next)) continue;
      const peer = byIp.get(e.next);
      if (rank(peer) > rank(byIp.get(cur)) || rank(peer) >= ROLE_RANK.aggregation) {
        upVisited.add(e.next);
        upstream.push(node(peer, e.localPort));
        upQueue.push(e.next);
      }
    }
  }

  // 下游：从目标出发 BFS，经更低或相同角色设备（终端/接入/汇聚），跳过上游方向
  const downstream = [];
  const downVisited = new Set([target.ip]);
  const downQueue = [{ ip: target.ip, hops: 0 }];
  while (downQueue.length) {
    const { ip: cur, hops } = downQueue.shift();
    if (hops >= 4) continue;
    for (const e of adj.get(cur) || []) {
      if (downVisited.has(e.next)) continue;
      const peer = byIp.get(e.next);
      if (rank(peer) <= rank(byIp.get(cur))) {
        downVisited.add(e.next);
        downstream.push({ ...node(peer, e.localPort), hops: hops + 1 });
        downQueue.push({ ip: e.next, hops: hops + 1 });
      }
    }
  }

  const direct = (adj.get(target.ip) || []).map((e) => ({ ...node(byIp.get(e.next), e.localPort), remotePort: e.remotePort }));
  return {
    target: node(target),
    directNeighbors: direct,
    upstream: upstream.sort((a, b) => b.rank - a.rank),
    downstream: downstream.sort((a, b) => a.hops - b.hops || b.rank - a.rank),
    impactCount: downstream.length,
    summary: `${target.hostname || ip} 故障将影响 ${downstream.length} 台下游设备，涉及 ${upstream.length} 台上游设备`
  };
}

export function getTopology(config) {
  const utilWarn = Number(config?.poll?.thresholds?.portUtilWarn ?? 80);
  const devices = db.prepare('SELECT id, ip, hostname, role, device_type, status, cpu, memory, model, location FROM devices').all();
  const deviceByIp = new Map(devices.map((d) => [d.ip, d]));
  const deviceById = new Map(devices.map((d) => [d.id, d]));

  // 端口利用率索引：按 (device_id, 端口数字段) 归一，兼容 GE1/0/1 与 GigabitEthernet1/0/1 两种命名
  const portUtil = new Map();
  for (const row of db.prepare('SELECT device_id, if_name, if_descr, in_util, out_util, oper_status FROM interfaces').all()) {
    const port = portKey(row.if_name) || portKey(row.if_descr);
    if (!port) continue;
    const k = `${row.device_id}|${port}`;
    const cur = { inUtil: Number(row.in_util) || 0, outUtil: Number(row.out_util) || 0, operStatus: row.oper_status };
    cur.utilization = Math.max(cur.inUtil, cur.outUtil);
    const prev = portUtil.get(k);
    if (!prev || cur.utilization > prev.utilization) portUtil.set(k, cur);
  }
  const linkPortUtil = (deviceId, portName) => {
    if (!deviceId || !portName) return null;
    return portUtil.get(`${deviceId}|${portKey(portName)}`) ?? null;
  };

  const links = db.prepare('SELECT * FROM links').all();
  const seen = new Set();
  const edges = [];

  for (const link of links) {
    const localDev = link.local_device_id ? deviceById.get(link.local_device_id) : null;
    const localIp = localDev?.ip ?? null;
    const remoteDev = link.remote_device_id ? deviceById.get(link.remote_device_id) : null;
    const remoteIp = link.remote_ip || remoteDev?.ip || null;
    if (!localIp || !remoteIp || localIp === remoteIp) continue;
    const key = [localIp, remoteIp].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const localPortInfo = linkPortUtil(localDev?.id, link.local_port);
    const remotePortInfo = linkPortUtil(remoteDev?.id, link.remote_port);
    const portInfos = [localPortInfo, remotePortInfo].filter(Boolean);
    const utilization = portInfos.length ? Math.max(...portInfos.map((p) => p.utilization)) : 0;
    const inUtil = portInfos.length ? Math.max(...portInfos.map((p) => p.inUtil)) : 0;
    const outUtil = portInfos.length ? Math.max(...portInfos.map((p) => p.outUtil)) : 0;
    const portDown = portInfos.some((p) => p.operStatus === 2);
    const up = localDev?.status !== 'offline' && remoteDev?.status !== 'offline' && !portDown;
    const trafficLevel = !up ? 'down' : utilization >= utilWarn ? 'congested' : utilization >= utilWarn * 0.6 ? 'warning' : 'normal';
    edges.push({
      id: `e-${key}`,
      source: localIp,
      target: remoteIp,
      label: link.bandwidth || '',
      bandwidth: link.bandwidth || '',
      localPort: link.local_port,
      remotePort: link.remote_port,
      utilization: Number(utilization.toFixed(1)),
      inUtil: Number(inUtil.toFixed(1)),
      outUtil: Number(outUtil.toFixed(1)),
      trafficLevel,
      trafficLabel: `入${inUtil.toFixed(0)}% / 出${outUtil.toFixed(0)}%`,
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

  return { nodes, edges, thresholds: { portUtilWarn: utilWarn }, updatedAt: new Date().toISOString() };
}

export function getAlerts(activeOnly = false) {
  const sql = activeOnly ? 'SELECT * FROM alerts WHERE active=1 ORDER BY created_at DESC' : 'SELECT * FROM alerts ORDER BY active DESC, created_at DESC';
  return db.prepare(sql).all().map((row) => {
    const name = db.prepare('SELECT hostname FROM devices WHERE id=?').get(row.device_id)?.hostname ?? row.device_ip;
    return { ...row, deviceName: name, device_name: name };
  });
}

export function getConfigs(deviceId) {
  return db.prepare('SELECT * FROM configs WHERE device_id=? ORDER BY captured_at DESC').all(deviceId);
}

export function getConfigContent(id) {
  return db.prepare('SELECT * FROM configs WHERE id=?').get(id) ?? null;
}

// 配置行级 diff（LCS），返回带标记的行序列：context / added / removed
export function diffConfigs(oldId, newId) {
  const oldRow = db.prepare('SELECT * FROM configs WHERE id=?').get(oldId);
  const newRow = db.prepare('SELECT * FROM configs WHERE id=?').get(newId);
  if (!oldRow || !newRow) return null;
  const a = String(oldRow.content ?? '').split(/\r?\n/);
  const b = String(newRow.content ?? '').split(/\r?\n/);
  const n = a.length, m = b.length;
  // 大文件保护：超过 800 行时用简化前缀对比，避免 O(n*m) 卡死
  if (n * m > 640000) {
    const lines = [];
    const max = Math.max(n, m);
    for (let i = 0; i < max; i++) {
      if (a[i] === b[i]) lines.push({ type: 'context', text: a[i] });
      else {
        if (a[i] !== undefined) lines.push({ type: 'removed', text: a[i] });
        if (b[i] !== undefined) lines.push({ type: 'added', text: b[i] });
      }
    }
    return { old: { id: oldRow.id, capturedAt: oldRow.captured_at, hash: oldRow.hash }, new: { id: newRow.id, capturedAt: newRow.captured_at, hash: newRow.hash }, lines, added: lines.filter(l => l.type === 'added').length, removed: lines.filter(l => l.type === 'removed').length, simplified: true };
  }
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const lines = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { lines.push({ type: 'context', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { lines.push({ type: 'removed', text: a[i] }); i++; }
    else { lines.push({ type: 'added', text: b[j] }); j++; }
  }
  while (i < n) { lines.push({ type: 'removed', text: a[i++] }); }
  while (j < m) { lines.push({ type: 'added', text: b[j++] }); }
  return { old: { id: oldRow.id, capturedAt: oldRow.captured_at, hash: oldRow.hash }, new: { id: newRow.id, capturedAt: newRow.captured_at, hash: newRow.hash }, lines, added: lines.filter(l => l.type === 'added').length, removed: lines.filter(l => l.type === 'removed').length, simplified: false };
}

export function getMetrics(deviceId, limit = 120) {
  return db.prepare('SELECT cpu, memory, in_traffic, out_traffic, ts FROM metrics WHERE device_id=? ORDER BY ts DESC LIMIT ?').all(deviceId, limit).reverse();
}
