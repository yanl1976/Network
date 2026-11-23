import { loadConfig } from './config.js';
import { pollOnce, scanOnce, backupConfigs } from './collectors/engine.js';
import { seedDemo } from './collectors/demo.js';

const config = loadConfig();
const command = process.argv[2];

async function main() {
  if (command === 'poll') console.log(JSON.stringify(await pollOnce(config), null, 2));
  else if (command === 'scan') console.log(JSON.stringify(await scanOnce(config), null, 2));
  else if (command === 'backup') console.log(JSON.stringify(await backupConfigs(config, process.argv.slice(3)), null, 2));
  else if (command === 'seed') { seedDemo(config); console.log('演示数据已重新生成'); }
  else console.log('用法: node src/cli.js <poll|scan|backup|seed> [设备IP...]');
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => process.exit(process.exitCode ?? 0));
