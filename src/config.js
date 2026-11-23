import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CONFIG_FILE = path.join(ROOT, 'config', 'app.json');
const TEMPLATE_FILE = path.join(ROOT, 'config', 'app.example.json');
const ENV_FILE = path.join(ROOT, '.env');

function deepMerge(base, patch) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      out[key] = deepMerge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

let envCache = null;
let envMtime = -1;

function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadEnv() {
  try {
    const stat = fs.statSync(ENV_FILE);
    if (envCache && stat.mtimeMs === envMtime) return envCache;
    envCache = parseEnv(fs.readFileSync(ENV_FILE, 'utf8'));
    envMtime = stat.mtimeMs;
  } catch {
    envCache = {};
    envMtime = -1;
  }
  return envCache;
}

export function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.copyFileSync(TEMPLATE_FILE, CONFIG_FILE);
  }
  const template = JSON.parse(fs.readFileSync(TEMPLATE_FILE, 'utf8'));
  const current = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  return deepMerge(template, current);
}

function stripCredentials(config) {
  const out = JSON.parse(JSON.stringify(config));
  if (out.ssh) {
    delete out.ssh.username;
    delete out.ssh.password;
  }
  return out;
}

export function saveConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(stripCredentials(config), null, 2) + '\n', 'utf8');
}

export function updateSettings(patch) {
  const next = deepMerge(loadConfig(), patch);
  const stored = stripCredentials(next);
  saveConfig(stored);
  return stored;
}

function deviceOverrides() {
  try { return JSON.parse(loadEnv().NETWORK_SSH_DEVICES || '{}') || {}; }
  catch { return {}; }
}

function saveDeviceOverrides(overrides) {
  const text = fs.readFileSync(ENV_FILE, 'utf8');
  const line = `NETWORK_SSH_DEVICES=${JSON.stringify(overrides)}`;
  if (/^NETWORK_SSH_DEVICES=.*$/m.test(text)) {
    fs.writeFileSync(ENV_FILE, text.replace(/^NETWORK_SSH_DEVICES=.*$/m, line), 'utf8');
  } else {
    fs.writeFileSync(ENV_FILE, text.replace(/\s*$/, '') + '\n' + line + '\n', 'utf8');
  }
  envCache = null;
  envMtime = -1;
}

export function getManagedDevices() {
  const config = loadConfig();
  const overrides = deviceOverrides();
  return (config.devices || []).map((d) => ({
    ...d,
    credentialsConfigured: !!overrides[d.ip]
  }));
}

function validateDevice(input, existingIp = null) {
  if (!input || typeof input !== 'object') throw new Error('设备参数无效');
  const ip = String(input.ip ?? '').trim();
  const name = String(input.name ?? '').trim();
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || ip.split('.').some((n) => Number(n) > 255)) throw new Error('管理 IP 格式无效');
  if (!name) throw new Error('设备名称不能为空');
  const config = loadConfig();
  if ((config.devices || []).some((d) => d.ip === ip && d.ip !== existingIp)) throw new Error(`设备 ${ip} 已存在`);
  const role = String(input.role ?? 'access');
  const type = String(input.type ?? 'switch');
  if (!['core', 'aggregation', 'access', 'border', 'server'].includes(role)) throw new Error('设备角色无效');
  if (!['switch', 'firewall', 'router', 'server'].includes(type)) throw new Error('设备类型无效');
  return {
    ip,
    name,
    role,
    type,
    model: String(input.model ?? '').trim(),
    location: String(input.location ?? '').trim()
  };
}

function extractCredentials(input) {
  const out = {};
  for (const key of ['username', 'password', 'superPassword']) {
    const value = input?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') out[key] = String(value).trim();
  }
  return out;
}

export function addDevice(input) {
  const device = validateDevice(input);
  const config = loadConfig();
  config.devices = [...(config.devices || []), device];
  saveConfig(config);
  const creds = extractCredentials(input);
  if (Object.keys(creds).length) {
    const overrides = deviceOverrides();
    overrides[device.ip] = { ...(overrides[device.ip] || {}), ...creds };
    saveDeviceOverrides(overrides);
  }
  return { ...device, credentialsConfigured: Object.keys(creds).length > 0 };
}

export function updateDevice(ip, input) {
  const config = loadConfig();
  const idx = (config.devices || []).findIndex((d) => d.ip === ip);
  if (idx < 0) throw new Error(`设备 ${ip} 不存在`);
  const device = validateDevice({ ...input, ip }, ip);
  config.devices[idx] = device;
  saveConfig(config);

  const creds = extractCredentials(input);
  if (Object.keys(creds).length) {
    const overrides = deviceOverrides();
    overrides[ip] = { ...(overrides[ip] || {}), ...creds };
    saveDeviceOverrides(overrides);
  }
  if (input.clearCredentials) {
    const overrides = deviceOverrides();
    delete overrides[ip];
    saveDeviceOverrides(overrides);
  }
  return { ...device, credentialsConfigured: !!deviceOverrides()[ip] };
}

export function removeDevice(ip) {
  const config = loadConfig();
  config.devices = (config.devices || []).filter((d) => d.ip !== ip);
  saveConfig(config);
  const overrides = deviceOverrides();
  if (overrides[ip]) {
    delete overrides[ip];
    saveDeviceOverrides(overrides);
  }
  return { removed: ip };
}

export function getDeviceCredentials(ip, ssh = null) {
  const env = loadEnv();
  const legacy = ssh || loadConfig().ssh || {};
  const specific = ip ? deviceOverrides()[ip] : null;
  return {
    username: specific?.username ?? env.NETWORK_SSH_USERNAME ?? legacy.username ?? 'admin',
    password: specific?.password ?? env.NETWORK_SSH_PASSWORD ?? legacy.password ?? '',
    superPassword: specific?.superPassword ?? env.NETWORK_SSH_SUPER_PASSWORD ?? ''
  };
}

export function publicConfig(config = loadConfig()) {
  const out = JSON.parse(JSON.stringify(config));
  const creds = getDeviceCredentials(null, config.ssh);
  if (out.ssh) {
    out.ssh.username = creds.username;
    out.ssh.password = '';
    out.ssh.passwordConfigured = !!creds.password;
    out.ssh.superPasswordConfigured = !!creds.superPassword;
    out.ssh.deviceOverrides = Object.keys(deviceOverrides());
  }
  return out;
}

export const paths = { ROOT, CONFIG_FILE, TEMPLATE_FILE, ENV_FILE };
