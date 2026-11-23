# H3C 网络设备动态拓扑监控系统

基于 SNMP / LLDP / SSH / 网段扫描的网络自动发现与拓扑可视化系统，面向 H3C Comware 设备。

## 功能

- **动态拓扑**：LLDP 邻居关系自动配对生成物理链路，G6 力导向图实时展示，节点颜色区分设备角色，告警设备红色高亮
- **SNMP 采集**：CPU、内存、端口状态、流量利用率、设备信息（H3C 私有 OID `1.3.6.1.4.1.25506`）
- **SSH 配置备份**：通过 `display current-configuration` 抓取配置快照，MD5 比对变更
- **网段扫描**：TCP 端口探测（161/22/80/443）自动发现资产
- **告警监控**：定时轮询、阈值判定、告警收敛、WebSocket 实时推送
- **全屏大屏**：`/screen` 三栏大屏，支持 F11 全屏，含设备分布、CPU TOP5、告警滚动

## 技术栈

后端 Node.js ESM + Express 5 + net-snmp + ssh2 + better-sqlite3 + node-cron + ws
前端 Vue 3 + Vite + Element Plus + AntV G6 + ECharts

## 快速开始

```powershell
npm install
npm --prefix frontend install
npm run build
npm start
```

浏览器打开 <http://localhost:3000>，全屏展示页为 <http://localhost:3000/screen>。

默认以**演示模式**启动，内置 19 台 H3C 设备（2 核心 / 3 汇聚 / 8 接入 / 2 边界 / 4 服务器）、21 条链路和预置告警，无需真实设备即可体验完整功能。

## 切换真实采集

1. 复制配置模板：`config/app.example.json` → `config/app.json`
2. 修改 `config/app.json`：
   - `"mode": "live"`
   - `snmp.community` / `snmp.version`：现场 SNMP 团体字与版本
   - `ssh.username` / `ssh.password`：设备 SSH 凭据
   - `devices`：现场设备清单（IP、名称、角色、型号、位置）
   - `scan.subnets`：需要扫描的网段
3. 确保设备已开启 SNMP 与 SSH（H3C 示例）：

```
snmp-agent
snmp-agent community read public
snmp-agent sys-info version v2c
ssh server enable
lldp global enable
```

4. 重启服务。系统会自动按清单轮询 SNMP，通过 LLDP MIB 构建拓扑。

也可在「系统设置」页面切换模式、调整阈值和网段（设备清单仍需改文件）。

## 关键 OID

| 用途 | OID |
|---|---|
| 系统描述 / 名称 / 运行时间 | `1.3.6.1.2.1.1.1.0` / `.5.0` / `.3.0` |
| 接口表（名称/状态/流量） | `1.3.6.1.2.1.2.2.1.*` |
| H3C CPU / 内存利用率 | `1.3.6.1.4.1.25506.2.6.1.1.1.1.6` / `.8` |
| LLDP 邻居表 | `1.0.8802.1.1.2.1.4.1.1.*` |

## REST API

`GET`：`/api/overview`、`/api/devices`、`/api/devices/:id`、`/api/topology`、`/api/alerts`、`/api/configs/:deviceId`、`/api/metrics/:deviceId`、`/api/settings`

`POST`：`/api/poll`、`/api/scan`、`/api/backup`、`/api/alerts/:id/resolve`、`/api/alerts/resolve-all`、`/api/mode`、`/api/reseed`

`PUT`：`/api/settings`

WebSocket：`/ws`（推送 `poll:done`、`alert:*`、`mode:changed` 等事件）

## 目录

```
config/app.example.json   配置模板（首次启动自动复制为 app.json）
src/collectors/           SNMP/LLDP、SSH、扫描、演示数据、采集编排
src/services/view.js      拓扑与指标查询视图
src/routes/api.js         REST 接口
src/index.js              服务入口
frontend/src/views/       拓扑、设备、告警、设置、全屏大屏
data/network.db           SQLite 数据（已 gitignore）
```

## 已知边界

- 演示模式数据为模拟生成，切换真实模式后需重新轮询
- 真实模式下拓扑完整性依赖设备开启 LLDP；不支持 LLDP 的哑设备需人工补链路
- 网段扫描为 TCP 端口探测，跨网段需保证路由可达并遵守内网安全规范
- 告警按设备类型收敛（同类告警同设备只保留一条活动记录）
