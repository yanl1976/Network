import cron from 'node-cron';
import { pollOnce } from './collectors/engine.js';

function toExpression(seconds) {
  const sec = Math.max(5, Number(seconds) || 60);
  if (sec >= 60 && sec % 60 === 0) return `*/${sec / 60} * * * *`;
  return `*/${sec} * * * * *`;
}

export function startScheduler(configHolder, realtime) {
  let running = false;
  let task = null;
  let expression = null;

  async function run() {
    if (running) return null;
    running = true;
    try {
      const result = await pollOnce(configHolder.current);
      realtime.broadcast({ type: 'poll:done', result });
      return result;
    } catch (error) {
      realtime.broadcast({ type: 'poll:error', message: error.message });
      return null;
    } finally {
      running = false;
    }
  }

  function schedule() {
    const next = toExpression(configHolder.current.poll.intervalSec);
    if (task && expression === next) return;
    task?.stop();
    expression = next;
    task = cron.schedule(next, run, { noOverlap: true });
  }

  schedule();
  return { run, schedule, stop: () => task?.stop(), get expression() { return expression; } };
}
