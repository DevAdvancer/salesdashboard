// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

if (typeof global.Request === 'undefined') {
  // @ts-ignore
  global.Request = globalThis.Request;
}
if (typeof global.Response === 'undefined') {
  // @ts-ignore
  global.Response = globalThis.Response;
}
if (typeof global.Headers === 'undefined') {
  // @ts-ignore
  global.Headers = globalThis.Headers;
}
