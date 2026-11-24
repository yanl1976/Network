import { createRouter, createWebHistory } from 'vue-router';
import Topology from './views/Topology.vue';
import Devices from './views/Devices.vue';
import Alerts from './views/Alerts.vue';
import Settings from './views/Settings.vue';
import Tools from './views/Tools.vue';
import Compliance from './views/Compliance.vue';
import Report from './views/Report.vue';
import Screen from './views/Screen.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/topology' },
    { path: '/topology', component: Topology, meta: { title: '网络拓扑' } },
    { path: '/devices', component: Devices, meta: { title: '设备清单' } },
    { path: '/alerts', component: Alerts, meta: { title: '告警中心' } },
    { path: '/settings', component: Settings, meta: { title: '系统设置' } },
    { path: '/tools', component: Tools, meta: { title: '网络工具' } },
    { path: '/compliance', component: Compliance, meta: { title: '合规巡检' } },
    { path: '/report', component: Report, meta: { title: '巡检报告' } },
    { path: '/screen', component: Screen, meta: { title: '全屏展示', fullscreen: true } }
  ]
});
