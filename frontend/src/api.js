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
  ackAlert: (id, assignee) => request(`/alerts/${id}/ack`, { method: 'POST', body: JSON.stringify({ assignee }) }),
  addAlertNote: (id, author, text) => request(`/alerts/${id}/note`, { method: 'POST', body: JSON.stringify({ author, text }) }),
  configs: (deviceId) => request(`/configs/${deviceId}`),
  configContent: (id) => request(`/configs/content/${id}`),
  configDiff: (oldId, newId) => request(`/configs/diff?oldId=${oldId}&newId=${newId}`),
  compliance: () => request('/compliance'),
  metrics: (deviceId, limit = 120) => request(`/metrics/${deviceId}?limit=${limit}`),
  poll: () => request('/poll', { method: 'POST' }),
  scan: () => request('/scan', { method: 'POST' }),
  macLookup: (mac) => request(`/mac-lookup?mac=${encodeURIComponent(mac)}`),
  macEntries: ({ mac = '', ip = '', limit = 500 } = {}) => request(`/mac-entries?mac=${encodeURIComponent(mac)}&ip=${encodeURIComponent(ip)}&limit=${limit}`),
  macCollect: () => request('/mac-collect', { method: 'POST' }),
  portCheck: (ip, ports = [22, 80, 161, 443]) => request('/tools/port-check', { method: 'POST', body: JSON.stringify({ ip, ports }) }),
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
