import { readErrorResponseMessage } from '@/lib/utils/http-error-response';

function makeResponse({
  contentType = '',
  json,
  text,
}: {
  contentType?: string;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}): Response {
  return {
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    json: json ?? jest.fn(),
    text: text ?? jest.fn(),
  } as unknown as Response;
}

describe('readErrorResponseMessage', () => {
  it('falls back when the response body is empty', async () => {
    const response = makeResponse({
      contentType: 'application/json',
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    });

    await expect(readErrorResponseMessage(response, 'Failed to send email')).resolves.toBe(
      'Failed to send email'
    );
  });

  it('reads an error message from a JSON response', async () => {
    const response = makeResponse({
      contentType: 'application/json',
      json: async () => ({ error: { message: 'Access token has expired.' } }),
    });

    await expect(readErrorResponseMessage(response, 'Failed to send email')).resolves.toBe(
      'Access token has expired.'
    );
  });

  it('reads a plain text response without throwing a JSON parse error', async () => {
    const response = makeResponse({
      contentType: 'text/plain',
      text: async () => 'Request payload is too large',
    });

    await expect(readErrorResponseMessage(response, 'Failed to send email')).resolves.toBe(
      'Request payload is too large'
    );
  });
});
