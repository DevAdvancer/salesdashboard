import { createInFlightGroup } from '@/lib/utils/in-flight';
it('shares only pending work and revalidates after success or failure', async () => {
  const share = createInFlightGroup(); const load = jest.fn().mockResolvedValue('fresh');
  await Promise.all(Array.from({ length: 20 }, () => share('credential', load)));
  expect(load).toHaveBeenCalledTimes(1);
  await share('credential', load); expect(load).toHaveBeenCalledTimes(2);
  load.mockRejectedValueOnce(new Error('offline'));
  await expect(share('credential', load)).rejects.toThrow('offline');
  await expect(share('credential', load)).resolves.toBe('fresh');
});
it('isolates credentials and caps pending entries without rejecting valid requests', async () => {
  const share = createInFlightGroup(1); let finish: (value: string) => void = () => {};
  const first = share('first', () => new Promise<string>(resolve => { finish = resolve; }));
  await expect(share('second', async () => 'second user')).resolves.toBe('second user');
  finish('first user'); await expect(first).resolves.toBe('first user');
});
