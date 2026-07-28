import pino from 'pino';

const apiKey = process.env.LOGFLARE_API_KEY || process.env.NEXT_PUBLIC_LOGFLARE_API_KEY || '';
const sourceToken = process.env.LOGFLARE_SOURCE_TOKEN || process.env.NEXT_PUBLIC_LOGFLARE_SOURCE_TOKEN || '';

const isEnabled = Boolean(apiKey && sourceToken);

export const logger = pino(
  {
    browser: {
      asObject: true
    },
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    base: {
      env: process.env.NODE_ENV,
      revision: process.env.VERCEL_GITHUB_COMMIT_SHA,
    },
    ...(isEnabled && typeof window === 'undefined'
      ? {
          transport: {
            target: 'pino-logflare',
            options: {
              apiKey,
              sourceToken,
            },
          },
        }
      : {}),
  }
);

export default logger;

