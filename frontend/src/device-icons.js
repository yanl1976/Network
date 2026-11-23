import ciscoRouter from './assets/icons/cisco-router.svg?raw';
import ciscoSwitchL3 from './assets/icons/cisco-switch-l3.svg?raw';
import ciscoSwitchL2 from './assets/icons/cisco-switch-l2.svg?raw';
import ciscoAsa from './assets/icons/cisco-asa.svg?raw';
import serverSvg from './assets/icons/generic-server-1.svg?raw';

export const TYPE_COLORS = {
  switchCore: '#7c5cff',
  switchAgg: '#2f8fff',
  switchAccess: '#21c2b8',
  firewall: '#ff6b6b',
  router: '#ff9f43',
  server: '#8d9db6'
};

export function typeColor(node) {
  const kind = node.deviceType || node.type || (node.role === 'server' ? 'server' : 'switch');
  if (kind === 'firewall' || kind === 'router' || kind === 'server') return TYPE_COLORS[kind];
  if (node.role === 'core') return TYPE_COLORS.switchCore;
  if (node.role === 'aggregation') return TYPE_COLORS.switchAgg;
  return TYPE_COLORS.switchAccess;
}

function toUri(svg) {
  let text = svg.replace(/<\?xml[^>]*\?>/, '').trim();
  text = text.replace(/\bwidth="[^"]*"/, 'width="64"').replace(/\bheight="[^"]*"/, 'height="64"');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
}

export function deviceIconUri(node) {
  const kind = node.deviceType || node.type || 'switch';
  if (kind === 'firewall') return toUri(ciscoAsa);
  if (kind === 'router') return toUri(ciscoRouter);
  if (kind === 'server') return toUri(serverSvg);
  if (node.role === 'core' || node.role === 'aggregation') return toUri(ciscoSwitchL3);
  return toUri(ciscoSwitchL2);
}
