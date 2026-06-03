import SignupPage from '@/app/signup/page';
import { redirect } from 'next/navigation';

jest.mock('next/navigation', () => ({
  redirect: jest.fn(),
}));

describe('SignupPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('redirects signup route to login because signup is disabled', () => {
    SignupPage();

    expect(redirect).toHaveBeenCalledWith('/login');
  });
});
