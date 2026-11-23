import net from 'node:net';
import { Client } from 'ssh2';

export const COMWARE_COMMANDS = {
  version: 'display version',
  config: 'display current-configuration',
  interfaces: 'display interface brief',
  neighbors: 'display lldp neighbor-information',
  device: 'display device'
};

const SSH_ALGORITHMS = {
  kex: [
    'curve25519-sha256', 'curve25519-sha256@libssh.org',
    'ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521',
    'diffie-hellman-group-exchange-sha256', 'diffie-hellman-group14-sha256',
    'diffie-hellman-group-exchange-sha1', 'diffie-hellman-group14-sha1',
    'diffie-hellman-group1-sha1'
  ],
  cipher: [
    'aes128-ctr', 'aes192-ctr', 'aes256-ctr',
    'aes128-cbc', 'aes192-cbc', 'aes256-cbc', '3des-cbc'
  ],
  serverHostKey: ['ssh-rsa', 'rsa-sha2-256', 'rsa-sha2-512', 'ssh-dss', 'ecdsa-sha2-nistp256']
};

const PROMPT_RE = /[>#]\s*$/;
const PASSWORD_RE = /password\s*[:：]\s*$/i;
const SUPER_FAIL_RE = /(fail|incorrect|error|denied|too many|无效|错误|失败)/i;

export function sshExec(device, sshCfg, command) {
  return new Promise((resolve) => {
    const conn = new Client();
    let output = '';
    let errorText = '';
    let done = false;
    let totalTimer = null;
    let idleTimer = null;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(totalTimer);
      clearTimeout(idleTimer);
      try { conn.end(); } catch { /* ignore */ }
      resolve({ ok, output, error: errorText });
    };

    const needSuper = !!sshCfg.superPassword;
    const timeout = Math.max(sshCfg.timeout ?? 10000, needSuper ? 30000 : 0);
    totalTimer = setTimeout(() => { errorText += '命令执行超时'; finish(false); }, timeout);

    conn.on('ready', () => {
      if (!needSuper) {
        conn.exec(command, (err, stream) => {
          if (err) { errorText += err.message; return finish(false); }
          stream.on('data', (chunk) => {
            const text = chunk.toString('utf8');
            output += text;
            if (/--\s*More\s*--/i.test(text)) {
              try { stream.write(' '); } catch { /* ignore */ }
            }
          });
          stream.stderr.on('data', (chunk) => { errorText += chunk.toString('utf8'); });
          stream.on('close', () => finish(true));
        });
        return;
      }
      conn.shell((err, stream) => {
        if (err) { errorText += err.message; return finish(false); }
        let stage = 0;
        let buffer = '';
        const armIdle = () => {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => finish(true), 1500);
        };
        stream.on('data', (chunk) => {
          const text = chunk.toString('utf8');
          buffer += text;
          if (/--\s*More\s*--/i.test(text)) {
            try { stream.write(' '); } catch { /* ignore */ }
          }
          if (stage === 0 && PROMPT_RE.test(buffer)) {
            stage = 1; buffer = '';
            stream.write('super\n');
          } else if (stage === 1 && PASSWORD_RE.test(buffer)) {
            stage = 2; buffer = '';
            stream.write(sshCfg.superPassword + '\n');
          } else if (stage === 2 && PROMPT_RE.test(buffer)) {
            if (SUPER_FAIL_RE.test(buffer)) {
              errorText += 'super 提权失败：' + buffer.trim();
              return finish(false);
            }
            stage = 3; buffer = ''; output = '';
            stream.write(command + '\n');
            armIdle();
          } else if (stage === 3) {
            output += text;
            armIdle();
          }
        });
        stream.stderr.on('data', (chunk) => { errorText += chunk.toString('utf8'); });
        stream.on('close', () => finish(stage >= 3));
      });
    });
    conn.on('error', (err) => { errorText += err.message; finish(false); });
    try {
      conn.connect({
        host: device.ip,
        port: sshCfg.port ?? 22,
        username: sshCfg.username ?? 'admin',
        password: sshCfg.password || undefined,
        readyTimeout: sshCfg.timeout ?? 10000,
        algorithms: SSH_ALGORITHMS
      });
    } catch (err) {
      errorText += err.message;
      finish(false);
    }
  });
}

export async function fetchConfig(device, sshCfg) {
  const cfg = { ...sshCfg, timeout: Math.max(sshCfg?.timeout ?? 10000, 60000) };
  const result = await sshExec(device, cfg, COMWARE_COMMANDS.config);
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
