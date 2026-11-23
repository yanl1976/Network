<script setup>
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api.js';
import { store, refreshOverview } from '../store.js';

const config = ref(null);
const draft = ref({});
const saving = ref(false);
const subnetInput = ref('');

import { typeColor } from '../device-icons.js';

async function load() {
  config.value = await api.settings();
  draft.value = JSON.parse(JSON.stringify(config.value));
  draft.value.scan.ports = (config.value.scan.ports || []).join(', ');
}

function addSubnet() {
  const value = subnetInput.value.trim();
  if (!value) return;
  if (!draft.value.scan.subnets.includes(value)) draft.value.scan.subnets.push(value);
  subnetInput.value = '';
}

function removeSubnet(item) {
  draft.value.scan.subnets = draft.value.scan.subnets.filter((s) => s !== item);
}

async function save() {
  saving.value = true;
  try {
    const payload = JSON.parse(JSON.stringify(draft.value));
    payload.scan.ports = String(payload.scan.ports || '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
    const next = await api.saveSettings(payload);
    config.value = next;
    draft.value = JSON.parse(JSON.stringify(next));
    draft.value.scan.ports = (next.scan.ports || []).join(', ');
    await refreshOverview();
    ElMessage.success('系统设置已保存');
  } finally { saving.value = false; }
}

async function changeMode(mode) {
  if (config.value.mode === mode) return;
  await ElMessageBox.confirm(
    mode === 'demo' ? '切换到演示模式会重置为内置 H3C 模拟拓扑，确定继续？' : '切换到真实采集模式后将按设备清单执行 SNMP 采集，请确认凭据已配置。',
    '切换运行模式', { type: 'warning' }
  );
  await api.setMode(mode);
  await load();
  await refreshOverview();
  ElMessage.success(`已切换到${mode === 'demo' ? '演示模式' : '真实采集模式'}`);
}

async function reseed() {
  await ElMessageBox.confirm('将清空当前数据并重新生成演示拓扑，确定继续？', '重置数据', { type: 'warning' });
  await api.reseed();
  await refreshOverview();
  ElMessage.success('演示数据已重置');
}

onMounted(load);
</script>

<template>
  <div class="page-wrap" v-if="config">
    <div class="page-head">
      <div><h2>系统设置</h2><div class="sub">采集协议参数、扫描范围、告警阈值与设备清单管理</div></div>
      <el-button type="primary" :loading="saving" @click="save">保存设置</el-button>
    </div>

    <div class="settings-grid">
      <div class="panel settings-card">
        <div class="panel-title">运行模式</div>
        <div class="mode-box">
          <div class="mode-option" :class="{ active: config.mode === 'demo' }" @click="changeMode('demo')">
            <div class="mode-name">演示模式</div>
            <div class="mode-desc">内置 H3C 园区网模拟数据，适合功能体验与界面演示</div>
          </div>
          <div class="mode-option" :class="{ active: config.mode === 'live' }" @click="changeMode('live')">
            <div class="mode-name">真实采集</div>
            <div class="mode-desc">按设备清单轮询 SNMP、LLDP、SSH，需配置可达设备</div>
          </div>
        </div>
        <el-alert :type="config.mode === 'demo' ? 'warning' : 'success'" :closable="false" style="margin-top:12px"
          :title="config.mode === 'demo' ? '当前为演示模式，所有指标为模拟生成' : '当前为真实采集模式，数据来自设备'" />
        <el-button size="small" style="margin-top:12px" @click="reseed">重置演示数据</el-button>
      </div>

      <div class="panel settings-card">
        <div class="panel-title">SNMP 采集参数</div>
        <el-form label-width="100px" size="small">
          <el-form-item label="团体字"><el-input v-model="draft.snmp.community" placeholder="public" /></el-form-item>
          <el-form-item label="协议版本"><el-select v-model="draft.snmp.version"><el-option label="v2c" value="2c" /><el-option label="v3" value="3" /></el-select></el-form-item>
          <el-form-item label="超时(ms)"><el-input-number v-model="draft.snmp.timeout" :min="500" :step="500" /></el-form-item>
          <el-form-item label="重试次数"><el-input-number v-model="draft.snmp.retries" :min="0" :max="5" /></el-form-item>
        </el-form>
        <div class="hint">H3C Comware 常用 OID：系统 MIB-II + 私有 1.3.6.1.4.1.25506 + LLDP 1.0.8802</div>
      </div>

      <div class="panel settings-card">
        <div class="panel-title">SSH 配置抓取</div>
        <el-form label-width="100px" size="small">
          <el-form-item label="端口"><el-input-number v-model="draft.ssh.port" :min="1" :max="65535" /></el-form-item>
          <el-form-item label="用户名"><el-input v-model="draft.ssh.username" placeholder="admin" /></el-form-item>
          <el-form-item label="密码"><el-input v-model="draft.ssh.password" type="password" show-password placeholder="请填写设备SSH密码" /></el-form-item>
          <el-form-item label="超时(ms)"><el-input-number v-model="draft.ssh.timeout" :min="1000" :step="1000" /></el-form-item>
        </el-form>
        <div class="hint">抓取命令：display current-configuration（Comware）</div>
      </div>

      <div class="panel settings-card">
        <div class="panel-title">网段扫描</div>
        <el-form label-width="100px" size="small">
          <el-form-item label="扫描网段">
            <div class="subnet-list">
              <el-tag v-for="s in draft.scan.subnets" :key="s" closable size="small" @close="removeSubnet(s)">{{ s }}</el-tag>
            </div>
            <el-input v-model="subnetInput" placeholder="如 192.168.40.0/24，回车添加" @keyup.enter="addSubnet" />
          </el-form-item>
          <el-form-item label="探测端口"><el-input v-model="draft.scan.ports" placeholder="22, 161, 80, 443（逗号分隔）" /></el-form-item>
          <el-form-item label="并发数"><el-input-number v-model="draft.scan.concurrency" :min="1" :max="512" /></el-form-item>
          <el-form-item label="超时(ms)"><el-input-number v-model="draft.scan.timeoutMs" :min="100" :step="100" /></el-form-item>
        </el-form>
        <div class="hint">161=SNMP / 22=SSH，用于判断设备类型并自动发现资产</div>
      </div>

      <div class="panel settings-card">
        <div class="panel-title">轮询与告警阈值</div>
        <el-form label-width="110px" size="small">
          <el-form-item label="轮询间隔(秒)"><el-input-number v-model="draft.poll.intervalSec" :min="10" :step="10" /></el-form-item>
          <el-form-item label="CPU 警告(%)"><el-input-number v-model="draft.poll.thresholds.cpuWarn" :min="1" :max="100" /></el-form-item>
          <el-form-item label="CPU 严重(%)"><el-input-number v-model="draft.poll.thresholds.cpuCritical" :min="1" :max="100" /></el-form-item>
          <el-form-item label="内存警告(%)"><el-input-number v-model="draft.poll.thresholds.memWarn" :min="1" :max="100" /></el-form-item>
          <el-form-item label="内存严重(%)"><el-input-number v-model="draft.poll.thresholds.memCritical" :min="1" :max="100" /></el-form-item>
        </el-form>
        <div class="hint">阈值变更后需等待下一次轮询生效</div>
      </div>
    </div>

    <div class="panel device-table">
      <div class="panel-title">设备清单 <span class="muted" style="font-weight:400;font-size:11px;margin-left:auto">{{ config.devices.length }} 台</span></div>
      <el-table :data="config.devices" size="small" style="width:100%">
        <el-table-column prop="name" label="设备名称" min-width="130" />
        <el-table-column prop="ip" label="管理 IP" width="140" class-name="mono" />
        <el-table-column label="设备类型" width="120"><template #default="{ row }"><el-tag size="small" effect="dark" :color="typeColor(row)" style="border:0">{{ ({ switch: '交换机', firewall: '防火墙', router: '路由器', server: '服务器' })[row.type || 'switch'] }}</el-tag></template></el-table-column>
        <el-table-column prop="model" label="型号" min-width="180" />
        <el-table-column prop="location" label="位置" min-width="140" />
      </el-table>
      <div class="hint" style="padding:10px 14px">设备清单定义于 <code>config/app.json</code>，可在文件中直接增删设备后重启服务。</div>
    </div>
  </div>
</template>

<style scoped>
.settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-bottom: 14px; }
.settings-card { padding-bottom: 12px; }
.mode-box { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 14px; }
.mode-option { border: 1px solid var(--border); border-radius: 8px; padding: 12px; cursor: pointer; background: rgba(12,22,41,.6); }
.mode-option.active { border-color: var(--primary); background: rgba(47,143,255,.14); box-shadow: 0 0 0 1px rgba(47,143,255,.3) inset; }
.mode-name { font-weight: 600; margin-bottom: 5px; }
.mode-desc { font-size: 11px; color: var(--muted); line-height: 1.5; }
.hint { font-size: 11px; color: var(--muted); padding: 0 16px; line-height: 1.6; }
.subnet-list { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
.device-table { padding-bottom: 6px; }
</style>
