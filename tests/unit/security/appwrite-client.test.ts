/** @jest-environment node */
jest.mock('node-appwrite', () => ({ Client: class {
  config = { selfSigned: false };
  headers: Record<string, string> = {};
  prepareRequest(method: string, url: URL) {
    return { uri: url.toString(), options: { method, headers: { ...this.headers }, dispatcher: { sdk: true }, agent: { sdk: true } } };
  }
} }));
import { ServerAppwriteClient } from '@/lib/server/appwrite-client';

it('uses the native connection pool while keeping credentials on each fresh request', () => {
  const one = new ServerAppwriteClient(); const two = new ServerAppwriteClient();
  one.headers = { 'X-Appwrite-JWT': 'session-one' }; two.headers = { 'X-Appwrite-JWT': 'session-two' };
  const request = one.prepareRequest('GET', new URL('https://appwrite.example/v1/account'));
  expect(request.options).not.toHaveProperty('dispatcher');
  expect(request.options).not.toHaveProperty('agent');
  expect(request.options.headers).toEqual({ 'X-Appwrite-JWT': 'session-one' });
  expect(two.prepareRequest('GET', new URL('https://appwrite.example/v1/account')).options.headers)
    .toEqual({ 'X-Appwrite-JWT': 'session-two' });
  expect(one.prepareRequest('GET', new URL('https://appwrite.example/v1/account'))).not.toBe(request);
});

it('preserves explicit self-signed transport configuration', () => {
  const client = new ServerAppwriteClient(); client.config.selfSigned = true;
  expect(client.prepareRequest('GET', new URL('https://appwrite.example/v1/account')).options).toHaveProperty('dispatcher');
});

it('replaces an SDK default header instead of sending a second, differently cased copy', () => {
  const client = new ServerAppwriteClient();
  client.headers = { 'X-Appwrite-Response-Format': '1.6.0', 'x-sdk-name': 'Node.js' };
  client.addHeader('X-Appwrite-Response-Format', '1.9.0').addHeader('X-Appwrite-Impersonate-User-Id', 'target');
  expect(client.prepareRequest('GET', new URL('https://appwrite.example/v1/account')).options.headers).toEqual({
    'X-Appwrite-Response-Format': '1.9.0', 'x-sdk-name': 'Node.js', 'X-Appwrite-Impersonate-User-Id': 'target' });
});
