<script setup>
import { computed, onMounted, ref } from 'vue';
import { Refresh, CircleCheck } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { api } from '../api.js';

const report = ref(null);
const loading = ref(false);
const selectedIp = ref('');

async function load() {
  loading.value = true;
  try { report.value = await api.compliance(); } finally { loading.value = false; }
}

const filteredReports = computed(() => {
  const list = report.value?.reports || [];
  return selectedIp.value ? list.filter((r) => r.ip === selectedIp.value) : list;
});

const devicesWithConfig = computed(() => (report.value?.reports || []).filter((r) => r.hasConfig));

function severityType(s) { return s === 'critical' ? 'danger' : s === 'warning' ? 'warning' : 'info'; }
function formatTime(ts) { return ts ? String(ts).replace('T', ' ').slice(0, 19) : '-'; }

onMounted(load);
</script>

<template>
  <div class="page-wrap">
    <div class="page-head">
      <div><h2>配置合规巡检</h2><div class="sub">基于最近一次配置备份，检查 SNMP/LLDP/NTP/日志/安全等关键配置</div></div>
      <div style="display:flex;gap:8px">
        <el-button :icon="Refresh" size="small" @click="load">重新巡检</el-button>
      </div>
    </div>

    <template v-if="report">
      <div class="stat-grid" style="margin-bottom:14px">
        <div class="stat-card is-primary"><div class="stat-label">已检查设备</div><div class="stat-value">{{ report.summary.checkedDevices }}<span class="stat-suffix">/ {{ report.summary.totalDevices }}</span></div></div>
        <div class="stat-card is-success"><div class="stat-label">合规项通过</div><div class="stat-value">{{ report.summary.passed }}</div></div>
        <div class="stat-card is-warning"><div class="stat-label">不合规项</div><div class="stat-value">{{ report.summary.failed }}</div></div>
        <div class="stat-card is-danger"><div class="stat-label">严重不合规</div><div class="stat-value">{{ report.summary.critical }}</div></div>
      </div>

      <div class="panel">
        <div class="filter-bar">
          <el-select v-model="selectedIp" placeholder="全部设备" size="small" clearable style="width:200px">
            <el-option v-for="d in devicesWithConfig" :key="d.ip" :label="`${d.name} (${d.ip})`" :value="d.ip" />
          </el-select>
          <span class="muted" style="margin-left:auto;font-size:12px">巡检时间 {{ formatTime(report.generatedAt) }}</span>
        </div>
        <el-table :data="filteredReports" size="small" v-loading="loading" style="width:100%" row-key="deviceId">
          <el-table-column type="expand">
            <template #default="{ row }">
              <div class="check-list">
                <div v-for="c in row.checks" :key="c.key" class="check-item" :class="c.pass ? 'check-pass' : 'check-fail'">
                  <el-tag :type="c.pass ? 'success' : severityType(c.severity)" size="small" effect="plain">{{ c.pass ? '通过' : '不合规' }}</el-tag>
                  <span class="check-name">{{ c.name }}</span>
                  <span class="muted check-cat">{{ c.category }}</span>
                  <span v-if="!c.pass" class="check-suggest">建议：{{ c.suggestion }}</span>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="name" label="设备" min-width="140" />
          <el-table-column prop="ip" label="IP" width="140" class-name="mono" />
          <el-table-column label="合规" width="80" align="center"><template #default="{ row }"><span :class="row.failed ? 'danger-text' : 'success-text'">{{ row.passed }}/{{ row.passed + row.failed }}</span></template></el-table-column>
          <el-table-column label="不合规" width="80" align="center"><template #default="{ row }">{{ row.failed }}</template></el-table-column>
          <el-table-column label="配置快照" min-width="170"><template #default="{ row }"><span class="muted">{{ row.hasConfig ? formatTime(row.capturedAt) : '未备份配置' }}</span></template></el-table-column>
        </el-table>
      </div>

      <div class="panel" style="margin-top:14px" v-if="report.failedChecks.length">
        <div class="panel-title">不合规项汇总 <span class="muted" style="font-size:11px;font-weight:400">({{ report.failedChecks.length }})</span></div>
        <el-table :data="report.failedChecks" size="small" style="width:100%">
          <el-table-column label="级别" width="80"><template #default="{ row }"><el-tag :type="severityType(row.severity)" size="small" effect="dark">{{ row.severity === 'critical' ? '严重' : row.severity === 'warning' ? '警告' : '提示' }}</el-tag></template></el-table-column>
          <el-table-column prop="deviceName" label="设备" min-width="120" />
          <el-table-column prop="deviceIp" label="IP" width="130" class-name="mono" />
          <el-table-column prop="name" label="检查项" min-width="160" />
          <el-table-column prop="suggestion" label="整改建议" min-width="260" />
        </el-table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.filter-bar { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--border); }
.check-list { padding: 8px 14px; }
.check-item { display: flex; align-items: center; gap: 10px; padding: 5px 0; font-size: 12px; border-bottom: 1px solid rgba(30,51,85,.4); }
.check-name { color: #d6e4f7; }
.check-cat { font-size: 10px; }
.check-suggest { color: #ffc457; font-size: 11px; margin-left: auto; }
.danger-text { color: var(--danger); font-weight: 600; }
.success-text { color: var(--success); font-weight: 600; }
</style>
