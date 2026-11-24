# H3C 网络设备动态拓扑监控系统

基于 SNMP / LLDP / SSH / 网段扫描的网络自动发现与拓扑可视化系统，面向 H3C Comware 设备。

## 功能

- **动态拓扑**：LLDP 邻居关系自动配对生成物理链路，G6 力导向图实时展示，节点颜色区分设备角色，告警设备红色高亮；右侧详情集中展示 CPU/内存、24h 性能趋势与实时流量，并支持一键跳转到设备清单
- **SNMP 采集**：CPU、内存、端口状态、流量利用率、设备信息（H3C 私有 OID `1.3.6.1.4.1.25506`）
- **MAC 全网定位**：批量采集全网交换机 FDB 落库，支持完整 MAC 或任意片段（如 `46:47`）查询，展示接入交换机与逐级上联路径
- **网络工具**：网内 MAC 明细列表、一键定位、端口连通性探测
- **设备清单抽屉**：按交换机前面板样式展示物理端口（自动过滤逻辑口），IRF 堆叠/多槽位设备按成员→机框→端口类型分区，状态灯区分 UP/DOWN/上联，点击端口高亮链路，可切换表格视图；同时提供链路、配置备份与告警记录
- **界面显示自定义**：系统设置中自定义侧栏标题/副标题、大屏标题/副标题与浏览器标签标题，保存后立即生效
- **SSH 配置备份**：通过 `display current-configuration` 抓取配置快照，MD5 比对变更
- **网段扫描**：TCP 端口探测（161/22/80/443）自动发现资产
- **告警监控**：定时轮询、阈值判定、告警收敛、WebSocket 实时推送
- **全屏大屏**：`/screen` 大屏，支持 F11 全屏，含设备分布、CPU TOP5、告警滚动

## 技术栈

后端 Node.js ESM + Express 5 + net-snmp + ssh2 + better-sqlite3 + node-cron + ws
前端 Vue 3 + Vite + Element Plus + AntV G6 + ECharts

## 快速开始

首次部署准备依赖与前端构建（一次性）：

```powershell
npm install
npm --prefix frontend install
npm run build
```

之后用 **1 条命令** 启动整套系统（API + WebSocket + 前端，单进程）：

```powershell
pm2 start ecosystem.config.cjs
```

`src/index.js` 自身已托管 `frontend/dist`，无需单独起前端服务。默认端口 `3200`，被占用时自动 +1 递增。

常用 pm2 运维：

```powershell
pm2 list                    # 查看进程
pm2 logs h3c-network        # 实时日志
pm2 restart h3c-network     # 重启
pm2 stop h3c-network        # 停止
pm2 delete h3c-network      # 移除托管
pm2 save && pm2 resurrect   # 保存/恢复进程列表
```

不使用 pm2 时直接 `npm start` 亦可。

浏览器打开 <http://localhost:3200>，全屏展示页为 <http://localhost:3200/screen>。

默认以**演示模式**启动，内置 19 台 H3C 设备（2 核心 / 3 汇聚 / 8 接入 / 2 边界 / 4 服务器）、21 条链路和预置告警，无需真实设备即可体验完整功能。

## 切换真实采集

1. 复制配置模板：`config/app.example.json` → `config/app.json`
2. 修改 `config/app.json`：
   - `"mode": "live"`
   - `snmp.community` / `snmp.version`：现场 SNMP 团体字与版本（安全起见 `/api/settings` 不返回团体字明文，只返回是否已配置；在设置页留空保存即保持不变，需改则填写新值）
   - SSH 登录凭据写在项目根目录 `.env`（参照 `.env.example`）：`NETWORK_SSH_USERNAME` / `NETWORK_SSH_PASSWORD` 为全局默认，`NETWORK_SSH_DEVICES` 可按设备 IP 单独配置；界面只显示脱敏状态，配置后需重启服务
   - `devices`：现场设备清单（IP、名称、角色、型号、位置），`type` 可选 `switch`/`firewall`/`router`/`server`，决定拓扑图上的专用设备图标
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

也可在「系统设置」页面切换模式、调整阈值和网段、自定义界面显示标题（侧栏/大屏/浏览器标签）（设备清单仍需改文件）。

## 关键 OID

| 用途 | OID |
|---|---|
| 系统描述 / 名称 / 运行时间 | `1.3.6.1.2.1.1.1.0` / `.5.0` / `.3.0` |
| 接口表（名称/状态/流量） | `1.3.6.1.2.1.2.2.1.*` |
| H3C CPU / 内存利用率 | `1.3.6.1.4.1.25506.2.6.1.1.1.1.6` / `.8` |
| LLDP 邻居表 | `1.0.8802.1.1.2.1.4.1.1.*` |

## REST API

`GET`：`/api/overview`、`/api/devices`、`/api/devices/:id`、`/api/topology`、`/api/alerts`、`/api/configs/:deviceId`、`/api/metrics/:deviceId`、`/api/settings`、`/api/mac-entries`（MAC 明细）、`/api/mac-lookup`（MAC 定位，支持任意片段）

`POST`：`/api/poll`、`/api/scan`、`/api/backup`、`/api/alerts/:id/resolve`、`/api/alerts/resolve-all`、`/api/mode`、`/api/reseed`、`/api/mac-collect`（采集全网 MAC）、`/api/tools/port-check`（端口探测）

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

## 图标来源

拓扑节点使用 Cisco 经典彩色图标（亮青蓝 3D 方块 + 白色设备符号），原图 JPG 存放于 `01-color-jpg/`，已转换为透明底 PNG 放在 `frontend/src/assets/icons/`（switch-l3 / switch-l2 / router / firewall / server）。图标由 Vite 打包为静态资源，不产生外部请求。

## 安全说明

- **凭据存放**：SNMP 团体字在 `config/app.json`，SSH 账号密码在项目根 `.env`；两者均已 gitignore。文档中的凭据一律用占位符表示，禁止写入明文。
- **接口脱敏**：`/api/settings` 不返回 SNMP 团体字明文（只回 `communityConfigured` 标志），SSH 只回布尔配置标志与设备覆盖项名称，不回密码。
- **配置保存**：在设置页留空团体字保存表示「不修改」，后端会保留已配置的真实值；需更换时填写新值。
- **API 无鉴权**：当前 REST API 未做身份认证，仅限内网可信环境使用；如需暴露到更大范围，请先增加 token/Basic Auth 等鉴权。
- **历史重写**：2026-11-24 曾用 `git filter-repo` 清除 git 历史中的明文凭据并 force push `main`。已 clone 过旧仓库的机器需 `git reset --hard origin/main` 或重新 clone，否则 pull 会因分叉失败。

## 已知边界

- 演示模式数据为模拟生成，切换真实模式后需重新轮询
- 真实模式下拓扑完整性依赖设备开启 LLDP；不支持 LLDP 的哑设备需人工补链路
- 网段扫描为 TCP 端口探测，跨网段需保证路由可达并遵守内网安全规范
- 告警按设备类型收敛（同类告警同设备只保留一条活动记录）
- MAC 定位依赖设备 FDB（dot1d/dot1q）可读取，且需先执行「采集全网 MAC」才有明细可查；上联路径由 LLDP 链路推算，无 LLDP 的跳点无法追溯
