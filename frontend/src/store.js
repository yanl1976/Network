import { reactive } from 'vue';
import { api } from './api.js';

export const store = reactive({
  overview: null,
  event: null,
  seq: 0,
  polling: false,
  connected: false
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
