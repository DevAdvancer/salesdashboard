export function getAppwriteErrorMessage(error: unknown): string {
  const message =
    typeof (error as { message?: unknown } | null)?.message === "string"
      ? ((error as { message: string }).message as string)
      : "Appwrite request failed";

  if (/missing scopes/i.test(message)) {
    return `${message}. Update APPWRITE_API_KEY in your server environment to use an Appwrite API key that includes the required scopes (Integrations → API Keys), then restart the server.`;
  }

  return message;
}

