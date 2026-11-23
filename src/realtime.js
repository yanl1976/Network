import { WebSocketServer } from 'ws';

export function attachRealtime(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Set();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'connected', at: new Date().toISOString() }));
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  return {
    broadcast(message) {
      const payload = JSON.stringify({ ...message, at: new Date().toISOString() });
      for (const ws of clients) {
        if (ws.readyState === 1) {
          try { ws.send(payload); } catch { /* ignore */ }
        }
      }
    },
    get size() { return clients.size; }
  };
}
