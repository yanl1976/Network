import express from 'express';
import { loadConfig, updateSettings, publicConfig, getManagedDevices, addDevice, updateDevice, removeDevice } from '../config.js';
import { db, listLayouts, getActiveLayout, saveLayout, deleteLayout, activateLayout, listMacEntries, countMacEntries, acknowledgeAlert, addAlertNote, resolveAlertById } from '../db.js';
import { pollOnce, scanOnce, backupConfigs, lookupMac, collectAllMacTables } from '../collectors/engine.js';
import { checkPorts } from '../collectors/network.js';
import { seedDemo } from '../collectors/demo.js';
import { captureDataset, restoreDataset, saveModeSnapshot, loadModeSnapshot } from '../mode-snapshot.js';
import { getOverview, getDevices, getDeviceDetail, getTopology, getAlerts, getConfigs, getConfigContent, getMetrics, diffConfigs, getImpactAnalysis } from '../services/view.js';
import { runCompliance } from '../services/compliance.js';
import { buildReport } from '../services/report.js';

const ok = (res, data) => res.json({ code: 0, data });
const fail = (res, message, status = 500) => res.status(status).json({ code: 1, message });

export function createApi(configHolder, broadcast, onSettingsChanged = () => {}, writeToken = '') {
  const router = express.Router();

  // 最小写操作鉴权：未配置 NETWORK_API_TOKEN 时保持兼容（内网工具默认开放），
  // 配置后所有非只读请求必须带 X-API-Token，防止写 API 被任意调用。
  router.use((req, res, next) => {
    if (!writeToken || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.headers['x-api-token'] === writeToken) return next();
    return fail(res, '需要有效的写操作令牌（X-API-Token）', 401);
  });
  router.get('/auth-status', (_req, res) => ok(res, { writeAuthRequired: Boolean(writeToken) }));

  router.get('/overview', (_req, res) => ok(res, getOverview(configHolder.current)));
  router.get('/managed-devices', (_req, res) => ok(res, getManagedDevices()));
  router.post('/managed-devices', (req, res) => {
    try {
      const device = addDevice(req.body ?? {});
      configHolder.current = loadConfig();
      broadcast({ type: 'devices:changed' });
      return ok(res, device);
    } catch (error) { return fail(res, error.message); }
  });
  router.put('/managed-devices/:ip', (req, res) => {
    try {
      const device = updateDevice(req.params.ip, req.body ?? {});
      configHolder.current = loadConfig();
      broadcast({ type: 'devices:changed' });
      return ok(res, device);
    } catch (error) { return fail(res, error.message); }
  });
  router.delete('/managed-devices/:ip', (req, res) => {
    try {
      const result = removeDevice(req.params.ip);
      configHolder.current = loadConfig();
      broadcast({ type: 'devices:changed' });
      return ok(res, result);
    } catch (error) { return fail(res, error.message); }
  });
  router.get('/devices', (_req, res) => ok(res, getDevices()));
  router.get('/devices/:id', (req, res) => {
    const data = getDeviceDetail(Number(req.params.id));
    return data ? ok(res, data) : fail(res, '设备不存在', 404);
  });
  router.get('/topology', (_req, res) => ok(res, getTopology(configHolder.current)));
  router.get('/layouts', (_req, res) => ok(res, listLayouts()));
  router.get('/layouts/active', (_req, res) => ok(res, getActiveLayout()));
  router.post('/layouts', (req, res) => {
    try { return ok(res, saveLayout(req.body?.name, req.body?.positions)); }
    catch (error) { return fail(res, error.message); }
  });
  router.post('/layouts/:id/activate', (req, res) => {
    try { return ok(res, activateLayout(Number(req.params.id))); }
    catch (error) { return fail(res, error.message); }
  });
  router.delete('/layouts/:id', (req, res) => ok(res, { deleted: deleteLayout(Number(req.params.id)) }));
  router.get('/alerts', (req, res) => ok(res, getAlerts(req.query.active === '1')));
  router.post('/alerts/:id/resolve', (req, res) => {
    const result = resolveAlertById(Number(req.params.id));
    broadcast({ type: 'alert:resolved', id: Number(req.params.id) });
    return ok(res, result);
  });
  router.post('/alerts/:id/ack', (req, res) => {
    const result = acknowledgeAlert(Number(req.params.id), req.body?.assignee);
    if (!result) return fail(res, '告警不存在', 404);
    broadcast({ type: 'alert:updated', id: Number(req.params.id) });
    return ok(res, result);
  });
  router.post('/alerts/:id/note', (req, res) => {
    const result = addAlertNote(Number(req.params.id), req.body?.author, req.body?.text);
    if (!result) return fail(res, '告警不存在', 404);
    return ok(res, result);
  });
  router.post('/alerts/resolve-all', (_req, res) => {
    db.prepare("UPDATE alerts SET active=0, status='resolved', resolved_at=? WHERE active=1").run(new Date().toISOString());
    broadcast({ type: 'alert:resolvedAll' });
    return ok(res, { resolved: true });
  });

  router.get('/configs/:deviceId', (req, res) => ok(res, getConfigs(Number(req.params.deviceId))));
  router.get('/configs/content/:id', (req, res) => {
    const data = getConfigContent(Number(req.params.id));
    return data ? ok(res, data) : fail(res, '配置记录不存在', 404);
  });
  router.get('/configs/diff', (req, res) => {
    const data = diffConfigs(Number(req.query.oldId), Number(req.query.newId));
    return data ? ok(res, data) : fail(res, '配置记录不存在', 404);
  });
  router.get('/compliance', (req, res) => ok(res, runCompliance(req.query.deviceId ? Number(req.query.deviceId) : null)));
  router.get('/report', (req, res) => ok(res, buildReport(Math.min(90, Math.max(1, Number(req.query.days) || 1)))));
  router.get('/impact', (req, res) => ok(res, getImpactAnalysis(String(req.query.ip ?? ''))));
  router.get('/metrics/:deviceId', (req, res) => {
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 120));
    return ok(res, getMetrics(Number(req.params.deviceId), limit));
  });

  router.post('/poll', async (_req, res) => {
    try {
      const result = await pollOnce(configHolder.current);
      broadcast({ type: 'poll:done', result });
      return ok(res, result);
    } catch (error) { return fail(res, error.message); }
  });
  router.post('/scan', async (_req, res) => {
    try { return ok(res, await scanOnce(configHolder.current)); }
    catch (error) { return fail(res, error.message); }
  });
  router.get('/mac-lookup', async (req, res) => {
    try { return ok(res, await lookupMac(configHolder.current, req.query.mac)); }
    catch (error) { return fail(res, error.message); }
  });
  router.get('/mac-entries', (req, res) => ok(res, {
    rows: listMacEntries({ mac: req.query.mac ?? '', ip: req.query.ip ?? '', limit: Number(req.query.limit) || 500 }),
    stats: countMacEntries()
  }));
  router.post('/mac-collect', async (_req, res) => {
    try { return ok(res, await collectAllMacTables(configHolder.current)); }
    catch (error) { return fail(res, error.message); }
  });
  router.post('/tools/port-check', async (req, res) => {
    const ip = String(req.body?.ip ?? '').trim();
    const ports = (req.body?.ports ?? [22, 80, 161, 443]).map((p) => Number(p)).filter((p) => p > 0 && p < 65536);
    if (!ip) return fail(res, '请输入目标 IP');
    try { return ok(res, await checkPorts(ip, ports)); }
    catch (error) { return fail(res, error.message); }
  });
  router.post('/backup', async (req, res) => {
    try { return ok(res, await backupConfigs(configHolder.current, req.body?.ips ?? [])); }
    catch (error) { return fail(res, error.message); }
  });

  router.get('/settings', (_req, res) => ok(res, publicConfig(configHolder.current)));
  router.put('/settings', (req, res) => {
    try {
      configHolder.current = updateSettings(req.body ?? {});
      onSettingsChanged();
      return ok(res, configHolder.current);
    } catch (error) { return fail(res, error.message); }
  });
  router.post('/mode', async (req, res) => {
    const target = req.body?.mode === 'live' ? 'live' : 'demo';
    const previous = configHolder.current?.mode === 'live' ? 'live' : 'demo';
    if (target === previous) return ok(res, { mode: target });
    try {
      // 先保存当前模式数据快照，再切换；无目标快照时不再清空全库，
      // 仅让下一次轮询按新模式增量写入，避免误触导致真实数据被清。
      saveModeSnapshot(previous, captureDataset());
      configHolder.current = updateSettings({ mode: target });
      const snapshot = loadModeSnapshot(target);
      if (snapshot) {
        restoreDataset(snapshot);
      } else if (target === 'demo') {
        seedDemo(configHolder.current);
      }
      // target==='live' 且无快照：保留现有数据，由下一次 poll 增量采集
      onSettingsChanged();
      broadcast({ type: 'mode:changed', mode: target });
      return ok(res, { mode: target, restored: Boolean(snapshot), cleared: false });
    } catch (error) { return fail(res, error.message); }
  });
  router.post('/reseed', (_req, res) => {
    try {
      const current = loadConfig();
      if (current.mode === 'live') {
        return fail(res, '真实采集模式下不允许重置演示数据，请先切换到演示模式', 403);
      }
      configHolder.current = current;
      seedDemo(configHolder.current);
      saveModeSnapshot('demo', captureDataset());
      broadcast({ type: 'data:reset' });
      return ok(res, { reseeded: true });
    } catch (error) { return fail(res, error.message); }
  });

  return router;
}
