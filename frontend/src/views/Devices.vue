<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Search, Refresh, Document } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api.js';
import { store } from '../store.js';

import { typeColor } from '../device-icons.js';
const statusMap = { online: ['在线', 'success'], warning: ['告警', 'warning'], critical: ['严重', 'danger'], offline: ['离线', 'info'] };
const devices = ref([]);
const keyword = ref('');
const roleFilter = ref('');
const statusFilter = ref('');
const detail = ref(null);
const drawer = ref(false);
const configText = ref('');
const configDialog = ref(false);
const loading = ref(false);
const managed = ref([]);
const editDialog = ref(false);
const editing = ref(false);
const form = ref({});
const router = useRouter();
const macQuery = ref('');
const macLoading = ref(false);
const macResult = ref(null);

const emptyForm = () => ({ ip: '', name: '', role: 'access', type: 'switch', model: '', location: '', username: '', password: '', superPassword: '', clearCredentials: false });

async function loadManaged() {
  managed.value = await api.managedDevices();
}

function openAdd() {
  editing.value = false;
  form.value = emptyForm();
  editDialog.value = true;
}

function openEdit(row) {
  const m = managed.value.find((d) => d.ip === row.ip) || {};
  editing.value = true;
  form.value = { ...emptyForm(), ...m, username: '', password: '', superPassword: '' };
  editDialog.value = true;
}

async function saveDevice() {
  const f = form.value;
  const payload = {
    name: f.name, ip: f.ip, role: f.role, type: f.type, model: f.model, location: f.location,
    username: f.username, password: f.password, superPassword: f.superPassword,
    clearCredentials: f.clearCredentials
  };
  try {
    if (editing.value) await api.updateDevice(f.ip, payload);
    else await api.addDevice(payload);
    editDialog.value = false;
    ElMessage.success(editing.value ? '设备已更新，凭据已同步到 .env' : '设备已新增，凭据已同步到 .env');
    await loadManaged();
    await load();
  } catch (error) { ElMessage.error(error.message); }
}

async function deleteDevice(row) {
  await ElMessageBox.confirm(`确定删除设备 ${row.hostname}（${row.ip}）？其 .env 凭据也会一并删除。`, '删除设备', { type: 'warning' });
  try {
    await api.deleteDevice(row.ip);
    ElMessage.success('设备已删除');
    await loadManaged();
    await load();
  } catch (error) { ElMessage.error(error.message); }
}

const filtered = computed(() => devices.value.filter((d) => {
  const q = keyword.value.trim().toLowerCase();
  return (!q || [d.hostname, d.ip, d.model, d.location].some((v) => String(v ?? '').toLowerCase().includes(q)))
    && (!roleFilter.value || d.role === roleFilter.value)
    && (!statusFilter.value || d.status === statusFilter.value);
}));

async function load() {
  loading.value = true;
  try { devices.value = await api.devices(); } finally { loading.value = false; }
}

async function openDetail(row) {
  detail.value = await api.device(row.id);
  drawer.value = true;
}

async function viewConfig(id) {
  const data = await api.configContent(id);
  configText.value = data.content;
  configDialog.value = true;
}

async function doMacLookup() {
  const value = macQuery.value.trim();
  if (!value) { ElMessage.warning('请输入 MAC 地址'); return; }
  macLoading.value = true;
  try {
    macResult.value = await api.macLookup(value);
    if (!macResult.value.matches.length) ElMessage.info(`已检查 ${macResult.value.checked} 台设备，未找到该 MAC`);
  } catch (error) { ElMessage.error(error.message); macResult.value = null; }
  finally { macLoading.value = false; }
}

function openMacDevice(ip) {
  const device = devices.value.find((d) => d.ip === ip);
  if (device) openDetail(device);
  else ElMessage.warning('该设备不在清单中');
}

function locateOnTopology(ip) {
  router.push({ path: '/topology', query: { ip } });
}

async function backupAll() {
  const result = await api.backup();
  const okList = result.filter((r) => r.ok);
  const failList = result.filter((r) => !r.ok);
  if (failList.length) {
    const lines = failList.map((r) => `${r.ip || '未知设备'}：${r.error || '未知错误'}`).join('\n');
    ElMessageBox.alert(lines, `备份完成：成功 ${okList.length} 台，失败 ${failList.length} 台`, { type: 'warning' });
  } else {
    ElMessage.success(`配置备份完成：成功 ${okList.length} 台`);
  }
  await load();
}

function statusTag(status) {
  const [label, type] = statusMap[status] || [status, 'info'];
  return type;
}

onMounted(() => { load(); loadManaged(); });
watch(() => store.seq, () => { if (['poll:done', 'poll:error', 'alert:resolved', 'alert:resolvedAll', 'data:reset', 'mode:changed', 'devices:changed'].includes(store.event?.type)) { load(); loadManaged(); } });
</script>

<template>
  <div class="page-wrap">
    <div class="page-head">
      <div><h2>设备清单</h2><div class="sub">共 {{ devices.length }} 台 H3C 网络设备 · 点击查看端口与配置详情</div></div>
      <div style="display:flex;gap:8px">
        <el-button :icon="Refresh" size="small" @click="load">刷新</el-button>
        <el-button size="small" @click="openAdd">新增设备</el-button>
        <el-button type="primary" size="small" @click="backupAll">批量备份配置</el-button>
      </div>
    </div>

    <div class="panel mac-locate">
      <div class="panel-title">MAC 一键定位 <span class="muted" style="font-weight:400;font-size:11px;margin-left:auto">输入终端 MAC，反查其接入的交换机与端口</span></div>
      <div class="mac-bar">
        <el-input v-model="macQuery" size="small" placeholder="如 00:11:22:33:44:55 或 0011.2233.4455" style="width:320px" clearable @keyup.enter="doMacLookup" />
        <el-button size="small" type="primary" :loading="macLoading" @click="doMacLookup">定位</el-button>
      </div>
      <div v-if="macResult" class="mac-result">
        <div class="muted" style="font-size:12px;margin-bottom:8px">MAC {{ macResult.mac }} · 已检查 {{ macResult.checked }} 台设备 · 命中 {{ macResult.matches?.length || 0 }} 处</div>
        <template v-for="m in macResult.matches" :key="m.deviceIp">
          <div class="mac-match">
            <span class="status-dot status-online" />
            <b>{{ m.deviceName || m.deviceIp }}</b>
            <span class="mono muted">{{ m.deviceIp }}</span>
            <el-tag size="small" effect="dark" type="success">端口 {{ m.port }}</el-tag>
            <span class="muted" style="font-size:11px">{{ m.source === 'dot1q' ? 'VLAN FDB' : 'FDB' }} · ifIndex {{ m.ifIndex }}</span>
            <el-button link type="primary" size="small" @click="openMacDevice(m.deviceIp)">设备详情</el-button>
            <el-button link type="primary" size="small" @click="locateOnTopology(m.deviceIp)">拓扑定位</el-button>
          </div>
          <div v-if="m.path?.length > 1" class="mac-path">
            <span class="muted" style="font-size:11px">上行路径：</span>
            <template v-for="(hop, i) in m.path" :key="hop.ip">
              <span v-if="i" class="mac-path-arrow">→</span>
              <span class="mac-hop" :class="'mac-role-' + hop.role">{{ hop.name }}<small v-if="hop.uplinkPort">:{{ hop.uplinkPort }}</small></span>
            </template>
          </div>
        </template>
        <div v-if="macResult.errors?.length" class="muted" style="font-size:11px;margin-top:8px">部分设备查询失败：{{ macResult.errors.map((e) => e.deviceIp || '-').join('、') }}</div>
      </div>
    </div>

    <div class="panel">
      <div class="filter-bar">
        <el-input v-model="keyword" placeholder="搜索设备名称 / IP / 型号 / 位置" :prefix-icon="Search" size="small" style="width:280px" clearable />
        <el-select v-model="roleFilter" placeholder="设备角色" size="small" clearable style="width:150px">
          <el-option label="核心交换机" value="core" /><el-option label="汇聚交换机" value="aggregation" />
          <el-option label="接入交换机" value="access" /><el-option label="边界设备" value="border" /><el-option label="服务器" value="server" />
        </el-select>
        <el-select v-model="statusFilter" placeholder="运行状态" size="small" clearable style="width:140px">
          <el-option label="在线" value="online" /><el-option label="告警" value="warning" /><el-option label="严重" value="critical" /><el-option label="离线" value="offline" />
        </el-select>
        <span class="muted" style="margin-left:auto;font-size:12px">筛选结果 {{ filtered.length }} 台</span>
      </div>
      <el-table :data="filtered" size="small" v-loading="loading" @row-click="openDetail" style="width:100%">
        <el-table-column prop="hostname" label="设备名称" min-width="130">
          <template #default="{ row }"><span class="status-dot" :class="'status-' + row.status" />{{ row.hostname }}</template>
        </el-table-column>
        <el-table-column prop="ip" label="管理 IP" width="132" class-name="mono" />
        <el-table-column label="设备类型" width="110"><template #default="{ row }"><el-tag size="small" effect="dark" :color="typeColor(row)" style="border:0">{{ ({ switch: '交换机', firewall: '防火墙', router: '路由器', server: '服务器' })[row.deviceType] || row.roleLabel }}</el-tag></template></el-table-column>
        <el-table-column prop="model" label="型号" min-width="170" />
        <el-table-column prop="location" label="位置" min-width="130" />
        <el-table-column label="状态" width="84"><template #default="{ row }"><el-tag :type="statusTag(row.status)" size="small" effect="dark">{{ statusMap[row.status]?.[0] || row.status }}</el-tag></template></el-table-column>
        <el-table-column label="CPU" width="104"><template #default="{ row }"><el-progress :percentage="row.cpu ?? 0" :stroke-width="6" :show-text="false" :color="row.cpu >= 90 ? '#ff4d5e' : row.cpu >= 70 ? '#ffb020' : '#2f8fff'" /><span class="muted" style="font-size:10px">{{ row.cpu }}%</span></template></el-table-column>
        <el-table-column label="内存" width="104"><template #default="{ row }"><el-progress :percentage="row.memory ?? 0" :stroke-width="6" :show-text="false" :color="row.memory >= 90 ? '#ff4d5e' : row.memory >= 75 ? '#ffb020' : '#a06bff'" /><span class="muted" style="font-size:10px">{{ row.memory }}%</span></template></el-table-column>
        <el-table-column prop="interface_count" label="端口" width="64" align="center" />
        <el-table-column label="告警" width="64" align="center"><template #default="{ row }"><span :style="{ color: row.alert_count ? '#ff4d5e' : '#4b6386' }">{{ row.alert_count }}</span></template></el-table-column>
        <el-table-column label="登录信息" width="100" align="center"><template #default="{ row }"><el-tag size="small" :type="managed.find((d) => d.ip === row.ip)?.credentialsConfigured ? 'success' : 'info'" effect="plain">{{ managed.find((d) => d.ip === row.ip)?.credentialsConfigured ? '已配置' : '未配置' }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="120" fixed="right"><template #default="{ row }">
          <el-button link type="primary" size="small" @click.stop="openEdit(row)">编辑</el-button>
          <el-button link type="danger" size="small" @click.stop="deleteDevice(row)">删除</el-button>
        </template></el-table-column>
      </el-table>
    </div>

    <el-drawer v-model="drawer" :title="detail?.hostname || '设备详情'" size="min(1100px, 94vw)" class="device-drawer">
      <template v-if="detail">
        <div class="drawer-meta">
          <div><span>管理 IP</span><b class="mono">{{ detail.ip }}</b></div>
          <div><span>设备型号</span><b>{{ detail.model }}</b></div>
          <div><span>序列号</span><b class="mono">{{ detail.serial }}</b></div>
          <div><span>安装位置</span><b>{{ detail.location }}</b></div>
          <div><span>运行时间</span><b>{{ detail.uptime }}</b></div>
          <div><span>系统描述</span><b>{{ detail.sys_descr }}</b></div>
        </div>
        <div class="drawer-section">
          <div class="drawer-title">端口状态 <span class="muted">({{ detail.interfaces?.length || 0 }})</span></div>
          <el-table :data="detail.interfaces || []" size="small" max-height="260" class="nowrap-table">
            <el-table-column prop="if_name" label="端口" min-width="180" class-name="mono" />
            <el-table-column label="状态" width="90"><template #default="{ row }"><span class="status-dot" :class="row.oper_status === 1 ? 'status-online' : 'status-offline'" />{{ row.oper_status === 1 ? 'UP' : 'DOWN' }}</template></el-table-column>
            <el-table-column prop="if_speed" label="速率" min-width="120"><template #default="{ row }">{{ row.if_speed >= 1e9 ? (row.if_speed / 1e9) + ' Gbps' : (row.if_speed / 1e6) + ' Mbps' }}</template></el-table-column>
            <el-table-column label="入/出利用率" min-width="160"><template #default="{ row }">{{ (row.in_util || 0).toFixed(1) }}% / {{ (row.out_util || 0).toFixed(1) }}%</template></el-table-column>
          </el-table>
        </div>
        <div class="drawer-section">
          <div class="drawer-title">链路连接 <span class="muted">({{ (detail.links || []).filter(l => l.known).length }} 条已知 / {{ (detail.links || []).length }} 条)</span></div>
          <div v-if="!detail.links?.length" class="muted" style="font-size:12px">暂无链路数据</div>
          <el-table v-else :data="detail.links || []" size="small" max-height="300" class="nowrap-table">
            <el-table-column label="对端设备" min-width="180">
              <template #default="{ row }">
                <span class="status-dot" :class="row.status === 'up' ? 'status-online' : row.status === 'down' ? 'status-offline' : ''" />
                <b>{{ row.peerName || row.peerIp || '未知设备' }}</b>
              </template>
            </el-table-column>
            <el-table-column label="对端 IP" width="150" class-name="mono"><template #default="{ row }">{{ row.peerIp || '-' }}</template></el-table-column>
            <el-table-column label="本端端口" min-width="200" class-name="mono"><template #default="{ row }">{{ row.localPort || '-' }}</template></el-table-column>
            <el-table-column label="对端端口" min-width="200" class-name="mono"><template #default="{ row }">{{ row.remotePort || '-' }}</template></el-table-column>
            <el-table-column label="状态" width="90"><template #default="{ row }">{{ row.status === 'up' ? '正常' : row.status === 'down' ? '中断' : '未知' }}</template></el-table-column>
          </el-table>
        </div>
        <div class="drawer-section">
          <div class="drawer-title">配置备份 <span class="muted">({{ detail.configs?.length || 0 }})</span></div>
          <div v-if="!detail.configs?.length" class="muted" style="font-size:12px">暂无配置备份，可在设备清单页执行批量备份</div>
          <div v-for="cfg in detail.configs || []" :key="cfg.id" class="config-row">
            <el-icon><Document /></el-icon>
            <span class="mono">{{ cfg.hash?.slice(0, 10) || '-' }}</span>
            <span class="muted">{{ cfg.captured_at?.replace('T', ' ').slice(0, 19) }}</span>
            <span class="muted">{{ cfg.bytes }} B</span>
            <el-button link type="primary" size="small" @click="viewConfig(cfg.id)">查看</el-button>
          </div>
        </div>
        <div class="drawer-section">
          <div class="drawer-title">告警记录</div>
          <div v-if="!detail.alerts?.length" class="muted" style="font-size:12px">无告警记录</div>
          <div v-for="a in detail.alerts || []" :key="a.id" class="config-row">
            <span class="status-dot" :class="a.severity === 'critical' ? 'status-critical' : 'status-warning'" />
            <span>{{ a.message }}</span><b>{{ a.value }}</b>
            <span class="muted">{{ a.active ? '活动中' : '已恢复' }}</span>
          </div>
        </div>
      </template>
    </el-drawer>

    <el-dialog v-model="editDialog" :title="editing ? '编辑设备' : '新增设备'" width="560px">
      <el-form :model="form" label-width="96px" size="small">
        <el-form-item label="设备名称"><el-input v-model="form.name" placeholder="如 CORE-01" /></el-form-item>
        <el-form-item label="管理 IP"><el-input v-model="form.ip" placeholder="如 192.168.10.1" :disabled="editing" /></el-form-item>
        <el-form-item label="设备角色"><el-select v-model="form.role" style="width:100%"><el-option label="核心交换机" value="core" /><el-option label="汇聚交换机" value="aggregation" /><el-option label="接入交换机" value="access" /><el-option label="边界设备" value="border" /><el-option label="服务器" value="server" /></el-select></el-form-item>
        <el-form-item label="设备类型"><el-select v-model="form.type" style="width:100%"><el-option label="交换机" value="switch" /><el-option label="防火墙" value="firewall" /><el-option label="路由器" value="router" /><el-option label="服务器" value="server" /></el-select></el-form-item>
        <el-form-item label="型号"><el-input v-model="form.model" placeholder="如 H3C S6520X-54QC-EI" /></el-form-item>
        <el-form-item label="位置"><el-input v-model="form.location" placeholder="如 中心机房A柜" /></el-form-item>
        <div class="cred-divider">SSH 登录信息（写入 .env，与凭据表同步）</div>
        <el-form-item label="用户名"><el-input v-model="form.username" placeholder="留空表示沿用当前/env全局" /></el-form-item>
        <el-form-item label="密码"><el-input v-model="form.password" type="password" show-password placeholder="留空表示不修改" /></el-form-item>
        <el-form-item label="super 密码"><el-input v-model="form.superPassword" type="password" show-password placeholder="留空表示不修改" /></el-form-item>
        <el-form-item v-if="editing" label="清除凭据"><el-checkbox v-model="form.clearCredentials">删除该设备在 .env 中的登录信息</el-checkbox></el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="editDialog = false">取消</el-button>
        <el-button type="primary" size="small" @click="saveDevice">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="configDialog" title="交换机配置快照" width="70%">
      <pre class="config-text">{{ configText }}</pre>
    </el-dialog>
  </div>
</template>

<style scoped>
.mac-bar { display: flex; align-items: center; gap: 8px; padding: 12px 14px 6px; }
.mac-result { padding: 4px 14px 12px; }
.mac-match { display: flex; align-items: center; gap: 10px; padding: 7px 10px; margin-bottom: 6px; background: rgba(30,51,85,.35); border: 1px solid var(--border); border-radius: 6px; font-size: 12px; }
.mac-path { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; padding: 4px 10px 9px; font-size: 11px; }
.mac-path-arrow { color: #5a78a8; }
.mac-hop { padding: 2px 7px; border-radius: 10px; background: rgba(47,143,255,.14); border: 1px solid rgba(47,143,255,.35); color: #cfe0ff; }
.mac-hop small { color: #8aa2c8; }
.mac-role-core { background: rgba(55,211,155,.14); border-color: rgba(55,211,155,.4); color: #a7f3d0; }
.filter-bar { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--border); }
.drawer-meta { display: grid; gap: 9px; font-size: 12px; padding-bottom: 12px; }
.drawer-meta > div { display: flex; justify-content: space-between; gap: 14px; }
.drawer-meta span { color: var(--muted); flex: 0 0 76px; }
.drawer-meta b { font-weight: 500; text-align: right; white-space: nowrap; overflow: visible; text-overflow: clip; }
.drawer-section { margin-top: 16px; }
.drawer-title { font-size: 13px; font-weight: 600; margin-bottom: 9px; color: #cfe0ff; }
.config-row { display: flex; align-items: center; gap: 8px; font-size: 11px; padding: 7px 4px; border-bottom: 1px solid var(--border); }
.config-text { max-height: 60vh; overflow: auto; background: #080e1c; color: #9fd0ff; font-size: 11px; line-height: 1.5; padding: 14px; border-radius: 6px; }
.cred-divider { font-size: 12px; color: #cfe0ff; font-weight: 600; margin: 6px 0 12px 96px; padding-top: 12px; border-top: 1px solid var(--border); }

/* 抽屉内容：不换行、不裁剪、不遮盖；超宽时横向滚动兜底 */
:deep(.device-drawer) .el-drawer__body { overflow-x: auto; }
:deep(.nowrap-table) .el-table__cell .cell { white-space: nowrap; overflow: visible; text-overflow: clip; }
:deep(.nowrap-table) { width: max-content; min-width: 100%; }
</style>
