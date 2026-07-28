import { logger } from './lib/logger';

async function main() {
  console.log('Sending log to Logflare...');
  logger.info({ test: true, event_message: "Test message from script" }, 'This is a test log via pino-logflare transport');
  
  // wait a bit for the transport to flush
  await new Promise(resolve => setTimeout(resolve, 3000));
  console.log('Done');
}

main();
