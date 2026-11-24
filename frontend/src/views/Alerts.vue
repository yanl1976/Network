<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { Refresh, CircleCheck } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { api } from '../api.js';
import { store } from '../store.js';

const alerts = ref([]);
const severityFilter = ref('');
const typeFilter = ref('');
const activeOnly = ref(true);
const loading = ref(false);

const typeLabels = { offline: '设备失联', cpu_high: 'CPU 过高', memory_high: '内存过高', port_down: '端口中断', port_traffic_high: '端口流量异常' };
const filtered = computed(() => alerts.value.filter((a) =>
  (!severityFilter.value || a.severity === severityFilter.value)
  && (!typeFilter.value || a.type === typeFilter.value)
  && (!activeOnly.value || a.active === 1)));

const stats = computed(() => ({
  total: alerts.value.filter((a) => a.active === 1).length,
  critical: alerts.value.filter((a) => a.active === 1 && a.severity === 'critical').length,
  warning: alerts.value.filter((a) => a.active === 1 && a.severity === 'warning').length,
  resolved: alerts.value.filter((a) => a.active === 0).length
}));

async function load() {
  loading.value = true;
  try { alerts.value = await api.alerts(false); } finally { loading.value = false; }
}

async function resolve(id) {
  await api.resolveAlert(id);
  ElMessage.success('告警已标记为解决');
  await load();
}

async function resolveAll() {
  await api.resolveAllAlerts();
  ElMessage.success('已解决全部活动告警');
  await load();
}

function severityType(s) { return s === 'critical' ? 'danger' : s === 'warning' ? 'warning' : 'info'; }
function formatTime(ts) { return ts ? String(ts).replace('T', ' ').slice(0, 19) : '-'; }

onMounted(load);
watch(() => store.seq, () => { if (['poll:done', 'poll:error', 'alert:resolved', 'alert:resolvedAll', 'data:reset', 'mode:changed'].includes(store.event?.type)) load(); });
</script>

<template>
  <div class="page-wrap">
    <div class="page-head">
      <div><h2>告警中心</h2><div class="sub">设备失联、性能越限与端口链路异常的实时监控</div></div>
      <div style="display:flex;gap:8px">
        <el-button :icon="Refresh" size="small" @click="load">刷新</el-button>
        <el-button :icon="CircleCheck" size="small" type="primary" @click="resolveAll">全部解决</el-button>
      </div>
    </div>

    <div class="stat-grid" style="margin-bottom:14px">
      <div class="stat-card is-danger"><div class="stat-label">活动告警</div><div class="stat-value">{{ stats.total }}</div></div>
      <div class="stat-card is-danger"><div class="stat-label">严重告警</div><div class="stat-value">{{ stats.critical }}</div></div>
      <div class="stat-card is-warning"><div class="stat-label">警告告警</div><div class="stat-value">{{ stats.warning }}</div></div>
      <div class="stat-card is-success"><div class="stat-label">已恢复</div><div class="stat-value">{{ stats.resolved }}</div></div>
    </div>

    <div class="panel">
      <div class="filter-bar">
        <el-select v-model="severityFilter" placeholder="告警级别" size="small" clearable style="width:140px">
          <el-option label="严重" value="critical" /><el-option label="警告" value="warning" /><el-option label="提示" value="info" />
        </el-select>
        <el-select v-model="typeFilter" placeholder="告警类型" size="small" clearable style="width:160px">
          <el-option v-for="(label, key) in typeLabels" :key="key" :label="label" :value="key" />
        </el-select>
        <el-checkbox v-model="activeOnly" size="small">仅看活动告警</el-checkbox>
        <span class="muted" style="margin-left:auto;font-size:12px">共 {{ filtered.length }} 条</span>
      </div>
      <el-table :data="filtered" size="small" v-loading="loading" style="width:100%">
        <el-table-column label="级别" width="90"><template #default="{ row }"><el-tag :type="severityType(row.severity)" size="small" effect="dark">{{ row.severity === 'critical' ? '严重' : row.severity === 'warning' ? '警告' : '提示' }}</el-tag></template></el-table-column>
        <el-table-column label="告警类型" width="120"><template #default="{ row }">{{ typeLabels[row.type] || row.type }}</template></el-table-column>
        <el-table-column prop="device_name" label="设备" min-width="130" />
        <el-table-column prop="device_ip" label="IP 地址" width="132" class-name="mono" />
        <el-table-column prop="message" label="告警内容" min-width="230" />
        <el-table-column prop="value" label="当前值" width="90" />
        <el-table-column label="触发时间" width="160"><template #default="{ row }"><span class="muted">{{ formatTime(row.created_at) }}</span></template></el-table-column>
        <el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="row.active ? 'danger' : 'success'" size="small" effect="plain">{{ row.active ? '活动中' : '已恢复' }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="86" fixed="right"><template #default="{ row }"><el-button v-if="row.active" link type="primary" size="small" @click="resolve(row.id)">解决</el-button><span v-else class="muted">-</span></template></el-table-column>
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.filter-bar { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--border); }
</style>
