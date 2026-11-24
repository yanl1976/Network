import { db } from '../db.js';

// H3C Comware 合规规则集。type=require 期望存在；type=forbid 期望不存在
export const COMPLIANCE_RULES = [
  { key: 'snmp_agent', name: 'SNMP Agent 已启用', category: '监控', type: 'require', pattern: /^\s*snmp-agent\s*$/mi, severity: 'warning', suggestion: 'system-view 下执行 snmp-agent' },
  { key: 'snmp_community', name: 'SNMP 只读团体字已配置', category: '监控', type: 'require', pattern: /^\s*snmp-agent\s+community\s+read\s+\S+/mi, severity: 'warning', suggestion: '配置 snmp-agent community read <团体字>' },
  { key: 'lldp', name: 'LLDP 全局已启用', category: '拓扑', type: 'require', pattern: /^\s*lldp\s+global\s+enable/mi, severity: 'warning', suggestion: '执行 lldp global enable（拓扑依赖 LLDP）' },
  { key: 'ntp', name: 'NTP 时间同步已配置', category: '运维', type: 'require', pattern: /^\s*ntp-service\s+(unicast-server|sync)/mi, severity: 'info', suggestion: '配置 ntp-service unicast-server <NTP服务器>' },
  { key: 'loghost', name: '远程日志已配置', category: '运维', type: 'require', pattern: /^\s*info-center\s+loghost/mi, severity: 'info', suggestion: '配置 info-center loghost <日志服务器>' },
  { key: 'default_route', name: '默认路由已配置', category: '网络', type: 'require', pattern: /^\s*ip\s+route-static\s+0\.0\.0\.0\s+0\s+/mi, severity: 'warning', suggestion: '配置 ip route-static 0.0.0.0 0 <网关>' },
  { key: 'telnet', name: 'Telnet 服务已禁用', category: '安全', type: 'forbid', pattern: /^\s*telnet\s+server\s+enable/mi, severity: 'critical', suggestion: '执行 undo telnet server enable，改用 SSH' },
  { key: 'http', name: 'HTTP 服务已禁用', category: '安全', type: 'forbid', pattern: /^\s*ip\s+http\s+enable/mi, severity: 'warning', suggestion: '执行 undo ip http enable，或启用 HTTPS' }
];

export function runCompliance(deviceId = null) {
  const devices = deviceId
    ? db.prepare('SELECT id, ip, hostname FROM devices WHERE id=?').all(deviceId)
    : db.prepare('SELECT id, ip, hostname FROM devices ORDER BY ip').all();
  const reports = [];
  for (const device of devices) {
    const cfg = db.prepare('SELECT content, captured_at, hash FROM configs WHERE device_id=? ORDER BY captured_at DESC LIMIT 1').get(device.id);
    if (!cfg) {
      reports.push({ deviceId: device.id, ip: device.ip, name: device.hostname, hasConfig: false, capturedAt: null, checks: [], passed: 0, failed: 0, skipped: true });
      continue;
    }
    const content = String(cfg.content ?? '');
    const checks = COMPLIANCE_RULES.map((rule) => {
      const matched = rule.pattern.test(content);
      const pass = rule.type === 'require' ? matched : !matched;
      return { key: rule.key, name: rule.name, category: rule.category, type: rule.type, severity: rule.severity, pass, suggestion: rule.suggestion };
    });
    reports.push({
      deviceId: device.id, ip: device.ip, name: device.hostname,
      hasConfig: true, capturedAt: cfg.captured_at, hash: cfg.hash,
      checks, passed: checks.filter((c) => c.pass).length, failed: checks.filter((c) => !c.pass).length,
      skipped: false
    });
  }
  const applicable = reports.filter((r) => r.hasConfig);
  const failedChecks = applicable.flatMap((r) => r.checks.filter((c) => !c.pass).map((c) => ({ ...c, deviceIp: r.ip, deviceName: r.name })));
  return {
    generatedAt: new Date().toISOString(),
    rules: COMPLIANCE_RULES.map(({ key, name, category, type, severity, suggestion }) => ({ key, name, category, type, severity, suggestion })),
    reports,
    summary: {
      totalDevices: reports.length,
      checkedDevices: applicable.length,
      noConfig: reports.length - applicable.length,
      totalRules: applicable.length * COMPLIANCE_RULES.length,
      passed: applicable.reduce((s, r) => s + r.passed, 0),
      failed: failedChecks.length,
      critical: failedChecks.filter((c) => c.severity === 'critical').length,
      byCategory: Object.fromEntries(['监控', '拓扑', '运维', '网络', '安全'].map((cat) => [cat, {
        failed: failedChecks.filter((c) => c.category === cat).length
      }]))
    },
    failedChecks
  };
}
