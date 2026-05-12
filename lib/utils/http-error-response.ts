type ErrorPayload = {
  error?: string | { message?: string };
  message?: string;
};

function messageFromPayload(payload: ErrorPayload): string | undefined {
  if (typeof payload.error === "string") return payload.error;
  if (payload.error?.message) return payload.error.message;
  return payload.message;
}

export async function readErrorResponseMessage(
  response: Response,
  fallbackMessage: string
): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as ErrorPayload;
      return messageFromPayload(payload) || fallbackMessage;
    }

    const text = await response.text();
    return text.trim() || fallbackMessage;
  } catch {
    return fallbackMessage;
  }
}
