import switchL3 from './assets/icons/switch-l3.png?url';
import switchL2 from './assets/icons/switch-l2.png?url';
import router from './assets/icons/router.png?url';
import firewall from './assets/icons/firewall.png?url';
import server from './assets/icons/server.png?url';

export const TYPE_COLORS = {
  switchCore: '#29b6f6',
  switchAgg: '#29b6f6',
  switchAccess: '#29b6f6',
  firewall: '#29b6f6',
  router: '#29b6f6',
  server: '#29b6f6'
};

export function typeColor() {
  return '#29b6f6';
}

export function deviceIconUri(node) {
  const kind = node.deviceType || node.type || 'switch';
  if (kind === 'firewall') return firewall;
  if (kind === 'router') return router;
  if (kind === 'server') return server;
  if (node.role === 'core' || node.role === 'aggregation') return switchL3;
  return switchL2;
}
