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
