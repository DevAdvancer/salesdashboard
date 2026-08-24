export const logger = {
  info: (...args: unknown[]) => {
    // eslint-disable-next-line no-console
    console.log(new Date().toISOString(), '[INFO]', ...args);
  },
  warn: (...args: unknown[]) => {
    console.warn(new Date().toISOString(), '[WARN]', ...args);
  },
  error: (...args: unknown[]) => {
    console.error(new Date().toISOString(), '[ERROR]', ...args);
  },
  debug: (...args: unknown[]) => {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.debug(new Date().toISOString(), '[DEBUG]', ...args);
    }
  }
};
