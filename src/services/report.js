import { db } from '../db.js';

// 巡检报告：按时间窗口聚合设备可用率、告警、流量 TOP、端口利用率
export function buildReport(days = 1) {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const devices = db.prepare('SELECT id, ip, hostname, model, role, status, cpu, memory FROM devices ORDER BY ip').all();
  const online = devices.filter((d) => d.status === 'online' || d.status === 'warning' || d.status === 'critical').length;

  const alertRows = db.prepare('SELECT severity, type, device_id, device_ip, message, created_at, active FROM alerts WHERE created_at>=?').all(since);
  const alertByType = {};
  const alertByDevice = {};
  for (const a of alertRows) {
    alertByType[a.type] = (alertByType[a.type] || 0) + 1;
    const name = devices.find((d) => d.id === a.device_id)?.hostname || a.device_ip;
    alertByDevice[name] = (alertByDevice[name] || 0) + 1;
  }

  const metrics = db.prepare('SELECT device_id, in_traffic, out_traffic, cpu, memory, ts FROM metrics WHERE ts>=?').all(since);
  const trafficByDevice = {};
  const cpuByDevice = {};
  for (const m of metrics) {
    const name = devices.find((d) => d.id === m.device_id)?.hostname || String(m.device_id);
    trafficByDevice[name] = trafficByDevice[name] || { in: 0, out: 0, count: 0 };
    trafficByDevice[name].in += Number(m.in_traffic || 0);
    trafficByDevice[name].out += Number(m.out_traffic || 0);
    trafficByDevice[name].count++;
    cpuByDevice[name] = cpuByDevice[name] || { sum: 0, max: 0, count: 0 };
    cpuByDevice[name].sum += Number(m.cpu || 0);
    cpuByDevice[name].max = Math.max(cpuByDevice[name].max, Number(m.cpu || 0));
    cpuByDevice[name].count++;
  }
  const topTraffic = Object.entries(trafficByDevice).map(([name, v]) => ({
    name, inAvg: v.count ? +(v.in / v.count).toFixed(2) : 0, outAvg: v.count ? +(v.out / v.count).toFixed(2) : 0, samples: v.count
  })).sort((a, b) => (b.inAvg + b.outAvg) - (a.inAvg + a.outAvg)).slice(0, 10);
  const topCpu = Object.entries(cpuByDevice).map(([name, v]) => ({
    name, avg: v.count ? Math.round(v.sum / v.count) : 0, max: v.max, samples: v.count
  })).sort((a, b) => b.avg - a.avg).slice(0, 10);

  const portUtil = db.prepare(`SELECT i.if_name, i.in_util, i.out_util, d.hostname, d.ip
    FROM interfaces i JOIN devices d ON d.id=i.device_id
    WHERE i.ever_up=1 AND i.oper_status=1
    ORDER BY MAX(i.in_util, i.out_util) DESC LIMIT 10`).all();

  const activeAlerts = db.prepare('SELECT COUNT(*) AS n FROM alerts WHERE active=1').get()?.n ?? 0;
  const configStats = db.prepare('SELECT COUNT(*) AS n FROM configs').get()?.n ?? 0;
  const complianceChecks = db.prepare('SELECT COUNT(*) AS n FROM configs WHERE device_id IN (SELECT id FROM devices)').get()?.n ?? 0;

  return {
    generatedAt: new Date().toISOString(),
    period: { days, from: since, to: new Date().toISOString() },
    summary: {
      totalDevices: devices.length,
      online,
      offline: devices.length - online,
      availability: devices.length ? +((online / devices.length) * 100).toFixed(1) : 0,
      activeAlerts,
      alertsInPeriod: alertRows.length,
      criticalAlerts: alertRows.filter((a) => a.severity === 'critical').length,
      configSnapshots: configStats,
      devicesWithConfig: complianceChecks
    },
    alertByType: Object.entries(alertByType).sort((a, b) => b[1] - a[1]).map(([type, count]) => ({ type, count })),
    alertByDevice: Object.entries(alertByDevice).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })).slice(0, 10),
    topTraffic,
    topCpu,
    topPortUtil: portUtil.map((p) => ({ ...p, peak: Math.max(Number(p.in_util || 0), Number(p.out_util || 0)) })),
    devices: devices.map((d) => ({ ip: d.ip, name: d.hostname, model: d.model, role: d.role, status: d.status, cpu: d.cpu, memory: d.memory }))
  };
}
