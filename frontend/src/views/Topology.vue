<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import G6 from '@antv/g6';
import * as echarts from 'echarts';
import { Refresh, RefreshRight, ZoomIn, ZoomOut, FullScreen, Search } from '@element-plus/icons-vue';
import { api } from '../api.js';
import { store } from '../store.js';
import { drawDeviceIcon, typeColor, TYPE_COLORS } from '../device-icons.js';

const legendItems = [
  { label: '核心交换机', color: TYPE_COLORS.switchCore },
  { label: '汇聚交换机', color: TYPE_COLORS.switchAgg },
  { label: '接入交换机', color: TYPE_COLORS.switchAccess },
  { label: '防火墙', color: TYPE_COLORS.firewall },
  { label: '路由器', color: TYPE_COLORS.router },
  { label: '服务器', color: TYPE_COLORS.server }
];
const roleLabels = { core: '核心交换机', aggregation: '汇聚交换机', access: '接入交换机', border: '边界设备', server: '服务器' };
const statusLabels = { online: '在线', warning: '告警', critical: '严重', offline: '离线' };

const containerRef = ref(null);
const chartRef = ref(null);
const graph = ref(null);
const topology = ref({ nodes: [], edges: [] });
const devices = ref([]);
const selectedIp = ref(null);
const detail = ref(null);
const showLabels = ref(true);
const loading = ref(false);
const searchText = ref('');
let chart = null;
let resizeObserver = null;

const stats = computed(() => {
  const nodes = topology.value.nodes;
  return {
    total: nodes.length,
    online: nodes.filter((n) => n.status !== 'offline').length,
    links: topology.value.edges.length,
    alerts: nodes.filter((n) => n.status === 'warning' || n.status === 'critical').length
  };
});

const filteredDevices = computed(() => {
  const q = searchText.value.trim().toLowerCase();
  if (!q) return devices.value;
  return devices.value.filter((d) => [d.hostname, d.ip, d.model, d.location].some((v) => String(v ?? '').toLowerCase().includes(q)));
});

G6.registerNode('h3c-device', {
  draw(cfg, group) {
    const size = cfg.size || 32;
    const keyShape = group.addShape('rect', {
      attrs: {
        x: -size / 2, y: -size / 2, width: size, height: size, radius: 7,
        ...cfg.style
      },
      name: 'device-box',
      draggable: true
    });
    drawDeviceIcon(group, cfg, size, cfg.status === 'offline');
    group.addShape('text', {
      attrs: { text: cfg.label, x: 0, y: size / 2 + 15, fill: '#e6f0ff', fontSize: 11, fontWeight: 500, textAlign: 'center', textBaseline: 'middle' },
      name: 'device-label'
    });
    return keyShape;
  }
}, 'single-node');

function nodeStyle(n) {
  const color = typeColor(n);
  const offline = n.status === 'offline';
  const alertColor = n.status === 'critical' ? '#ff4d5e' : n.status === 'warning' ? '#ffb020' : null;
  return {
    fill: offline ? '#465069' : color,
    fillOpacity: offline ? 0.55 : 0.9,
    stroke: alertColor || (offline ? '#7b879c' : 'rgba(255,255,255,.5)'),
    lineWidth: alertColor ? 3 : 1.2,
    shadowColor: alertColor || (offline ? '#64748b' : color),
    shadowBlur: alertColor ? 24 : offline ? 3 : 18
  };
}

function toG6Data(data) {
  return {
    nodes: data.nodes.map((n) => ({ ...n, type: 'h3c-device', size: n.size, style: nodeStyle(n) })),
    edges: data.edges.map((e) => ({
      ...e,
      type: 'line',
      label: showLabels.value ? e.label : '',
      style: {
        stroke: e.status === 'down' ? '#ff4d5e' : '#3a7fd5',
        lineWidth: e.status === 'down' ? 2.2 : 1.3,
        lineDash: e.status === 'down' ? [6, 4] : [4, 4],
        opacity: e.status === 'down' ? 0.95 : 0.62
      },
      labelCfg: { autoRotate: true, style: { fill: '#7e96bd', fontSize: 9, background: { fill: '#0c1426', padding: [2, 4, 2, 4], radius: 2 } } }
    }))
  };
}

function layoutConfig() {
  return {
    type: 'force',
    preventOverlap: true,
    nodeSize: (d) => d.size + 30,
    linkDistance: (d) => d.bandwidth === '10G' ? 130 : 175,
    nodeStrength: (d) => d.role === 'core' ? -120 : d.role === 'aggregation' ? -240 : -420,
    edgeStrength: 0.55,
    alphaDecay: 0.03,
    collideStrength: 0.9
  };
}

function initGraph() {
  if (!containerRef.value) return;
  graph.value?.destroy();
  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;
  const g = new G6.Graph({
    container: containerRef.value,
    width, height,
    fitView: true,
    fitViewPadding: [46, 46, 46, 46],
    layout: layoutConfig(),
    modes: { default: ['drag-canvas', 'zoom-canvas', 'drag-node'] },
    animate: true,
    animateCfg: { duration: 350, easing: 'easeCubic' }
  });
  g.data(toG6Data(topology.value));
  g.render();
  g.on('node:click', (evt) => {
    const model = evt.item.getModel();
    selectNode(model.ip);
  });
  g.on('canvas:click', () => { selectedIp.value = null; detail.value = null; });
  graph.value = g;
}

async function loadData(resetLayout = false) {
  loading.value = true;
  try {
    const [topo, dev] = await Promise.all([api.topology(), api.devices()]);
    topology.value = topo;
    devices.value = dev;
    if (resetLayout || !graph.value) {
      await nextTick();
      initGraph();
    } else {
      graph.value.changeData(toG6Data(topo));
    }
    if (selectedIp.value) await selectNode(selectedIp.value, true);
  } finally {
    loading.value = false;
  }
}

async function selectNode(ip, keep = false) {
  selectedIp.value = ip;
  const device = devices.value.find((d) => d.ip === ip);
  if (!device) return;
  try {
    detail.value = await api.device(device.id);
    await nextTick();
    renderChart(detail.value.metrics || []);
  } catch { detail.value = null; }
  if (!keep) graph.value?.focusItem(graph.value.findById(ip));
}

function renderChart(metrics) {
  if (!chartRef.value) return;
  if (!chart) chart = echarts.init(chartRef.value, 'dark', { renderer: 'canvas' });
  chart.setOption({
    backgroundColor: 'transparent',
    grid: { left: 34, right: 12, top: 22, bottom: 20 },
    tooltip: { trigger: 'axis', backgroundColor: '#14213a', borderColor: '#1e3355', textStyle: { color: '#dce9ff', fontSize: 11 } },
    xAxis: { type: 'category', data: metrics.map((m) => String(m.ts).slice(11, 16)), axisLabel: { color: '#6d84aa', fontSize: 9, interval: Math.max(0, Math.floor(metrics.length / 4)) }, axisLine: { lineStyle: { color: '#1e3355' } } },
    yAxis: { type: 'value', max: 100, splitLine: { lineStyle: { color: '#182b48', type: 'dashed' } }, axisLabel: { color: '#6d84aa', fontSize: 9 } },
    series: [
      { name: 'CPU%', type: 'line', smooth: true, showSymbol: false, data: metrics.map((m) => m.cpu), lineStyle: { color: '#2f8fff', width: 2 }, areaStyle: { color: 'rgba(47,143,255,.16)' } },
      { name: '内存%', type: 'line', smooth: true, showSymbol: false, data: metrics.map((m) => m.memory), lineStyle: { color: '#a06bff', width: 2 }, areaStyle: { color: 'rgba(160,107,255,.12)' } }
    ]
  }, true);
}

function zoom(ratio) {
  const g = graph.value;
  if (!g) return;
  g.zoom(ratio, { x: g.getWidth() / 2, y: g.getHeight() / 2 });
}
function fit() { graph.value?.fitView(); }
function relayout() { graph.value?.updateLayout(layoutConfig()); graph.value?.fitView(); }
function toggleLabels() { showLabels.value = !showLabels.value; loadData(true); }

async function backupSelected() {
  if (!selectedIp.value) return;
  await api.backup([selectedIp.value]);
  if (detail.value) detail.value.configs = await api.configs(detail.value.id);
}

onMounted(async () => {
  await loadData(true);
  resizeObserver = new ResizeObserver(() => {
    if (!graph.value || !containerRef.value) return;
    graph.value.changeSize(containerRef.value.clientWidth, containerRef.value.clientHeight);
  });
  resizeObserver.observe(containerRef.value);
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  graph.value?.destroy();
  chart?.dispose();
});

watch(() => store.seq, () => {
  const type = store.event?.type;
  if (['poll:done', 'alert:resolved', 'alert:resolvedAll', 'data:reset', 'mode:changed'].includes(type)) loadData(false);
});
</script>

<template>
  <div class="topo-page">
    <div class="stat-grid top-stats">
      <div class="stat-card is-primary"><div class="stat-label">网络设备总数</div><div class="stat-value">{{ stats.total }}<span class="stat-suffix">台</span></div></div>
      <div class="stat-card is-success"><div class="stat-label">在线设备</div><div class="stat-value">{{ stats.online }}<span class="stat-suffix">台</span></div></div>
      <div class="stat-card"><div class="stat-label">拓扑链路</div><div class="stat-value">{{ stats.links }}<span class="stat-suffix">条</span></div></div>
      <div class="stat-card is-danger"><div class="stat-label">异常设备</div><div class="stat-value">{{ stats.alerts }}<span class="stat-suffix">台</span></div></div>
    </div>

    <div class="topo-layout">
      <div class="panel graph-panel">
        <div class="panel-title">
          实时网络拓扑
          <span class="muted" style="font-weight:400;font-size:11px;margin-left:auto">{{ topology.nodes.length }} 节点 / {{ topology.edges.length }} 链路</span>
        </div>
        <div class="toolbar">
          <el-button size="small" :icon="Refresh" :loading="loading" @click="loadData(false)">刷新</el-button>
          <el-button size="small" :icon="RefreshRight" @click="relayout">重排</el-button>
          <el-button size="small" :icon="ZoomIn" @click="zoom(1.2)">放大</el-button>
          <el-button size="small" :icon="ZoomOut" @click="zoom(0.8)">缩小</el-button>
          <el-button size="small" :icon="FullScreen" @click="fit">适应</el-button>
          <el-button size="small" @click="toggleLabels">{{ showLabels ? '隐藏' : '显示' }}标签</el-button>
          <el-input v-model="searchText" size="small" placeholder="搜索设备/IP" :prefix-icon="Search" style="width:170px;margin-left:auto" />
        </div>
        <div class="graph-area">
          <div ref="containerRef" class="graph-canvas" />
          <div class="legend">
            <div class="legend-title">图例</div>
            <div v-for="item in legendItems" :key="item.label" class="legend-item"><span class="legend-dot" :style="{ background: item.color }" />{{ item.label }}</div>
            <div class="legend-sep" />
            <div class="legend-item"><span class="legend-dot status-dot" style="background:#ff4d5e" />告警</div>
            <div class="legend-item"><span class="legend-dot" style="background:#64748b" />离线</div>
            <div class="legend-item"><span class="legend-line" />正常链路</div>
            <div class="legend-item"><span class="legend-line down" />中断链路</div>
          </div>
        </div>
      </div>

      <div class="panel detail-panel">
        <div class="panel-title">设备详情</div>
        <div v-if="!detail" class="empty-detail">
          <el-icon :size="34"><Search /></el-icon>
          <div>点击拓扑节点查看设备详情</div>
          <div class="muted" style="font-size:11px;margin-top:6px">或从下方清单选择设备</div>
        </div>
        <template v-else>
          <div class="detail-head">
            <div class="detail-name">{{ detail.hostname }}</div>
            <div class="detail-ip mono">{{ detail.ip }}</div>
            <div class="detail-tags">
              <el-tag size="small" :color="typeColor(detail)" effect="dark" style="border:0">{{ detail.deviceType ? ({ switch: '交换机', firewall: '防火墙', router: '路由器', server: '服务器' }[detail.deviceType] || detail.roleLabel) : detail.roleLabel }}</el-tag>
              <el-tag size="small" :type="detail.status === 'online' ? 'success' : detail.status === 'offline' ? 'info' : 'danger'" effect="dark">{{ statusLabels[detail.status] || detail.status }}</el-tag>
            </div>
          </div>
          <div class="detail-meta">
            <div><span class="muted">型号</span><span>{{ detail.model }}</span></div>
            <div><span class="muted">位置</span><span>{{ detail.location }}</span></div>
            <div><span class="muted">运行时间</span><span>{{ detail.uptime }}</span></div>
          </div>
          <div class="gauges">
            <div class="gauge">
              <div class="gauge-label">CPU 利用率 <b>{{ detail.cpu }}%</b></div>
              <el-progress :percentage="detail.cpu" :stroke-width="8" :color="detail.cpu >= 90 ? '#ff4d5e' : detail.cpu >= 70 ? '#ffb020' : '#2f8fff'" />
            </div>
            <div class="gauge">
              <div class="gauge-label">内存利用率 <b>{{ detail.memory }}%</b></div>
              <el-progress :percentage="detail.memory" :stroke-width="8" :color="detail.memory >= 90 ? '#ff4d5e' : detail.memory >= 75 ? '#ffb020' : '#a06bff'" />
            </div>
          </div>
          <div class="chart-block">
            <div class="mini-title">性能趋势（近 24 小时）</div>
            <div ref="chartRef" class="chart" />
          </div>
          <div class="detail-section">
            <div class="mini-title">端口状态 <span class="muted">({{ detail.interfaces?.length || 0 }} 口)</span></div>
            <div class="port-grid">
              <div v-for="port in (detail.interfaces || []).slice(0, 12)" :key="port.if_index" class="port-item" :class="{ down: port.oper_status === 2 }">
                <span class="port-name">{{ port.if_name }}</span>
                <span class="port-dot" :class="port.oper_status === 1 ? 'up' : 'down'" />
              </div>
            </div>
          </div>
          <div class="detail-section">
            <div class="mini-title">当前告警 <span class="muted">({{ (detail.alerts || []).filter(a => a.active).length }})</span></div>
            <div v-if="!(detail.alerts || []).some(a => a.active)" class="muted" style="font-size:12px">无活动告警</div>
            <div v-for="alert in (detail.alerts || []).filter(a => a.active)" :key="alert.id" class="detail-alert">
              <span class="status-dot" :class="alert.severity === 'critical' ? 'status-critical' : 'status-warning'" />
              {{ alert.message }} <b>{{ alert.value }}</b>
            </div>
          </div>
          <div class="detail-actions">
            <el-button size="small" type="primary" plain @click="backupSelected">备份配置</el-button>
            <el-button size="small" plain @click="selectedIp = null; detail = null">关闭详情</el-button>
          </div>
        </template>
      </div>
    </div>

    <div class="panel device-strip">
      <div class="panel-title">设备快速定位 <span class="muted" style="font-weight:400;font-size:11px;margin-left:auto">{{ filteredDevices.length }} 台</span></div>
      <div class="device-chips">
        <button v-for="d in filteredDevices" :key="d.ip" class="device-chip" :class="{ active: selectedIp === d.ip, offline: d.status === 'offline' }" @click="selectNode(d.ip)">
          <span class="chip-dot" :style="{ background: d.status === 'offline' ? '#64748b' : typeColor(d) }" />
          {{ d.hostname }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.topo-page { height: 100%; display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; overflow: hidden; }
.top-stats { flex: 0 0 auto; }
.topo-layout { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 12px; }
.graph-panel, .detail-panel, .device-strip { min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.toolbar { display: flex; gap: 6px; align-items: center; padding: 9px 12px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.graph-area { flex: 1; min-height: 0; position: relative; }
.graph-canvas { width: 100%; height: 100%; }
.legend { position: absolute; left: 14px; bottom: 14px; background: rgba(8,14,28,.82); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; font-size: 11px; color: var(--muted); backdrop-filter: blur(6px); }
.legend-title { color: var(--text); font-weight: 600; margin-bottom: 7px; }
.legend-item { display: flex; align-items: center; gap: 7px; margin: 4px 0; }
.legend-dot { width: 9px; height: 9px; border-radius: 3px; display: inline-block; }
.legend-sep { height: 1px; background: var(--border); margin: 7px 0; }
.legend-line { width: 18px; height: 0; border-top: 1px dashed #3a7fd5; display: inline-block; }
.legend-line.down { border-color: #ff4d5e; border-top-width: 2px; }
.empty-detail { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: #55709c; text-align: center; padding: 20px; }
.detail-head { padding: 14px 16px 10px; border-bottom: 1px solid var(--border); }
.detail-name { font-size: 17px; font-weight: 700; }
.detail-ip { color: var(--muted); font-size: 12px; margin-top: 3px; }
.detail-tags { display: flex; gap: 6px; margin-top: 9px; }
.detail-meta { padding: 10px 16px; display: grid; gap: 6px; font-size: 12px; }
.detail-meta > div { display: flex; justify-content: space-between; gap: 10px; }
.gauges { padding: 6px 16px 10px; display: grid; gap: 10px; }
.gauge-label { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); margin-bottom: 4px; }
.gauge-label b { color: var(--text); }
.chart-block { padding: 0 12px 8px; }
.mini-title { font-size: 12px; color: #b9cbe7; font-weight: 600; margin-bottom: 7px; }
.chart { height: 130px; width: 100%; }
.detail-section { padding: 8px 16px; border-top: 1px solid var(--border); }
.port-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
.port-item { display: flex; align-items: center; justify-content: space-between; background: rgba(20,33,58,.7); border: 1px solid var(--border); border-radius: 4px; padding: 3px 6px; font-size: 10px; }
.port-item.down { opacity: .5; }
.port-name { font-family: Consolas, monospace; color: #9fb4d6; }
.port-dot { width: 6px; height: 6px; border-radius: 50%; }
.port-dot.up { background: var(--success); }
.port-dot.down { background: var(--danger); }
.detail-alert { font-size: 11px; color: #ffc4c9; margin: 5px 0; display: flex; align-items: center; }
.detail-actions { padding: 10px 16px; margin-top: auto; border-top: 1px solid var(--border); display: flex; gap: 8px; }
.device-strip { flex: 0 0 132px; }
.device-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 14px; overflow: auto; }
.device-chip { display: flex; align-items: center; gap: 6px; background: rgba(20,33,58,.8); border: 1px solid var(--border); color: #a9bfe0; border-radius: 5px; padding: 5px 10px; font-size: 11px; cursor: pointer; }
.device-chip:hover { border-color: var(--primary); color: #fff; }
.device-chip.active { border-color: var(--primary); background: rgba(47,143,255,.2); color: #fff; }
.device-chip.offline { opacity: .55; }
.chip-dot { width: 7px; height: 7px; border-radius: 2px; }
</style>
