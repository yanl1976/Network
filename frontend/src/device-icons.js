import switchL3 from './assets/icons/generic-switch-l3-colour.svg?raw';
import switchL2 from './assets/icons/generic-switch-l2-v1-colour.svg?raw';
import router from './assets/icons/generic-router-square-colour.svg?raw';
import firewall from './assets/icons/generic-firewall-v1-colour.svg?raw';
import server from './assets/icons/generic-server-2.svg?raw';

export const TYPE_COLORS = {
  switchCore: '#2f8fff',
  switchAgg: '#2f8fff',
  switchAccess: '#2f8fff',
  firewall: '#d3453a',
  router: '#2f8fff',
  server: '#8d9db6'
};

export function typeColor(node) {
  const kind = node.deviceType || node.type || (node.role === 'server' ? 'server' : 'switch');
  if (kind === 'firewall') return TYPE_COLORS.firewall;
  if (kind === 'server') return TYPE_COLORS.server;
  return TYPE_COLORS.switchCore;
}

function toUri(svg) {
  let text = svg.replace(/<\?xml[^>]*\?>/, '').trim();
  text = text.replace(/\bwidth="[^"]*"/, 'width="64"').replace(/\bheight="[^"]*"/, 'height="64"');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
}

export function deviceIconUri(node) {
  const kind = node.deviceType || node.type || 'switch';
  if (kind === 'firewall') return toUri(firewall);
  if (kind === 'router') return toUri(router);
  if (kind === 'server') return toUri(server);
  if (node.role === 'core' || node.role === 'aggregation') return toUri(switchL3);
  return toUri(switchL2);
}
