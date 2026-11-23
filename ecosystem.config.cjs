// PM2 单进程启动配置
// src/index.js 同时提供 REST API / WebSocket / 前端 frontend/dist，一条命令启动全套服务。
// 启动：pm2 start ecosystem.config.cjs
// 首次部署需先装依赖并构建前端：npm install && npm --prefix frontend install && npm run build
module.exports = {
  apps: [
    {
      name: 'h3c-network',
      script: 'src/index.js',
      cwd: __dirname,
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: 3200
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      time: true
    }
  ]
};
