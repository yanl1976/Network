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

export function getDeviceCredentials(ip, ssh = null) {
  const env = loadEnv();
  const legacy = ssh || loadConfig().ssh || {};
  const specific = ip ? deviceOverrides()[ip] : null;
  return {
    username: specific?.username ?? env.NETWORK_SSH_USERNAME ?? legacy.username ?? 'admin',
    password: specific?.password ?? env.NETWORK_SSH_PASSWORD ?? legacy.password ?? ''
  };
}

export function publicConfig(config = loadConfig()) {
  const out = JSON.parse(JSON.stringify(config));
  const creds = getDeviceCredentials(null, config.ssh);
  if (out.ssh) {
    out.ssh.username = creds.username;
    out.ssh.password = '';
    out.ssh.passwordConfigured = !!creds.password;
    out.ssh.deviceOverrides = Object.keys(deviceOverrides());
  }
  return out;
}

export const paths = { ROOT, CONFIG_FILE, TEMPLATE_FILE, ENV_FILE };
