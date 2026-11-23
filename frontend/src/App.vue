<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Monitor, Connection, List, Bell, Setting, FullScreen, Refresh, RefreshRight } from '@element-plus/icons-vue';
import { api, watchEvents } from './api.js';
import { store, pushEvent, refreshOverview } from './store.js';

const route = useRoute();
const router = useRouter();
const currentPath = computed(() => route.path);
const fullscreen = computed(() => Boolean(route.meta.fullscreen));
const modeLabel = computed(() => store.overview?.mode === 'demo' ? '演示模式' : '真实采集');
const modeType = computed(() => store.overview?.mode === 'demo' ? 'warning' : 'success');
let ws = null;
let timer = null;

async function poll() {
  if (store.polling) return;
  store.polling = true;
  try {
    await api.poll();
    await refreshOverview();
  } finally {
    store.polling = false;
  }
}

onMounted(async () => {
  await refreshOverview();
  ws = watchEvents((msg) => {
    store.connected = true;
    pushEvent(msg);
    if (msg.type === 'poll:done' || msg.type === 'data:reset' || msg.type === 'mode:changed') refreshOverview();
  });
  ws.onclose = () => { store.connected = false; };
  timer = setInterval(refreshOverview, 30000);
});

onUnmounted(() => {
  ws?.close();
  clearInterval(timer);
});
</script>

<template>
  <div v-if="fullscreen" class="screen-shell"><router-view /></div>
  <el-container v-else class="app-shell">
    <el-aside width="218px" class="aside">
      <div class="brand">
        <div class="brand-icon"><el-icon><Connection /></el-icon></div>
        <div>
          <div class="brand-title">网络拓扑监控</div>
          <div class="brand-sub">H3C NETWORK MONITOR</div>
        </div>
      </div>
      <el-menu :default-active="currentPath" router>
        <el-menu-item index="/topology"><el-icon><Monitor /></el-icon><span>网络拓扑</span></el-menu-item>
        <el-menu-item index="/devices"><el-icon><List /></el-icon><span>设备清单</span></el-menu-item>
        <el-menu-item index="/alerts"><el-icon><Bell /></el-icon><span>告警中心</span></el-menu-item>
        <el-menu-item index="/settings"><el-icon><Setting /></el-icon><span>系统设置</span></el-menu-item>
        <el-menu-item index="/screen"><el-icon><FullScreen /></el-icon><span>全屏展示</span></el-menu-item>
      </el-menu>
      <div class="aside-foot">
        <div class="foot-line"><span class="status-dot" :class="store.connected ? 'status-online' : 'status-offline'" />实时通道 {{ store.connected ? '已连接' : '未连接' }}</div>
        <div class="foot-line muted">采集引擎 v1.0</div>
      </div>
    </el-aside>

    <el-container class="main-container">
      <el-header class="header">
        <div class="header-left">
          <span class="header-title">{{ route.meta.title || '网络拓扑' }}</span>
          <el-tag :type="modeType" size="small" effect="dark">{{ modeLabel }}</el-tag>
        </div>
        <div class="header-right">
          <span class="header-metric"><span class="status-dot status-online" />在线 <b>{{ store.overview?.online ?? '-' }}</b>/{{ store.overview?.totalDevices ?? '-' }}</span>
          <span class="header-metric alert"><span class="status-dot status-critical" />告警 <b>{{ store.overview?.alertCount ?? 0 }}</b></span>
          <el-button :icon="Refresh" size="small" :loading="store.polling" @click="poll">立即轮询</el-button>
          <el-button :icon="FullScreen" size="small" @click="router.push('/screen')">大屏</el-button>
        </div>
      </el-header>
      <el-main class="main"><router-view /></el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.app-shell, .screen-shell { height: 100%; }
.aside { background: linear-gradient(180deg, #0d1628, #091120); border-right: 1px solid var(--border); display: flex; flex-direction: column; }
.brand { display: flex; align-items: center; gap: 10px; padding: 20px 16px; border-bottom: 1px solid var(--border); }
.brand-icon { width: 36px; height: 36px; border-radius: 9px; background: linear-gradient(135deg, #2f8fff, #7c5cff); display: grid; place-items: center; font-size: 20px; color: #fff; box-shadow: 0 0 16px rgba(47,143,255,.45); }
.brand-title { font-size: 15px; font-weight: 700; letter-spacing: .5px; }
.brand-sub { font-size: 9px; color: var(--muted); letter-spacing: 1px; margin-top: 2px; }
.aside-foot { margin-top: auto; padding: 14px 18px; border-top: 1px solid var(--border); font-size: 11px; }
.foot-line { margin: 6px 0; }
.main-container { min-width: 0; }
.header { height: 58px; background: rgba(10, 18, 34, .88); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
.header-left, .header-right { display: flex; align-items: center; gap: 12px; }
.header-title { font-size: 17px; font-weight: 600; }
.header-metric { font-size: 12px; color: var(--muted); display: flex; align-items: center; }
.header-metric b { color: var(--text); margin: 0 3px; }
.header-metric.alert b { color: var(--danger); }
.main { padding: 0; overflow: hidden; background: radial-gradient(ellipse at 50% 0%, #101c33 0%, #080e1c 65%); }
</style>
