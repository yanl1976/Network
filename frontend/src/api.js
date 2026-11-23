async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const payload = await res.json().catch(() => ({ code: 1, message: '响应解析失败' }));
  if (payload.code !== 0) throw new Error(payload.message || '请求失败');
  return payload.data;
}

export const api = {
  overview: () => request('/overview'),
  devices: () => request('/devices'),
  device: (id) => request(`/devices/${id}`),
  topology: () => request('/topology'),
  layouts: () => request('/layouts'),
  activeLayout: () => request('/layouts/active'),
  saveLayout: (name, positions) => request('/layouts', { method: 'POST', body: JSON.stringify({ name, positions }) }),
  activateLayout: (id) => request(`/layouts/${id}/activate`, { method: 'POST' }),
  deleteLayout: (id) => request(`/layouts/${id}`, { method: 'DELETE' }),
  alerts: (activeOnly = false) => request(`/alerts${activeOnly ? '?active=1' : ''}`),
  resolveAlert: (id) => request(`/alerts/${id}/resolve`, { method: 'POST' }),
  resolveAllAlerts: () => request('/alerts/resolve-all', { method: 'POST' }),
  configs: (deviceId) => request(`/configs/${deviceId}`),
  configContent: (id) => request(`/configs/content/${id}`),
  metrics: (deviceId, limit = 120) => request(`/metrics/${deviceId}?limit=${limit}`),
  poll: () => request('/poll', { method: 'POST' }),
  scan: () => request('/scan', { method: 'POST' }),
  backup: (ips = []) => request('/backup', { method: 'POST', body: JSON.stringify({ ips }) }),
  settings: () => request('/settings'),
  saveSettings: (data) => request('/settings', { method: 'PUT', body: JSON.stringify(data) }),
  setMode: (mode) => request('/mode', { method: 'POST', body: JSON.stringify({ mode }) }),
  reseed: () => request('/reseed', { method: 'POST' }),
  managedDevices: () => request('/managed-devices'),
  addDevice: (data) => request('/managed-devices', { method: 'POST', body: JSON.stringify(data) }),
  updateDevice: (ip, data) => request(`/managed-devices/${encodeURIComponent(ip)}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDevice: (ip) => request(`/managed-devices/${encodeURIComponent(ip)}`, { method: 'DELETE' })
};

export function watchEvents(onMessage) {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${protocol}://${location.host}/ws`);
  ws.onmessage = (event) => {
    try { onMessage(JSON.parse(event.data)); } catch { /* ignore */ }
  };
  return ws;
}
