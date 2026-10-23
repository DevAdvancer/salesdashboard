/** Bound browser work even when an SDK or a response body ignores abort signals. */
export async function withClientTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>, timeoutMs: number, message: string, parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: () => void = () => {};
  const deadline = new Promise<never>((_resolve, reject) => {
    cancel = () => {
      controller.abort();
      reject(new Error(message));
    };
    timer = setTimeout(cancel, timeoutMs);
    if (parentSignal?.aborted) cancel();
    else parentSignal?.addEventListener('abort', cancel, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new Error(message);
      return run(controller.signal);
    }), deadline]);
  } finally { clearTimeout(timer); parentSignal?.removeEventListener('abort', cancel); }
}
