import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CONFIG_FILE = path.join(ROOT, 'config', 'app.json');
const TEMPLATE_FILE = path.join(ROOT, 'config', 'app.example.json');

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

export function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.copyFileSync(TEMPLATE_FILE, CONFIG_FILE);
  }
  const template = JSON.parse(fs.readFileSync(TEMPLATE_FILE, 'utf8'));
  const current = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  return deepMerge(template, current);
}

export function saveConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

export function updateSettings(patch) {
  const config = loadConfig();
  const next = deepMerge(config, patch);
  saveConfig(next);
  return next;
}

export const paths = { ROOT, CONFIG_FILE, TEMPLATE_FILE };
