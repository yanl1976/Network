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

export const TYPE_LABELS = {
  switch: '交换机',
  firewall: '防火墙',
  router: '路由器',
  server: '服务器'
};

function p(group, name, path, stroke, lineWidth) {
  group.addShape('path', { attrs: { path, stroke, lineWidth, fill: 'transparent', lineCap: 'round', lineJoin: 'round' }, name });
}

function line(group, name, x1, y1, x2, y2, stroke, lineWidth) {
  group.addShape('line', { attrs: { x1, y1, x2, y2, stroke, lineWidth, lineCap: 'round' }, name });
}

export function drawDeviceIcon(group, node, size, offline) {
  const kind = node.deviceType || node.type || 'switch';
  const s = size / 34;
  const stroke = offline ? 'rgba(205,216,235,.62)' : 'rgba(255,255,255,.96)';
  const soft = offline ? 'rgba(205,216,235,.36)' : 'rgba(255,255,255,.64)';
  const lw = Math.max(1.2, 1.45 * s);

  if (kind === 'switch') {
    const w = size * 0.68;
    const h = size * 0.36;
    group.addShape('rect', { attrs: { x: -w / 2, y: -h / 2, width: w, height: h, radius: 2 * s, stroke, lineWidth: lw, fill: 'transparent' }, name: 'icon-chassis' });
    const ports = 5;
    for (let i = 0; i < ports; i++) {
      const px = -w / 2 + (i + 1) * w / (ports + 1);
      group.addShape('rect', { attrs: { x: px - 1.05 * s, y: -h * 0.28, width: 2.1 * s, height: h * 0.33, fill: soft, radius: 0.6 * s }, name: `icon-port-${i}` });
    }
    line(group, 'icon-rail', -w / 2 + 2 * s, h * 0.24, w / 2 - 2 * s, h * 0.24, soft, lw * 0.8);
    group.addShape('circle', { attrs: { x: w / 2 - 3.4 * s, y: h * 0.24, r: 1.05 * s, fill: offline ? soft : '#20c997' }, name: 'icon-led' });
    return;
  }

  if (kind === 'router') {
    const r = size * 0.3;
    group.addShape('circle', { attrs: { x: 0, y: 0, r, stroke, lineWidth: lw, fill: 'transparent' }, name: 'icon-ring' });
    const a = r * 0.58;
    const t = r * 0.26;
    p(group, 'icon-arrow-ne', [
      ['M', -a, a], ['L', a, -a],
      ['M', a - t, -a], ['L', a, -a], ['L', a, -a + t]
    ], stroke, lw);
    p(group, 'icon-arrow-sw', [
      ['M', -a, -a], ['L', a, a],
      ['M', a - t, a], ['L', a, a], ['L', a, a - t]
    ], soft, lw);
    return;
  }

  if (kind === 'firewall') {
    const w = size * 0.64;
    const h = size * 0.46;
    group.addShape('rect', { attrs: { x: -w / 2, y: -h / 2, width: w, height: h, radius: 2 * s, stroke, lineWidth: lw, fill: 'transparent' }, name: 'icon-frame' });
    p(group, 'icon-brick-lines', [
      ['M', -w / 2, -h / 6], ['L', w / 2, -h / 6],
      ['M', -w / 2, h / 6], ['L', w / 2, h / 6]
    ], soft, lw * 0.8);
    line(group, 'brick-a', -w / 6, -h / 2, -w / 6, -h / 6, soft, lw * 0.8);
    line(group, 'brick-b', w / 6, -h / 6, w / 6, h / 6, soft, lw * 0.8);
    line(group, 'brick-c', -w / 6, h / 6, -w / 6, h / 2, soft, lw * 0.8);
    return;
  }

  const w = size * 0.46;
  const h = size * 0.62;
  group.addShape('rect', { attrs: { x: -w / 2, y: -h / 2, width: w, height: h, radius: 2 * s, stroke, lineWidth: lw, fill: 'transparent' }, name: 'icon-rack' });
  for (let i = 0; i < 3; i++) {
    const y = -h / 2 + h * (i + 1) / 4;
    line(group, `icon-shelf-${i}`, -w / 2 + 2 * s, y, w / 2 - 2 * s, y, soft, lw * 0.85);
    group.addShape('circle', { attrs: { x: w / 2 - 4 * s, y: y - h * 0.11, r: 0.95 * s, fill: offline ? soft : '#20c997' }, name: `icon-led-${i}` });
  }
}
