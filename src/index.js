import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { loadConfig } from './config.js';
import { initialize } from './collectors/engine.js';
import { createApi } from './routes/api.js';
import { attachRealtime } from './realtime.js';
import { startScheduler } from './scheduler.js';

const configHolder = { current: loadConfig() };
const bootstrap = initialize(configHolder.current);

const app = express();
app.use(express.json({ limit: '5mb' }));

const server = http.createServer(app);
const realtime = attachRealtime(server);
app.use('/api', createApi(configHolder, realtime.broadcast));

const dist = path.resolve(import.meta.dirname, '..', 'frontend', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  app.get('/', (_req, res) => res.type('html').send('<h1>H3C 网络拓扑系统 API 已启动</h1><p>前端尚未构建，请先执行 npm run build 或使用 npm run frontend 开发模式。</p>'));
}

const scheduler = startScheduler(configHolder, realtime);

let port = Number(process.env.PORT ?? 3000);
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE' && port < 3100) {
    console.warn(`端口 ${port} 被占用，尝试 ${port + 1}`);
    port += 1;
    server.listen(port);
  } else {
    console.error('服务启动失败：', error.message);
    process.exit(1);
  }
});

server.listen(port, () => {
  console.log(`H3C 网络拓扑系统已启动: http://localhost:${port}`);
  console.log(`运行模式: ${configHolder.current.mode === 'demo' ? '演示数据' : '真实采集'} | 初始化: ${JSON.stringify(bootstrap)}`);
  console.log(`轮询间隔: ${scheduler.expression} | WebSocket: /ws`);
});

function shutdown() {
  scheduler.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
