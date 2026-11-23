<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Search, Refresh, Location, Connection } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { api } from '../api.js';

const router = useRouter();
const macQuery = ref('');
const macLoading = ref(false);
const macResult = ref(null);
const entries = ref([]);
const stats = ref({ n: 0, devices: 0 });
const listFilter = ref('');
const listLoading = ref(false);
const collecting = ref(false);
const collectResult = ref(null);
const targetIp = ref('');
const targetPorts = ref('22,80,161,443');
const portResult = ref([]);
const portChecking = ref(false);

const filteredEntries = computed(() => {
  const q = listFilter.value.trim().toLowerCase().replace(/[^0-9a-f]/g, '');
  if (!q) return entries.value;
  return entries.value.filter((r) => [r.mac, r.device_ip, r.device_name, r.port].some((v) => String(v ?? '').toLowerCase().includes(q)) || r.mac.replace(/[^0-9a-f]/g, '').includes(q));
});

async function loadEntries() {
  listLoading.value = true;
  try {
    const data = await api.macEntries({ limit: 1000 });
    entries.value = data.rows || [];
    stats.value = data.stats || { n: 0, devices: 0 };
  } catch (error) { ElMessage.error(error.message); }
  finally { listLoading.value = false; }
}

async function doMacLookup() {
  if (!macQuery.value.trim()) { ElMessage.warning('请输入 MAC 地址'); return; }
  macLoading.value = true;
  try {
    macResult.value = await api.macLookup(macQuery.value.trim());
    if (!macResult.value.matches?.length) ElMessage.info(`已检查 ${macResult.value.checked} 台设备，未找到该 MAC`);
  } catch (error) { ElMessage.error(error.message); macResult.value = null; }
  finally { macLoading.value = false; }
}

async function collectMac() {
  collecting.value = true;
  collectResult.value = null;
  try {
    const result = await api.macCollect();
    collectResult.value = result;
    ElMessage.success(`MAC 采集完成：${result.reduce((s, r) => s + (r.count || 0), 0)} 条`);
    await loadEntries();
  } catch (error) { ElMessage.error(error.message); }
  finally { collecting.value = false; }
}

function showOnly(mac) {
  macQuery.value = mac;
  doMacLookup();
}

function locateOnTopology(ip) {
  router.push({ path: '/topology', query: { ip } });
}

async function checkPorts() {
  if (!targetIp.value.trim()) { ElMessage.warning('请输入目标 IP'); return; }
  portChecking.value = true;
  try {
    portResult.value = await api.portCheck(targetIp.value.trim(), targetPorts.value.split(/[,\s]+/).filter(Boolean));
  } catch (error) { ElMessage.error(error.message); portResult.value = []; }
  finally { portChecking.value = false; }
}

onMounted(loadEntries);
</script>

<template>
  <div class="tools-page">
    <div class="panel">
      <div class="panel-title">MAC 一键定位 <span class="muted" style="font-weight:400;font-size:11px;margin-left:auto">输入终端 MAC，反查接入交换机/端口及上行路径</span></div>
      <div class="tool-bar">
        <el-input v-model="macQuery" size="small" placeholder="如 00:11:22:33:44:55 或 0011.2233.4455" style="width:340px" clearable @keyup.enter="doMacLookup" />
        <el-button size="small" type="primary" :loading="macLoading" @click="doMacLookup">定位</el-button>
      </div>
      <div v-if="macResult" class="tool-body">
        <div class="muted" style="font-size:12px;margin-bottom:8px">MAC {{ macResult.mac }} · 检查 {{ macResult.checked }} 台 · 命中 {{ macResult.matches?.length || 0 }} 处</div>
        <template v-for="m in macResult.matches" :key="m.deviceIp">
          <div class="match-row">
            <b>{{ m.deviceName || m.deviceIp }}</b><span class="mono muted">{{ m.deviceIp }}</span>
            <el-tag size="small" type="success" effect="dark">端口 {{ m.port }}</el-tag>
            <span class="muted" style="font-size:11px">{{ m.source }}</span>
            <el-button link type="primary" size="small" @click="locateOnTopology(m.deviceIp)">拓扑定位</el-button>
          </div>
          <div v-if="m.path?.length > 1" class="path-row">
            <span class="muted" style="font-size:11px">上行路径：</span>
            <template v-for="(hop, i) in m.path" :key="hop.ip">
              <span v-if="i" class="path-arrow">→</span>
              <span class="path-hop" :class="'path-' + hop.role">{{ hop.name }}<small v-if="hop.uplinkPort">:{{ hop.uplinkPort }}</small></span>
            </template>
          </div>
        </template>
        <div v-if="macResult.errors?.length" class="muted" style="font-size:11px">部分设备查询失败：{{ macResult.errors.map((e) => e.deviceIp || '-').join('、') }}</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">网内 MAC 明细 <span class="muted" style="font-weight:400;font-size:11px;margin-left:auto">{{ stats.n || 0 }} 条记录 / {{ stats.devices || 0 }} 个 MAC</span></div>
      <div class="tool-bar">
        <el-input v-model="listFilter" size="small" placeholder="筛选 MAC / 设备 / 端口" :prefix-icon="Search" style="width:260px" clearable />
        <el-button size="small" :icon="Refresh" @click="loadEntries">刷新</el-button>
        <el-button size="small" type="primary" :loading="collecting" @click="collectMac">采集全网 MAC</el-button>
        <span class="muted" style="font-size:11px">展示 {{ filteredEntries.length }} 条</span>
      </div>
      <div v-if="collectResult" class="tool-body" style="padding-top:0">
        <span class="muted" style="font-size:11px">采集结果：</span>
        <el-tag v-for="r in collectResult" :key="r.ip" size="small" style="margin-right:6px" :type="r.error ? 'danger' : 'info'">{{ r.ip }} {{ r.error ? '失败' : r.count + ' 条' }}</el-tag>
      </div>
      <el-table :data="filteredEntries" size="small" v-loading="listLoading" height="360" style="width:100%">
        <el-table-column prop="mac" label="MAC 地址" width="160" class-name="mono" />
        <el-table-column prop="device_name" label="接入交换机" min-width="140" />
        <el-table-column prop="device_ip" label="管理 IP" width="130" class-name="mono" />
        <el-table-column prop="port" label="接入端口" min-width="130" />
        <el-table-column prop="vlan" label="VLAN" width="70" />
        <el-table-column prop="source" label="来源" width="80" />
        <el-table-column prop="updated_at" label="采集时间" width="160" />
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }"><el-button link type="primary" size="small" :icon="Location" @click="showOnly(row.mac)">定位</el-button></template>
        </el-table-column>
      </el-table>
      <div v-if="!filteredEntries.length" class="empty-tip">暂无 MAC 明细，点击「采集全网 MAC」从交换机 FDB 拉取</div>
    </div>

    <div class="panel">
      <div class="panel-title">端口连通性探测 <span class="muted" style="font-weight:400;font-size:11px;margin-left:auto">检测目标 IP 常用端口开放情况</span></div>
      <div class="tool-bar">
        <el-input v-model="targetIp" size="small" placeholder="目标 IP，如 192.168.100.1" style="width:220px" />
        <el-input v-model="targetPorts" size="small" placeholder="端口，逗号分隔" style="width:200px" />
        <el-button size="small" :icon="Connection" :loading="portChecking" @click="checkPorts">探测</el-button>
      </div>
      <div v-if="portResult.length" class="tool-body" style="padding-top:0">
        <el-tag v-for="r in portResult" :key="r.port" size="small" :type="r.open ? 'success' : 'info'" style="margin-right:6px">{{ r.port }} {{ r.open ? '开放' : '关闭' }}</el-tag>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tools-page { height: 100%; overflow: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
.tool-bar { display: flex; align-items: center; gap: 8px; padding: 12px 14px 8px; flex-wrap: wrap; }
.tool-body { padding: 4px 14px 12px; }
.match-row { display: flex; align-items: center; gap: 10px; padding: 7px 10px; margin-bottom: 4px; background: rgba(30,51,85,.35); border: 1px solid var(--border); border-radius: 6px; font-size: 12px; }
.path-row { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; padding: 2px 10px 8px; font-size: 11px; }
.path-arrow { color: #5a78a8; }
.path-hop { padding: 2px 7px; border-radius: 10px; background: rgba(47,143,255,.14); border: 1px solid rgba(47,143,255,.35); color: #cfe0ff; }
.path-hop small { color: #8aa2c8; }
.path-core { background: rgba(55,211,155,.14); border-color: rgba(55,211,155,.4); color: #a7f3d0; }
.empty-tip { padding: 18px; text-align: center; color: var(--muted); font-size: 12px; }
</style>
