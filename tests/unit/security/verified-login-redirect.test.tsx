import { act, render, screen } from '@testing-library/react';
import { VerifiedLoginRedirect } from '@/components/verified-login-redirect';
import { replaceDocument } from '@/lib/utils/document-navigation';
jest.mock('@/lib/utils/document-navigation', () => ({ replaceDocument: jest.fn() }));
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(() => jest.useRealTimers());
it('navigates automatically without showing an intermediate confirmation screen', () => {
  const view = render(<VerifiedLoginRedirect target="/dashboard" onSignOut={jest.fn()} />);
  expect(replaceDocument).toHaveBeenCalledWith('/dashboard');
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.queryByText('Your sign-in has been verified.')).not.toBeInTheDocument();
  view.unmount();
  expect(jest.getTimerCount()).toBe(0);
});
it('offers recovery only if the document navigation has not completed after eight seconds', () => {
  render(<VerifiedLoginRedirect target="/dashboard" onSignOut={jest.fn()} />);
  act(() => { jest.advanceTimersByTime(7999); });
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  act(() => { jest.advanceTimersByTime(1); });
  expect(screen.getByRole('link', { name: 'Open dashboard' })).toHaveAttribute('href', '/dashboard');
  expect(replaceDocument).toHaveBeenCalledTimes(1);
});
