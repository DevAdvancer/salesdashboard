import pino from 'pino';
import { createPinoBrowserSend, createWriteStream } from 'pino-logflare';

const apiKey = process.env.LOGFLARE_API_KEY || process.env.NEXT_PUBLIC_LOGFLARE_API_KEY || '';
const sourceToken = process.env.LOGFLARE_SOURCE_TOKEN || process.env.NEXT_PUBLIC_LOGFLARE_SOURCE_TOKEN || '';

const isEnabled = Boolean(apiKey && sourceToken);

let stream;
let send;

if (isEnabled) {
  // Try/catch just in case we are in an environment where createWriteStream fails
  try {
    stream = createWriteStream({
      apiKey,
      sourceToken
    });
  } catch (e) {
    // ignore
  }

  try {
    send = createPinoBrowserSend({
      apiKey,
      sourceToken
    });
  } catch (e) {
    // ignore
  }
}

export const logger = pino(
  {
    browser: {
      transmit: send ? {
        level: 'info',
        send: send,
      } : undefined
    },
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    base: {
      env: process.env.NODE_ENV,
      revision: process.env.VERCEL_GITHUB_COMMIT_SHA,
    },
  },
  stream
);

export default logger;
