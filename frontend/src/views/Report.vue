<script setup>
import { onMounted, ref } from 'vue';
import { Refresh, Download } from '@element-plus/icons-vue';
import { api } from '../api.js';

const report = ref(null);
const loading = ref(false);
const days = ref(1);

async function load() {
  loading.value = true;
  try { report.value = await api.report(days.value); } finally { loading.value = false; }
}

function fmt(ts) { return ts ? String(ts).replace('T', ' ').slice(0, 19) : '-'; }

function exportCsv() {
  if (!report.value) return;
  const r = report.value;
  const lines = [];
  lines.push(['网络巡检报告', `${fmt(r.period.from)} ~ ${fmt(r.period.to)}`]);
  lines.push([]);
  lines.push(['指标', '值']);
  lines.push(['设备总数', r.summary.totalDevices], ['在线设备', r.summary.online], ['离线设备', r.summary.offline], ['可用率(%)', r.summary.availability]);
  lines.push(['期间告警数', r.summary.alertsInPeriod], ['严重告警', r.summary.criticalAlerts], ['当前活动告警', r.summary.activeAlerts]);
  lines.push([]);
  lines.push(['设备', 'IP', '型号', '角色', '状态', 'CPU%', '内存%']);
  for (const d of r.devices) lines.push([d.name, d.ip, d.model, d.role, d.status, d.cpu, d.memory]);
  lines.push([]);
  lines.push(['告警类型', '次数']);
  for (const a of r.alertByType) lines.push([a.type, a.count]);
  lines.push([]);
  lines.push(['流量TOP', '平均入(Mbps)', '平均出(Mbps)', '样本数']);
  for (const t of r.topTraffic) lines.push([t.name, t.inAvg, t.outAvg, t.samples]);
  lines.push([]);
  lines.push(['端口', '设备', 'IP', '峰值利用率%']);
  for (const p of r.topPortUtil) lines.push([p.if_name, p.hostname, p.ip, p.peak]);

  const csv = '\uFEFF' + lines.map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `巡检报告_${new Date().toISOString().slice(0, 10)}_${days.value}天.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

onMounted(load);
</script>

<template>
  <div class="page-wrap">
    <div class="page-head">
      <div><h2>巡检报告</h2><div class="sub">设备可用率、告警统计与流量 TOP 的周期性汇总</div></div>
      <div style="display:flex;gap:8px">
        <el-radio-group v-model="days" size="small" @change="load">
          <el-radio-button :label="1">日报</el-radio-button>
          <el-radio-button :label="7">周报</el-radio-button>
          <el-radio-button :label="30">月报</el-radio-button>
        </el-radio-group>
        <el-button :icon="Refresh" size="small" @click="load">刷新</el-button>
        <el-button :icon="Download" size="small" type="primary" @click="exportCsv">导出 CSV</el-button>
      </div>
    </div>

    <template v-if="report">
      <div class="stat-grid" style="margin-bottom:14px">
        <div class="stat-card is-primary"><div class="stat-label">设备可用率</div><div class="stat-value">{{ report.summary.availability }}<span class="stat-suffix">%</span></div></div>
        <div class="stat-card is-success"><div class="stat-label">在线设备</div><div class="stat-value">{{ report.summary.online }}<span class="stat-suffix">/ {{ report.summary.totalDevices }}</span></div></div>
        <div class="stat-card is-warning"><div class="stat-label">期间告警</div><div class="stat-value">{{ report.summary.alertsInPeriod }}</div></div>
        <div class="stat-card is-danger"><div class="stat-label">严重告警</div><div class="stat-value">{{ report.summary.criticalAlerts }}</div></div>
      </div>

      <div class="report-meta muted">统计区间：{{ fmt(report.period.from) }} ~ {{ fmt(report.period.to) }}</div>

      <div class="report-grid">
        <div class="panel">
          <div class="panel-title">告警类型分布</div>
          <el-table :data="report.alertByType" size="small">
            <el-table-column prop="type" label="类型" min-width="140" />
            <el-table-column prop="count" label="次数" width="80" align="center" />
          </el-table>
        </div>
        <div class="panel">
          <div class="panel-title">告警 TOP 设备</div>
          <el-table :data="report.alertByDevice" size="small">
            <el-table-column prop="name" label="设备" min-width="130" />
            <el-table-column prop="count" label="次数" width="80" align="center" />
          </el-table>
        </div>
        <div class="panel">
          <div class="panel-title">流量 TOP（平均 Mbps）</div>
          <el-table :data="report.topTraffic" size="small">
            <el-table-column prop="name" label="设备" min-width="120" />
            <el-table-column prop="inAvg" label="入" width="80" align="right" />
            <el-table-column prop="outAvg" label="出" width="80" align="right" />
          </el-table>
        </div>
        <div class="panel">
          <div class="panel-title">端口利用率 TOP</div>
          <el-table :data="report.topPortUtil" size="small">
            <el-table-column prop="hostname" label="设备" min-width="120" />
            <el-table-column prop="if_name" label="端口" min-width="160" class-name="mono" />
            <el-table-column prop="peak" label="峰值%" width="80" align="right" />
          </el-table>
        </div>
      </div>

      <div class="panel" style="margin-top:14px">
        <div class="panel-title">设备清单快照</div>
        <el-table :data="report.devices" size="small" style="width:100%">
          <el-table-column prop="name" label="设备" min-width="130" />
          <el-table-column prop="ip" label="IP" width="140" class-name="mono" />
          <el-table-column prop="model" label="型号" min-width="170" />
          <el-table-column prop="role" label="角色" width="100" />
          <el-table-column prop="status" label="状态" width="90" />
          <el-table-column prop="cpu" label="CPU%" width="80" align="right" />
          <el-table-column prop="memory" label="内存%" width="80" align="right" />
        </el-table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.report-meta { font-size: 12px; margin-bottom: 12px; }
.report-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
@media (max-width: 1100px) { .report-grid { grid-template-columns: 1fr; } }
</style>
