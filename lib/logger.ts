import pino from 'pino';

const apiKey = process.env.LOGFLARE_API_KEY || process.env.NEXT_PUBLIC_LOGFLARE_API_KEY || '';
const sourceToken = process.env.LOGFLARE_SOURCE_TOKEN || process.env.NEXT_PUBLIC_LOGFLARE_SOURCE_TOKEN || '';

const isEnabled = Boolean(apiKey && sourceToken);

const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

const customStream = {
  write: (msg: string) => {
    // Keep local logs for debugging and local dev
    if (process.env.NODE_ENV !== 'production') {
      process.stdout.write(msg);
    }
    
    if (isEnabled && typeof fetch !== 'undefined') {
      try {
        const logObj = JSON.parse(msg);
        fetch(`https://api.logflare.app/logs/json?source=${sourceToken}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': apiKey
          },
          // Logflare accepts an array of events
          body: JSON.stringify([logObj]),
          // keepalive ensures the request finishes even if the Vercel serverless function exits
          keepalive: true
        }).catch(() => {
          // Ignore network errors to avoid crashing
        });
      } catch (e) {
        // Ignore parse errors
      }
    }
  }
};

export const logger = pino(
  {
    browser: {
      asObject: true,
      write: (opts) => {
         // Optionally handle browser logs if needed, but for now serverless is the priority
      }
    },
    messageKey: 'event_message',
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    mixin() {
      return { id: generateId() };
    },
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    base: {
      env: process.env.NODE_ENV,
      revision: process.env.VERCEL_GITHUB_COMMIT_SHA,
    }
  },
  customStream
);

export default logger;



