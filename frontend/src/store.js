import { reactive } from 'vue';
import { api } from './api.js';

export const store = reactive({
  overview: null,
  event: null,
  seq: 0,
  polling: false,
  connected: false,
  branding: {
    screenTitle: 'H3C 网络设备动态拓扑监控中心',
    screenSubtitle: 'NETWORK TOPOLOGY & MONITORING CENTER',
    sidebarTitle: '网络拓扑监控',
    sidebarSubtitle: 'H3C NETWORK MONITOR',
    pageTitle: ''
  }
});

export function pushEvent(message) {
  store.event = message;
  store.seq += 1;
}

export async function refreshOverview() {
  try {
    store.overview = await api.overview();
  } catch { /* ignore */ }
}

export function applyPageTitle() {
  document.title = store.branding.pageTitle || store.branding.sidebarTitle || '网络拓扑监控';
}

export async function refreshBranding() {
  try {
    const settings = await api.settings();
    if (settings?.branding) Object.assign(store.branding, settings.branding);
    applyPageTitle();
  } catch { /* ignore */ }
}
