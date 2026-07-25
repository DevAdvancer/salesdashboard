// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Request / Response / Headers are deliberately NOT installed. This file used
// to copy them off globalThis, which was a silent no-op because jsdom does not
// define them either. Installing undici's versions instead is not an option:
// undici reaches for ReadableStream and other web globals jsdom lacks, and
// requiring it fails the whole suite at setup.
//
// Nothing needs them today. No test constructs a Request or Response, and the
// fetch mock below returns a plain object rather than a real Response. A test
// that needs one should build it locally rather than reintroducing a global.

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
