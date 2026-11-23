import express from 'express';
import { loadConfig, updateSettings, publicConfig, getManagedDevices, addDevice, updateDevice, removeDevice } from '../config.js';
import { db, listLayouts, getActiveLayout, saveLayout, deleteLayout, activateLayout } from '../db.js';
import { pollOnce, scanOnce, backupConfigs } from '../collectors/engine.js';
import { seedDemo } from '../collectors/demo.js';
import { captureDataset, restoreDataset, saveModeSnapshot, loadModeSnapshot } from '../mode-snapshot.js';
import { getOverview, getDevices, getDeviceDetail, getTopology, getAlerts, getConfigs, getConfigContent, getMetrics } from '../services/view.js';

const ok = (res, data) => res.json({ code: 0, data });
const fail = (res, message, status = 500) => res.status(status).json({ code: 1, message });

export function createApi(configHolder, broadcast, onSettingsChanged = () => {}) {
  const router = express.Router();

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
  router.get('/topology', (_req, res) => ok(res, getTopology()));
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
    db.prepare('UPDATE alerts SET active=0, resolved_at=? WHERE id=?').run(new Date().toISOString(), Number(req.params.id));
    broadcast({ type: 'alert:resolved', id: Number(req.params.id) });
    return ok(res, { resolved: true });
  });
  router.post('/alerts/resolve-all', (_req, res) => {
    db.prepare('UPDATE alerts SET active=0, resolved_at=? WHERE active=1').run(new Date().toISOString());
    broadcast({ type: 'alert:resolvedAll' });
    return ok(res, { resolved: true });
  });

  router.get('/configs/:deviceId', (req, res) => ok(res, getConfigs(Number(req.params.deviceId))));
  router.get('/configs/content/:id', (req, res) => {
    const data = getConfigContent(Number(req.params.id));
    return data ? ok(res, data) : fail(res, '配置记录不存在', 404);
  });
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
      saveModeSnapshot(previous, captureDataset());
      configHolder.current = updateSettings({ mode: target });
      const snapshot = loadModeSnapshot(target);
      if (snapshot) {
        restoreDataset(snapshot);
      } else if (target === 'demo') {
        seedDemo(configHolder.current);
      } else {
        restoreDataset(null);
        await pollOnce(configHolder.current);
      }
      onSettingsChanged();
      broadcast({ type: 'mode:changed', mode: target });
      return ok(res, { mode: target, restored: Boolean(snapshot) });
    } catch (error) { return fail(res, error.message); }
  });
  router.post('/reseed', (_req, res) => {
    try {
      configHolder.current = loadConfig();
      seedDemo(configHolder.current);
      saveModeSnapshot('demo', captureDataset());
      broadcast({ type: 'data:reset' });
      return ok(res, { reseeded: true });
    } catch (error) { return fail(res, error.message); }
  });

  return router;
}
