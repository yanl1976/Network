import net from 'node:net';
import { Client } from 'ssh2';

export const COMWARE_COMMANDS = {
  version: 'display version',
  config: 'display current-configuration',
  interfaces: 'display interface brief',
  neighbors: 'display lldp neighbor-information',
  device: 'display device'
};

export function sshExec(device, sshCfg, command) {
  return new Promise((resolve) => {
    const conn = new Client();
    let output = '';
    let errorText = '';
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { conn.end(); } catch { /* ignore */ }
      resolve({ ok, output, error: errorText });
    };
    const timer = setTimeout(() => { errorText += '命令执行超时'; finish(false); }, sshCfg.timeout ?? 10000);

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) { clearTimeout(timer); errorText += err.message; return finish(false); }
        stream.on('data', (chunk) => { output += chunk.toString('utf8'); });
        stream.stderr.on('data', (chunk) => { errorText += chunk.toString('utf8'); });
        stream.on('close', () => { clearTimeout(timer); finish(true); });
      });
    });
    conn.on('error', (err) => { clearTimeout(timer); errorText += err.message; finish(false); });
    try {
      conn.connect({
        host: device.ip,
        port: sshCfg.port ?? 22,
        username: sshCfg.username ?? 'admin',
        password: sshCfg.password || undefined,
        readyTimeout: sshCfg.timeout ?? 10000
      });
    } catch (err) {
      clearTimeout(timer);
      errorText += err.message;
      finish(false);
    }
  });
}

export async function fetchConfig(device, sshCfg) {
  const result = await sshExec(device, sshCfg, COMWARE_COMMANDS.config);
  return { ...result, ip: device.ip };
}

function ipToInt(ip) {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function intToIp(value) {
  return [(value >>> 24), (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

function expandCidr(cidr) {
  const [ip, bitsRaw] = cidr.split('/');
  const bits = bitsRaw ? Number(bitsRaw) : 32;
  if (!ip || Number.isNaN(bits) || bits < 0 || bits > 32) return [];
  const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
  const base = (ipToInt(ip) & mask) >>> 0;
  const count = 2 ** (32 - bits);
  return Array.from({ length: Math.min(count, 65536) }, (_, i) => intToIp((base + i) >>> 0));
}

function probePort(ip, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    try { socket.connect(port, ip); } catch { done(false); }
  });
}

export async function scanSubnets(scanCfg) {
  const targets = [...new Set((scanCfg.subnets ?? []).flatMap(expandCidr))];
  const ports = scanCfg.ports ?? [22, 161];
  const timeoutMs = scanCfg.timeoutMs ?? 600;
  const concurrency = scanCfg.concurrency ?? 64;
  const results = [];
  let cursor = 0;

  async function worker() {
    while (cursor < targets.length) {
      const ip = targets[cursor++];
      const flags = await Promise.all(ports.map((p) => probePort(ip, p, timeoutMs)));
      const openPorts = ports.filter((_, i) => flags[i]);
      if (openPorts.length) {
        results.push({
          ip,
          openPorts,
          guess: openPorts.includes(161) ? 'network' : openPorts.includes(22) ? 'linux' : 'http'
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  return { scanned: targets.length, found: results.sort((a, b) => ipToInt(a.ip) - ipToInt(b.ip)) };
}
