# 容器部署说明（生产服务器 192.168.20.31）

## 前置：安装 Docker（手工执行）

当前 apt 源没有 `docker-compose-plugin` 包，用官方二进制单独装：

```bash
sudo apt-get update
sudo apt-get install -y docker.io

sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -SL "https://github.com/docker/compose/releases/download/v2.29.2/docker-compose-linux-x86_64" -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

sudo usermod -aG docker $USER
sudo systemctl enable --now docker
newgrp docker

docker --version
docker compose version
docker run hello-world
```

若 GitHub 下载不通，备选：`sudo apt-get install -y docker-compose`（v1，命令为 `docker-compose` 带横线，下文命令相应替换）。

## 上传项目到 /opt/Network/

在开发机执行（从项目根目录）：

```powershell
# 用 scp 或 sftp 上传以下文件到服务器 /opt/Network/：
#   Dockerfile.backend, Dockerfile.frontend, docker-compose.yml, nginx.conf, .dockerignore
#   package.json, package-lock.json, src/, frontend/src/, frontend/package.json,
#   frontend/package-lock.json, frontend/vite.config.js, frontend/index.html
#   config/app.example.json
#   .env（含真实凭据，注意保护）
#   data/（现有 SQLite 数据，保留历史；如全新部署可不传）
```

服务器侧建目录：

```bash
sudo mkdir -p /opt/Network
sudo chown -R yl:yl /opt/Network
```

## 首次部署

```bash
cd /opt/Network
docker compose up -d --build
docker compose ps
```

## 放行防火墙端口

```bash
sudo ufw allow 3200/tcp
sudo ufw allow 3201/tcp
```

## 访问

- 前端界面：<http://192.168.20.31:3201>
- 后端 API：<http://192.168.20.31:3200/api/overview>（直接访问调试用）
- 全屏大屏：<http://192.168.20.31:3201/screen>

前端通过 nginx 反向代理 `/api` 和 `/ws` 到后端，无需改前端代码。

## 数据持久化

以下目录/文件挂载到容器外，容器重建不丢数据：
- `./data` → SQLite 数据库、采集数据
- `./config` → app.json（设备清单、设置）
- `./.env` → SSH/SNMP 凭据（可写，界面增删改设备会同步）

## 常用运维命令

```bash
cd /opt/Network

docker compose logs -f backend      # 看后端日志
docker compose logs -f frontend     # 看前端日志
docker compose restart backend      # 重启后端
docker compose down                 # 停止（不删数据）
docker compose up -d                # 启动
docker compose up -d --build        # 改代码后重新构建
docker compose exec backend sh      # 进后端容器
```

## 网络连通性说明

容器用 bridge 网络，通过宿主机 NAT 访问 192.168.30.10 等 SNMP/SSH 设备。若设备 ACL 限制源 IP 导致采集失败，改用 host 网络：

```yaml
# docker-compose.yml 中 backend 服务加一行，去掉 ports 映射
network_mode: host
```

然后前端 nginx 的 upstream 从 `backend:3200` 改为 `127.0.0.1:3200`（host 模式下无容器 DNS）。

## 与现有服务的关系

- 容器端口 3200/3201 与现有 3000/3010/3030/3100/3130 不冲突
- 不动 MySQL(3306)/Redis(6379)/PM2 现有服务
- 全程不需要重启服务器
