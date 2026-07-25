// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Request / Response / Headers are installed from undici in jest.env.js, which
// runs before this file. Copying them off globalThis here was a no-op because
// jsdom does not define them in the first place.

// The suite must never perform real network I/O. Application code calls fetch
// for its own API routes (for example clearServerSession in
// lib/contexts/auth-context.tsx), which under jsdom threw
// "ReferenceError: fetch is not defined" and failed the test before it reached
// its assertions. A default mock makes those calls succeed quietly; any test
// that cares about the response overrides it with its own mockResolvedValue.
beforeEach(() => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => '',
    })
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});
