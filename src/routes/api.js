import express from 'express';
import { loadConfig, updateSettings } from '../config.js';
import { db } from '../db.js';
import { pollOnce, scanOnce, backupConfigs, initialize } from '../collectors/engine.js';
import { seedDemo } from '../collectors/demo.js';
import { getOverview, getDevices, getDeviceDetail, getTopology, getAlerts, getConfigs, getConfigContent, getMetrics } from '../services/view.js';

const ok = (res, data) => res.json({ code: 0, data });
const fail = (res, message, status = 500) => res.status(status).json({ code: 1, message });

export function createApi(configHolder, broadcast) {
  const router = express.Router();

  router.get('/overview', (_req, res) => ok(res, getOverview(configHolder.current)));
  router.get('/devices', (_req, res) => ok(res, getDevices()));
  router.get('/devices/:id', (req, res) => {
    const data = getDeviceDetail(Number(req.params.id));
    return data ? ok(res, data) : fail(res, '设备不存在', 404);
  });
  router.get('/topology', (_req, res) => ok(res, getTopology()));
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
  router.get('/metrics/:deviceId', (req, res) => ok(res, getMetrics(Number(req.params.deviceId), Number(req.query.limit ?? 120))));

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

  router.get('/settings', (_req, res) => ok(res, configHolder.current));
  router.put('/settings', (req, res) => {
    try {
      configHolder.current = updateSettings(req.body ?? {});
      return ok(res, configHolder.current);
    } catch (error) { return fail(res, error.message); }
  });
  router.post('/mode', (req, res) => {
    const mode = req.body?.mode === 'live' ? 'live' : 'demo';
    configHolder.current = updateSettings({ mode });
    if (mode === 'demo') seedDemo(configHolder.current);
    broadcast({ type: 'mode:changed', mode });
    return ok(res, { mode });
  });
  router.post('/reseed', (_req, res) => {
    configHolder.current = loadConfig();
    seedDemo(configHolder.current);
    broadcast({ type: 'data:reset' });
    return ok(res, { reseeded: true });
  });

  return router;
}
