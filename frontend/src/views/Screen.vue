<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import G6 from '@antv/g6';
import * as echarts from 'echarts';
import { api } from '../api.js';
import { store } from '../store.js';
import { deviceIconUri, typeColor, TYPE_COLORS } from '../device-icons.js';
import { registerFlowEdge, FLOW_EDGE_STYLE } from '../flow-edge.js';

registerFlowEdge();

const router = useRouter();
const legendItems = [
  { label: '核心交换机', color: TYPE_COLORS.switchCore },
  { label: '汇聚交换机', color: TYPE_COLORS.switchAgg },
  { label: '接入交换机', color: TYPE_COLORS.switchAccess },
  { label: '防火墙', color: TYPE_COLORS.firewall },
  { label: '路由器', color: TYPE_COLORS.router },
  { label: '服务器', color: TYPE_COLORS.server }
];
const roleToColor = { core: TYPE_COLORS.switchCore, aggregation: TYPE_COLORS.switchAgg, access: TYPE_COLORS.switchAccess, border: TYPE_COLORS.router, server: TYPE_COLORS.server };

const graphRef = ref(null);
const pieRef = ref(null);
const graph = ref(null);
const pieChart = ref(null);
const overview = ref({});
const devices = ref([]);
const alerts = ref([]);
const topology = ref({ nodes: [], edges: [] });
const activeLayout = ref(null);
const now = ref(new Date());
const isFullscreen = ref(false);
let timer = null;
let resizeObserver = null;

const clock = computed(() => now.value.toLocaleString('zh-CN', { hour12: false }));
const rate = computed(() => overview.value.totalDevices ? Math.round(overview.value.online / overview.value.totalDevices * 100) : 0);
const health = computed(() => Math.max(0, 100 - (overview.value.criticalCount || 0) * 12 - (overview.value.warningCount || 0) * 4));
const topCpu = computed(() => [...devices.value].sort((a, b) => (b.cpu || 0) - (a.cpu || 0)).slice(0, 5));
const recentAlerts = computed(() => alerts.value.filter((a) => a.active === 1).slice(0, 12));
const ticker = computed(() => {
  const parts = [
    `设备总数 ${overview.value.totalDevices ?? 0} 台`,
    `在线率 ${rate.value}%`,
    `拓扑链路 ${overview.value.linkCount ?? 0} 条`,
    `活动告警 ${overview.value.alertCount ?? 0} 条`,
    `最近轮询 ${overview.value.lastPoll ? String(overview.value.lastPoll).replace('T', ' ').slice(0, 19) : '-'}`
  ];
  return parts.join('　　◆　　');
});

G6.registerNode('h3c-screen-node', {
  draw(cfg, group) {
    const size = cfg.size || 32;
    const alertColor = cfg.status === 'critical' ? '#ff4d5e' : cfg.status === 'warning' ? '#ffb020' : null;
    if (alertColor) {
      group.addShape('circle', { attrs: { x: 0, y: 0, r: size * 0.76, stroke: alertColor, lineWidth: 2.8, lineDash: [5, 4], shadowColor: alertColor, shadowBlur: 18 }, name: 'ring' });
    }
    const keyShape = group.addShape('rect', {
      attrs: { x: -size / 2, y: -size / 2, width: size, height: size, radius: 8, fill: 'transparent', stroke: 'transparent' },
      name: 'box', draggable: true
    });
    const iconSize = size * 1.24;
    group.addShape('image', {
      attrs: { x: -iconSize / 2, y: -iconSize / 2, width: iconSize, height: iconSize, img: deviceIconUri(cfg) },
      name: 'device-icon', draggable: true
    });
    group.addShape('text', {
      attrs: { text: cfg.label, x: 0, y: size / 2 + 17, fill: '#e8f2ff', fontSize: 12, fontWeight: 600, textAlign: 'center', textBaseline: 'middle', shadowColor: '#000', shadowBlur: 7 },
      name: 'label'
    });
    return keyShape;
  }
}, 'single-node');

function buildGraph() {
  if (!graphRef.value) return;
  graph.value?.destroy();
  const nodeIps = new Set(topology.value.nodes.map((n) => n.ip));
  const pos = activeLayout.value?.positions;
  const preset = pos && typeof pos === 'object' && Object.keys(pos).length ? pos : null;
  const nodes = topology.value.nodes.map((n) => ({
    ...n, type: 'h3c-screen-node', ...(preset?.[n.ip] || {})
  }));
  const edges = topology.value.edges
    .filter((e) => nodeIps.has(e.source) && nodeIps.has(e.target))
    .map((e) => ({
      ...e, type: 'h3c-flow-edge', style: FLOW_EDGE_STYLE(e.status)
    }));
  const g = new G6.Graph({
    container: graphRef.value,
    width: graphRef.value.clientWidth,
    height: graphRef.value.clientHeight,
    fitView: true,
    fitViewPadding: [50, 40, 50, 40],
    layout: preset ? undefined : {
      type: 'force', preventOverlap: true,
      nodeSize: (d) => d.size + 34,
      linkDistance: (d) => d.bandwidth === '10G' ? 125 : 170,
      nodeStrength: (d) => d.role === 'core' ? -110 : d.role === 'aggregation' ? -230 : -430,
      edgeStrength: 0.55, alphaDecay: 0.03, collideStrength: 0.9
    },
    modes: { default: ['drag-canvas', 'zoom-canvas'] },
    animate: true,
    animateCfg: { duration: 350 }
  });
  g.data({ nodes, edges });
  g.render();
  graph.value = g;
}

function buildPie() {
  if (!pieRef.value) return;
  pieChart.value?.dispose();
  pieChart.value = echarts.init(pieRef.value, 'dark');
  pieChart.value.setOption({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'item', backgroundColor: '#14213a', borderColor: '#1e3355', textStyle: { color: '#dce9ff' } },
    legend: { show: false },
    series: [{
      type: 'pie', radius: ['48%', '74%'], center: ['50%', '50%'],
      avoidLabelOverlap: false,
      itemStyle: { borderColor: '#0b1324', borderWidth: 3 },
      label: { show: true, color: '#9fb4d6', fontSize: 10, formatter: '{b}\n{c}' },
      labelLine: { length: 8, length2: 8, lineStyle: { color: '#2b4469' } },
      data: (overview.value.byRole || []).map((r) => ({ name: r.label, value: r.count, itemStyle: { color: roleToColor[r.role] || '#2f8fff' } }))
    }]
  });
}

async function load() {
  const [ov, topo, dev, al, active] = await Promise.all([api.overview(), api.topology(), api.devices(), api.alerts(true), api.activeLayout()]);
  overview.value = ov;
  topology.value = topo;
  devices.value = dev;
  alerts.value = al;
  activeLayout.value = active || null;
  await nextTick();
  buildGraph();
  buildPie();
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      isFullscreen.value = true;
    } else {
      await document.exitFullscreen();
      isFullscreen.value = false;
    }
  } catch { /* ignore */ }
}

function onFullscreenChange() { isFullscreen.value = Boolean(document.fullscreenElement); }

onMounted(async () => {
  await load();
  timer = setInterval(() => { now.value = new Date(); }, 1000);
  resizeObserver = new ResizeObserver(() => {
    if (graph.value && graphRef.value) graph.value.changeSize(graphRef.value.clientWidth, graphRef.value.clientHeight);
    pieChart.value?.resize();
  });
  resizeObserver.observe(graphRef.value);
  document.addEventListener('fullscreenchange', onFullscreenChange);
});

onUnmounted(() => {
  clearInterval(timer);
  resizeObserver?.disconnect();
  graph.value?.destroy();
  pieChart.value?.dispose();
  document.removeEventListener('fullscreenchange', onFullscreenChange);
});

watch(() => store.seq, () => {
  if (['poll:done', 'data:reset', 'mode:changed', 'alert:resolved', 'alert:resolvedAll'].includes(store.event?.type)) load();
});
</script>

<template>
  <div class="screen">
    <header class="screen-header">
      <div class="header-side left">
        <span class="status-dot" :class="store.connected ? 'status-online' : 'status-offline'" />
        <span class="muted">{{ store.connected ? '实时数据通道已连接' : '数据通道连接中' }}</span>
      </div>
      <div class="header-center">
        <div class="screen-title">H3C 网络设备动态拓扑监控中心</div>
        <div class="screen-subtitle">NETWORK TOPOLOGY & MONITORING CENTER</div>
      </div>
      <div class="header-side right">
        <span class="clock">{{ clock }}</span>
        <el-tag :type="overview.mode === 'demo' ? 'warning' : 'success'" size="small" effect="dark">{{ overview.mode === 'demo' ? '演示模式' : '实时采集' }}</el-tag>
        <button class="screen-btn" @click="toggleFullscreen">{{ isFullscreen ? '退出全屏' : '全屏显示' }}</button>
        <button class="screen-btn" @click="router.push('/topology')">返回控制台</button>
      </div>
    </header>

    <div class="screen-body">
      <aside class="screen-col left-col">
        <div class="screen-panel">
          <div class="screen-panel-title">网络运行概览</div>
          <div class="big-stats">
            <div class="big-stat"><div class="big-value">{{ overview.totalDevices ?? 0 }}</div><div class="big-label">设备总数</div></div>
            <div class="big-stat success"><div class="big-value">{{ rate }}<small>%</small></div><div class="big-label">设备在线率</div></div>
            <div class="big-stat primary"><div class="big-value">{{ overview.linkCount ?? 0 }}</div><div class="big-label">拓扑链路</div></div>
            <div class="big-stat danger"><div class="big-value">{{ overview.alertCount ?? 0 }}</div><div class="big-label">活动告警</div></div>
          </div>
        </div>

        <div class="screen-panel grow">
          <div class="screen-panel-title">设备类型分布</div>
          <div ref="pieRef" class="pie" />
        </div>

        <div class="screen-panel">
          <div class="screen-panel-title">CPU 负载 TOP 5</div>
          <div class="rank-list">
            <div v-for="(d, i) in topCpu" :key="d.ip" class="rank-item">
              <span class="rank-no" :class="{ top: i === 0 }">{{ i + 1 }}</span>
              <div class="rank-body">
                <div class="rank-line"><span>{{ d.hostname }}</span><b :style="{ color: d.cpu >= 80 ? '#ff4d5e' : '#2f8fff' }">{{ d.cpu }}%</b></div>
                <div class="rank-bar"><span :style="{ width: (d.cpu || 0) + '%', background: d.cpu >= 80 ? '#ff4d5e' : 'linear-gradient(90deg,#2f8fff,#7c5cff)' }" /></div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <main class="screen-main">
        <div class="map-head">
          <div class="map-title">实时网络拓扑图</div>
          <div class="map-legend">
            <span v-for="item in legendItems" :key="item.label"><i :style="{ background: item.color }" />{{ item.label }}</span>
            <span><i style="background:#ff4d5e" />告警</span>
            <span><i style="background:#64748b" />离线</span>
            <span><i style="background:transparent;border-top:1px dashed #3a7fd5;height:0;border-radius:0" />链路数据流动</span>
          </div>
        </div>
        <div ref="graphRef" class="screen-graph" />
        <div class="map-foot">
          <span>拖动平移 · 滚轮缩放 · 节点实时高亮</span>
          <span class="muted">拓扑基于 LLDP 邻居关系自动生成</span>
        </div>
      </main>

      <aside class="screen-col right-col">
        <div class="screen-panel health-panel">
          <div class="screen-panel-title">网络健康度</div>
          <div class="health-body">
            <div class="health-score" :style="{ color: health >= 85 ? '#20c997' : health >= 65 ? '#ffb020' : '#ff4d5e' }">{{ health }}<small>分</small></div>
            <div class="health-meta">
              <div>严重告警 <b style="color:#ff4d5e">{{ overview.criticalCount ?? 0 }}</b></div>
              <div>警告告警 <b style="color:#ffb020">{{ overview.warningCount ?? 0 }}</b></div>
              <div>平均 CPU <b>{{ overview.avgCpu ?? 0 }}%</b></div>
              <div>平均内存 <b>{{ overview.avgMemory ?? 0 }}%</b></div>
            </div>
          </div>
        </div>

        <div class="screen-panel grow alert-panel">
          <div class="screen-panel-title">实时告警 <span class="alert-count">{{ recentAlerts.length }}</span></div>
          <div class="alert-scroll">
            <div v-if="!recentAlerts.length" class="empty">当前无活动告警</div>
            <div v-for="a in recentAlerts" :key="a.id" class="alert-item" :class="a.severity">
              <div class="alert-item-top">
                <span class="alert-badge" :class="a.severity">{{ a.severity === 'critical' ? '严重' : '警告' }}</span>
                <span class="alert-device">{{ a.device_name }}</span>
                <span class="alert-time">{{ String(a.created_at).slice(11, 19) }}</span>
              </div>
              <div class="alert-msg">{{ a.message }} <b>{{ a.value }}</b></div>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <footer class="screen-footer">
      <span class="ticker-icon">LIVE</span>
      <div class="ticker-track"><div class="ticker-content">{{ ticker }}　　◆　　{{ ticker }}</div></div>
    </footer>
  </div>
</template>

<style scoped>
.screen { height: 100%; display: flex; flex-direction: column; background: radial-gradient(ellipse at 50% 20%, #102045 0%, #070d1a 70%); overflow: hidden; }
.screen-header { height: 74px; flex: 0 0 74px; display: flex; align-items: center; justify-content: space-between; padding: 0 24px; border-bottom: 1px solid #1d3862; background: linear-gradient(180deg, rgba(16,34,68,.9), rgba(8,15,30,.4)); position: relative; }
.screen-header::after { content: ''; position: absolute; left: 20%; right: 20%; bottom: -1px; height: 2px; background: linear-gradient(90deg, transparent, #2f8fff, transparent); box-shadow: 0 0 14px #2f8fff; }
.header-side { display: flex; align-items: center; gap: 10px; font-size: 11px; min-width: 300px; }
.header-side.right { justify-content: flex-end; }
.header-center { text-align: center; flex: 1; }
.screen-title { font-size: 25px; font-weight: 700; letter-spacing: 3px; color: #e8f3ff; text-shadow: 0 0 18px rgba(47,143,255,.65); }
.screen-subtitle { font-size: 10px; letter-spacing: 5px; color: #4f7db8; margin-top: 4px; }
.clock { font-family: Consolas, monospace; font-size: 14px; color: #a9c8f5; }
.screen-btn { background: rgba(47,143,255,.14); border: 1px solid #2c5689; color: #a9c8f5; border-radius: 5px; padding: 6px 10px; font-size: 11px; cursor: pointer; }
.screen-btn:hover { background: rgba(47,143,255,.3); color: #fff; }
.screen-body { flex: 1; min-height: 0; display: grid; grid-template-columns: 280px minmax(0, 1fr) 300px; gap: 12px; padding: 14px 18px; }
.screen-col { display: flex; flex-direction: column; gap: 12px; min-height: 0; }
.screen-panel { background: linear-gradient(160deg, rgba(17,32,60,.9), rgba(9,17,33,.9)); border: 1px solid #1d3862; border-radius: 8px; display: flex; flex-direction: column; overflow: hidden; }
.screen-panel.grow { flex: 1; min-height: 0; }
.screen-panel-title { font-size: 13px; font-weight: 600; letter-spacing: 1px; color: #cfe4ff; padding: 10px 14px; border-bottom: 1px solid #1d3862; display: flex; align-items: center; gap: 8px; }
.screen-panel-title::before { content: ''; width: 3px; height: 13px; background: #2f8fff; border-radius: 2px; box-shadow: 0 0 8px #2f8fff; }
.big-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: #1d3862; }
.big-stat { background: #0d1a31; padding: 14px 10px; text-align: center; }
.big-value { font-size: 29px; font-weight: 700; line-height: 1.1; }
.big-value small { font-size: 13px; margin-left: 2px; }
.big-label { font-size: 10px; color: #7e9ac4; margin-top: 5px; }
.big-stat.success .big-value { color: #20c997; text-shadow: 0 0 14px rgba(32,201,151,.5); }
.big-stat.primary .big-value { color: #2f8fff; text-shadow: 0 0 14px rgba(47,143,255,.5); }
.big-stat.danger .big-value { color: #ff4d5e; text-shadow: 0 0 14px rgba(255,77,94,.5); }
.pie { flex: 1; min-height: 180px; }
.rank-list { padding: 10px 14px; display: grid; gap: 11px; }
.rank-item { display: flex; gap: 9px; align-items: center; }
.rank-no { width: 19px; height: 19px; border-radius: 4px; background: #1c3358; color: #8fb0dc; font-size: 11px; display: grid; place-items: center; flex: 0 0 19px; }
.rank-no.top { background: #ff4d5e; color: #fff; }
.rank-body { flex: 1; }
.rank-line { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px; }
.rank-bar { height: 4px; background: #1a3052; border-radius: 2px; overflow: hidden; }
.rank-bar span { display: block; height: 100%; border-radius: 2px; }
.screen-main { display: flex; flex-direction: column; background: linear-gradient(160deg, rgba(14,27,52,.88), rgba(8,15,30,.88)); border: 1px solid #1d3862; border-radius: 8px; overflow: hidden; min-width: 0; }
.map-head { padding: 11px 16px; border-bottom: 1px solid #1d3862; display: flex; align-items: center; justify-content: space-between; }
.map-title { font-size: 14px; font-weight: 600; color: #dcecff; }
.map-legend { display: flex; gap: 12px; font-size: 10px; color: #7e9ac4; }
.map-legend span { display: flex; align-items: center; gap: 4px; }
.map-legend i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
.screen-graph { flex: 1; min-height: 0; }
.map-foot { display: flex; justify-content: space-between; padding: 8px 16px; border-top: 1px solid #1d3862; font-size: 10px; color: #6d8cb8; }
.health-body { display: flex; align-items: center; gap: 14px; padding: 14px; }
.health-score { font-size: 42px; font-weight: 700; line-height: 1; }
.health-score small { font-size: 14px; }
.health-meta { flex: 1; display: grid; gap: 4px; font-size: 11px; color: #8ea9cf; }
.health-meta b { color: #dbe9ff; }
.alert-count { background: #ff4d5e; color: #fff; border-radius: 9px; padding: 1px 7px; font-size: 10px; }
.alert-scroll { flex: 1; min-height: 0; overflow: auto; padding: 8px 12px; }
.empty { color: #6d8cb8; font-size: 12px; text-align: center; padding: 30px 0; }
.alert-item { border: 1px solid #23406b; border-left: 3px solid #ffb020; border-radius: 5px; padding: 8px 10px; margin-bottom: 8px; background: rgba(15,29,54,.8); animation: pulse-in .4s ease; }
.alert-item.critical { border-left-color: #ff4d5e; }
.alert-item-top { display: flex; align-items: center; gap: 7px; font-size: 10px; }
.alert-badge { padding: 1px 6px; border-radius: 3px; background: rgba(255,176,32,.18); color: #ffb020; }
.alert-badge.critical { background: rgba(255,77,94,.18); color: #ff4d5e; }
.alert-device { color: #cfe0fb; font-weight: 600; }
.alert-time { margin-left: auto; color: #6d8cb8; font-family: Consolas, monospace; }
.alert-msg { font-size: 11px; color: #9fb4d6; margin-top: 5px; }
.alert-msg b { color: #ff8b95; }
.screen-footer { height: 34px; flex: 0 0 34px; border-top: 1px solid #1d3862; display: flex; align-items: center; overflow: hidden; background: rgba(10,20,39,.9); }
.ticker-icon { background: #ff4d5e; color: #fff; font-size: 10px; font-weight: 700; padding: 3px 10px; letter-spacing: 1px; }
.ticker-track { flex: 1; overflow: hidden; white-space: nowrap; }
.ticker-content { display: inline-block; font-size: 11px; color: #8fb0dc; animation: scroll 38s linear infinite; padding-left: 100%; }
@keyframes scroll { from { transform: translateX(0); } to { transform: translateX(-100%); } }
@keyframes pulse-in { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: translateX(0); } }
</style>
