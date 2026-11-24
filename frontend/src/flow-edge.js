import G6 from '@antv/g6';

let registered = false;

const TRAFFIC_STYLE = {
  normal: { color: '#3a7fd5', width: 1.5, opacity: 0.75, duration: 1400 },
  warning: { color: '#ffb020', width: 2.4, opacity: 0.9, duration: 1000 },
  congested: { color: '#ff4d5e', width: 3.4, opacity: 0.95, duration: 650 }
};

// 拓扑与全屏共用的流动虚线边：对边自身虚线做 lineDashOffset 循环滚动
// 流量等级通过 color/lineWidth 与滚动速度体现：正常蓝细 → 警告黄中 → 拥塞红粗
export function registerFlowEdge() {
  if (registered) return;
  G6.registerEdge('h3c-flow-edge', {
    afterDraw(cfg, group) {
      if (cfg.status === 'down') return;
      const shape = this.getKeyShape?.() || group.get('children')[0];
      if (!shape) return;
      let step = 0;
      const level = TRAFFIC_STYLE[cfg.trafficLevel] ? cfg.trafficLevel : 'normal';
      shape.animate(() => {
        step = (step + 1) % 16;
        return { lineDashOffset: -step };
      }, { repeat: true, duration: TRAFFIC_STYLE[level].duration });
    }
  }, 'line');
  registered = true;
}

export const FLOW_EDGE_STYLE = (status, trafficLevel = 'normal') => {
  if (status === 'down') return { stroke: '#ff4d5e', lineWidth: 2.2, lineDash: [6, 4], opacity: 0.95 };
  const t = TRAFFIC_STYLE[trafficLevel] || TRAFFIC_STYLE.normal;
  return { stroke: t.color, lineWidth: t.width, lineDash: [5, 5], opacity: t.opacity };
};
