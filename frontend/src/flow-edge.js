import G6 from '@antv/g6';

let registered = false;

// 拓扑与全屏共用的流动虚线边：对边自身虚线做 lineDashOffset 循环滚动
export function registerFlowEdge() {
  if (registered) return;
  G6.registerEdge('h3c-flow-edge', {
    afterDraw(cfg, group) {
      if (cfg.status === 'down') return;
      const shape = this.getKeyShape?.() || group.get('children')[0];
      if (!shape) return;
      let step = 0;
      shape.animate(() => {
        step = (step + 1) % 16;
        return { lineDashOffset: -step };
      }, { repeat: true, duration: 1400 });
    }
  }, 'line');
  registered = true;
}

export const FLOW_EDGE_STYLE = (status) => ({
  stroke: status === 'down' ? '#ff4d5e' : '#3a7fd5',
  lineWidth: status === 'down' ? 2.2 : 1.5,
  lineDash: status === 'down' ? [6, 4] : [5, 5],
  opacity: status === 'down' ? 0.95 : 0.75
});
