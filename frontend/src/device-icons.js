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

function kindOf(node) {
  return node.deviceType || node.type || 'switch';
}

const stroke = '#eaf4ff';
const led = '#37e0a3';

function switchSvg(color) {
  const ports = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 8; col++) {
      ports.push(`<rect x="${11 + col * 5.4}" y="${31 + row * 7}" width="4" height="4.4" rx="0.8" fill="${stroke}" opacity="0.92"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <rect x="5" y="19" width="54" height="28" rx="3.5" fill="${color}" fill-opacity="0.28" stroke="${color}" stroke-width="2.6"/>
    <rect x="5" y="19" width="54" height="6" rx="3.5" fill="${color}" fill-opacity="0.55"/>
    ${ports.join('')}
    <circle cx="54.5" cy="22.2" r="1.7" fill="${led}"/>
    <circle cx="49" cy="22.2" r="1.2" fill="${stroke}" opacity="0.7"/>
  </svg>`;
}

function routerSvg(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <circle cx="32" cy="32" r="23" fill="${color}" fill-opacity="0.28" stroke="${color}" stroke-width="2.6"/>
    <circle cx="32" cy="32" r="17.5" fill="none" stroke="${stroke}" stroke-width="1" opacity="0.28"/>
    <path d="M18 46 L46 18 M18 18 L46 46" stroke="${stroke}" stroke-width="3.4" stroke-linecap="round"/>
    <path d="M37 18 H46 V27 M37 46 H46 V37 M27 18 H18 V27 M27 46 H18 V37" fill="none" stroke="${stroke}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function firewallSvg(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <rect x="7" y="16" width="50" height="32" rx="3.5" fill="${color}" fill-opacity="0.28" stroke="${color}" stroke-width="2.6"/>
    <path d="M7 26.7 H57 M7 37.3 H57 M23.7 16 V26.7 M40.3 26.7 V37.3 M23.7 37.3 V48" fill="none" stroke="${stroke}" stroke-width="2.1" opacity="0.88"/>
    <rect x="10.5" y="19" width="8" height="4" rx="0.8" fill="${stroke}" opacity="0.45"/>
  </svg>`;
}

function serverSvg(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <rect x="16" y="7" width="32" height="50" rx="3.5" fill="${color}" fill-opacity="0.28" stroke="${color}" stroke-width="2.6"/>
    <path d="M16 20.7 H48 M16 33.3 H48 M16 46 H48" fill="none" stroke="${stroke}" stroke-width="2" opacity="0.85"/>
    <circle cx="42" cy="13.5" r="1.9" fill="${led}"/>
    <circle cx="42" cy="26.7" r="1.9" fill="${led}"/>
    <circle cx="42" cy="39.3" r="1.9" fill="${led}"/>
    <rect x="20.5" y="10.5" width="13" height="5" rx="1" fill="${stroke}" opacity="0.4"/>
  </svg>`;
}

export function deviceIconUri(node) {
  const color = typeColor(node);
  const kind = kindOf(node);
  const svg = kind === 'firewall' ? firewallSvg(color)
    : kind === 'router' ? routerSvg(color)
      : kind === 'server' ? serverSvg(color)
        : switchSvg(color);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
