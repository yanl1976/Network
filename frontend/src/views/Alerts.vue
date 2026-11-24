<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { Refresh, CircleCheck, Download } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { api } from '../api.js';
import { store } from '../store.js';
import { exportExcel } from '../utils/exportExcel.js';

const alerts = ref([]);
const severityFilter = ref('');
const typeFilter = ref('');
const activeOnly = ref(true);
const loading = ref(false);
const noteDialog = ref(false);
const noteTarget = ref(null);
const noteText = ref('');
const assignee = ref('运维');

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

async function acknowledge(id) {
  await api.ackAlert(id, assignee.value);
  ElMessage.success('已认领告警');
  await load();
}

function openNote(row) {
  noteTarget.value = row;
  noteText.value = '';
  noteDialog.value = true;
}

async function submitNote() {
  if (!noteTarget.value || !noteText.value.trim()) return;
  await api.addAlertNote(noteTarget.value.id, assignee.value, noteText.value);
  ElMessage.success('备注已添加');
  noteDialog.value = false;
  await load();
}

function statusLabel(row) {
  if (row.status === 'acknowledged') return '处理中';
  if (row.status === 'resolved' || row.active === 0) return '已恢复';
  return '活动中';
}

function notesOf(row) {
  try { return JSON.parse(row.notes || '[]'); } catch { return []; }
}

function severityType(s) { return s === 'critical' ? 'danger' : s === 'warning' ? 'warning' : 'info'; }
function formatTime(ts) { return ts ? String(ts).replace('T', ' ').slice(0, 19) : '-'; }

function exportAlerts() {
  const columns = [
    { label: '级别', width: 10, value: (r) => r.severity === 'critical' ? '严重' : r.severity === 'warning' ? '警告' : '提示' },
    { label: '告警类型', width: 16, value: (r) => typeLabels[r.type] || r.type },
    { label: '设备', prop: 'device_name', width: 20 },
    { label: 'IP 地址', prop: 'device_ip', width: 16 },
    { label: '告警内容', prop: 'message', width: 46 },
    { label: '当前值', prop: 'value', width: 14 },
    { label: '触发时间', width: 20, value: (r) => formatTime(r.created_at) },
    { label: '处理状态', width: 12, value: (r) => statusLabel(r) },
    { label: '处理人', prop: 'assignee', width: 12 },
    { label: '备注', width: 40, value: (r) => notesOf(r).map((n) => `${n.at} ${n.author}: ${n.text}`).join('\n') }
  ];
  exportExcel(`告警明细_${new Date().toISOString().slice(0, 10)}.xlsx`, [{ name: '告警明细', columns, rows: filtered.value }]);
  ElMessage.success(`已导出 ${filtered.value.length} 条告警`);
}

onMounted(load);
watch(() => store.seq, () => { if (['poll:done', 'poll:error', 'alert:resolved', 'alert:resolvedAll', 'alert:updated', 'data:reset', 'mode:changed'].includes(store.event?.type)) load(); });
</script>

<template>
  <div class="page-wrap">
    <div class="page-head">
      <div><h2>告警中心</h2><div class="sub">设备失联、性能越限与端口链路异常的实时监控</div></div>
      <div style="display:flex;gap:8px">
        <el-button :icon="Refresh" size="small" @click="load">刷新</el-button>
        <el-button :icon="Download" size="small" @click="exportAlerts">导出 Excel</el-button>
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
        <el-table-column label="处理状态" width="110"><template #default="{ row }">
          <el-tag :type="row.status === 'resolved' || row.active === 0 ? 'success' : row.status === 'acknowledged' ? 'warning' : 'danger'" size="small" effect="plain">{{ statusLabel(row) }}</el-tag>
          <div v-if="row.assignee" class="muted" style="font-size:10px">{{ row.assignee }}</div>
        </template></el-table-column>
        <el-table-column label="操作" width="150" fixed="right"><template #default="{ row }">
          <el-button v-if="row.active && row.status === 'active'" link type="warning" size="small" @click="acknowledge(row.id)">认领</el-button>
          <el-button link type="info" size="small" @click="openNote(row)">备注</el-button>
          <el-button v-if="row.active" link type="primary" size="small" @click="resolve(row.id)">解决</el-button>
        </template></el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="noteDialog" title="告警处理备注" width="520px">
      <div v-if="noteTarget">
        <div class="note-meta">设备：{{ noteTarget.device_name }} · {{ typeLabels[noteTarget.type] || noteTarget.type }} · {{ noteTarget.message }}</div>
        <div v-if="notesOf(noteTarget).length" class="note-list">
          <div v-for="(n, i) in notesOf(noteTarget)" :key="i" class="note-item">
            <span class="muted">{{ formatTime(n.at) }} {{ n.author }}</span>
            <div>{{ n.text }}</div>
          </div>
        </div>
        <el-input v-model="noteText" type="textarea" :rows="3" placeholder="填写处理记录，如：已通知网络组，计划今晚更换模块" />
      </div>
      <template #footer>
        <el-button @click="noteDialog = false">取消</el-button>
        <el-button type="primary" @click="submitNote">添加备注</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.filter-bar { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--border); }
.note-meta { font-size: 12px; color: #9fb4d6; margin-bottom: 10px; padding: 8px 10px; background: rgba(30,51,85,.45); border-radius: 5px; }
.note-list { max-height: 220px; overflow: auto; margin-bottom: 10px; }
.note-item { font-size: 12px; padding: 6px 8px; border-left: 2px solid var(--primary); margin-bottom: 6px; background: rgba(20,33,58,.6); border-radius: 3px; }
.note-item .muted { font-size: 10px; }
</style>
