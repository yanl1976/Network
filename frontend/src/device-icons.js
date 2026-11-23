import switchL3 from './assets/icons/switch-l3.png?url';
import switchL2 from './assets/icons/switch-l2.png?url';
import router from './assets/icons/router.png?url';
import firewall from './assets/icons/firewall.png?url';
import server from './assets/icons/server.png?url';

export const TYPE_COLORS = {
  switchCore: '#29b6f6',
  switchAgg: '#42a5f5',
  switchAccess: '#1e88e5',
  firewall: '#26c6da',
  router: '#5c6bc0',
  server: '#4dd0e1'
};

export function typeColor(node) {
  if (!node) return TYPE_COLORS.switchAccess;
  const kind = node.deviceType || node.type;
  if (kind === 'firewall') return TYPE_COLORS.firewall;
  if (kind === 'router' || node.role === 'border') return TYPE_COLORS.router;
  if (kind === 'server' || node.role === 'server') return TYPE_COLORS.server;
  if (node.role === 'core') return TYPE_COLORS.switchCore;
  if (node.role === 'aggregation') return TYPE_COLORS.switchAgg;
  return TYPE_COLORS.switchAccess;
}

export function deviceIconUri(node) {
  const kind = node.deviceType || node.type || 'switch';
  if (kind === 'firewall') return firewall;
  if (kind === 'router') return router;
  if (kind === 'server') return server;
  if (node.role === 'core' || node.role === 'aggregation') return switchL3;
  return switchL2;
}
