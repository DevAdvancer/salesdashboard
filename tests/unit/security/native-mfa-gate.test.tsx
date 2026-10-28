import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NativeMfaGate } from '@/components/native-mfa-gate';
import { account } from '@/lib/appwrite';

jest.mock('@/lib/appwrite', () => ({ account: {
  get: jest.fn(), updateMFA: jest.fn(), listMFAFactors: jest.fn(), createMFAChallenge: jest.fn(),
  updateMFAChallenge: jest.fn(), createEmailVerification: jest.fn(), updateEmailVerification: jest.fn(),
} }));
const api = account as jest.Mocked<typeof account>;
const verified = jest.fn();
beforeEach(() => {
  jest.resetAllMocks(); window.history.replaceState(null, '', '/login');
  api.get.mockResolvedValue({ $id: 'person', mfa: false, emailVerification: true } as any);
  api.updateMFA.mockResolvedValue({} as any);
  api.listMFAFactors.mockResolvedValue({ email: true } as any);
  api.createMFAChallenge.mockResolvedValue({ $id: 'native-challenge' } as any);
  api.updateMFAChallenge.mockResolvedValue({ factors: ['password', 'email'] } as any);
});

it('enrolls verified accounts by default, sends only one native email code in StrictMode, then verifies it', async () => {
  render(<StrictMode><NativeMfaGate onVerified={verified} onSignOut={jest.fn()} /></StrictMode>);
  const input = await screen.findByLabelText('Email verification code');
  await waitFor(() => expect(input).toBeEnabled());
  expect(api.updateMFA).toHaveBeenCalledWith({ mfa: true });
  expect(api.createMFAChallenge).toHaveBeenCalledTimes(1);
  expect(api.createMFAChallenge).toHaveBeenCalledWith({ factor: 'email' });
  expect(verified).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));
  await waitFor(() => expect(verified).toHaveBeenCalledTimes(1));
  expect(api.updateMFAChallenge).toHaveBeenCalledWith({ challengeId: 'native-challenge', otp: '123456' });
});

it('completes a pending native password session without needing account.get or a CRM profile to succeed', async () => {
  api.get.mockRejectedValue({ code: 401, type: 'user_more_factors_required' });
  render(<NativeMfaGate onVerified={verified} onSignOut={jest.fn()} />);
  await waitFor(() => expect(screen.getByLabelText('Email verification code')).toBeEnabled());
  expect(api.updateMFA).not.toHaveBeenCalled();
  expect(api.createMFAChallenge).toHaveBeenCalledWith({ factor: 'email' });
});

it('requires native email ownership verification before enabling MFA, and consumes the link without retaining its secret in the URL', async () => {
  api.get.mockResolvedValue({ $id: 'person', mfa: false, emailVerification: false } as any);
  const view = render(<NativeMfaGate onVerified={verified} onSignOut={jest.fn()} />);
  const send = await screen.findByRole('button', { name: 'Send email verification link' });
  fireEvent.click(send);
  await waitFor(() => expect(api.createEmailVerification).toHaveBeenCalledWith({ url: 'http://localhost/login' }));
  expect(api.updateMFA).not.toHaveBeenCalled();
  view.unmount();
  window.history.replaceState(null, '', '/login?userId=person&secret=private-secret');
  api.get.mockResolvedValueOnce({ $id: 'person', mfa: false, emailVerification: false } as any)
    .mockResolvedValue({ $id: 'person', mfa: false, emailVerification: true } as any);
  render(<NativeMfaGate onVerified={verified} onSignOut={jest.fn()} />);
  await waitFor(() => expect(api.createMFAChallenge).toHaveBeenCalledTimes(1));
  expect(api.updateEmailVerification).toHaveBeenCalledWith({ userId: 'person', secret: 'private-secret' });
  expect(window.location.search).toBe('');
});

it('keeps invalid codes blocked and does not automatically resend or repeatedly poll while waiting', async () => {
  api.updateMFAChallenge.mockRejectedValue({ type: 'user_invalid_token' });
  render(<NativeMfaGate onVerified={verified} onSignOut={jest.fn()} />);
  await waitFor(() => expect(screen.getByLabelText('Email verification code')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Email verification code'), { target: { value: '000000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('incorrect or has expired');
  expect(verified).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Resend code' })).toBeDisabled();
  jest.useFakeTimers();
  await act(async () => { jest.advanceTimersByTime(15 * 60_000); });
  expect(api.createMFAChallenge).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

it('does not continue a timed-out send or mount CRM after a late verification result', async () => {
  let complete!: (value: any) => void;
  api.updateMFAChallenge.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  render(<NativeMfaGate onVerified={verified} onSignOut={jest.fn()} />);
  await waitFor(() => expect(screen.getByLabelText('Email verification code')).toBeEnabled());
  jest.useFakeTimers();
  try {
    fireEvent.change(screen.getByLabelText('Email verification code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));
    await act(async () => { await jest.advanceTimersByTimeAsync(20_001); });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await act(async () => { complete({}); });
    expect(verified).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});

it('ignores a native verification result arriving after the user leaves', async () => {
  let complete!: (value: any) => void;
  api.updateMFAChallenge.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const view = render(<NativeMfaGate onVerified={verified} onSignOut={jest.fn()} />);
  await waitFor(() => expect(screen.getByLabelText('Email verification code')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Email verification code'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));
  await waitFor(() => expect(api.updateMFAChallenge).toHaveBeenCalled());
  view.unmount();
  await act(async () => { complete({}); });
  expect(verified).not.toHaveBeenCalled();
});
