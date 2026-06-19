const nextJest = require('next/jest');

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
});

// Add any custom config to be passed to Jest
const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    // `next/cache` transitively loads next/src/server/web/spec-extension
    // which uses `class extends Request` from the web fetch APIs. jsdom
    // supports these globals, but the chain pulls in node-fetch ESM
    // modules the test environment can't resolve cleanly. Stubbing
    // `next/cache` here is the standard next/jest workaround — production
    // behavior is untouched because Next.js wires the real
    // `unstable_cache` / `revalidateTag` for Server Components and Server
    // Actions at runtime.
    '^next/cache$': '<rootDir>/tests/__mocks__/next-cache.ts',
  },
  testMatch: [
    '<rootDir>/tests/**/*.test.ts',
    '<rootDir>/tests/**/*.test.tsx',
  ],
  collectCoverageFrom: [
    'lib/**/*.{js,jsx,ts,tsx}',
    'app/**/*.{js,jsx,ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/.next/**',
  ],
};

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = createJestConfig(customJestConfig);
