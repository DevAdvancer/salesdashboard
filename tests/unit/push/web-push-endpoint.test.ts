import { isAllowedPushEndpoint, isPushKey } from '@/lib/utils/web-push-endpoint';

it('accepts the real browser push services', () => {
  for (const url of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QGxx', 'https://wns2-par02p.notify.windows.com/w/?token=abc']) {
    expect(isAllowedPushEndpoint(url)).toBe(true);
  }
});
it('rejects anything the server should not call', () => {
  for (const url of ['http://fcm.googleapis.com/fcm/send/abc', 'https://fcm.googleapis.com.evil.example/x',
    'https://evil.example/fcm.googleapis.com', 'https://user:pw@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x',
    'https://169.254.169.254/latest', 'https://localhost/x', 'javascript:alert(1)', '', 42, null,
    `https://fcm.googleapis.com/${'a'.repeat(2100)}`]) {
    expect(isAllowedPushEndpoint(url)).toBe(false);
  }
});
it('accepts only bounded base64url keys', () => {
  expect(isPushKey('BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQ', 256)).toBe(true);
  expect(isPushKey('a b', 256)).toBe(false);
  expect(isPushKey('a'.repeat(65), 64)).toBe(false);
  expect(isPushKey(undefined, 64)).toBe(false);
});
