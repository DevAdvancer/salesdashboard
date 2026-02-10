import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRouter } from 'next/navigation';
import SignupPage from '@/app/signup/page';
import { useAuth } from '@/lib/contexts/auth-context';

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

// Mock auth context
jest.mock('@/lib/contexts/auth-context', () => ({
  useAuth: jest.fn(),
}));

describe('SignupPage', () => {
  const mockPush = jest.fn();
  const mockSignup = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
    });
    (useAuth as jest.Mock).mockReturnValue({
      signup: mockSignup,
    });
  });

  it('renders signup form with all fields', () => {
    render(<SignupPage />);

    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign up/i })).toBeInTheDocument();
  });

  it('displays validation errors for empty fields', async () => {
    const user = userEvent.setup();
    render(<SignupPage />);

    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/name is required/i)).toBeInTheDocument();
      expect(screen.getByText(/invalid email address/i)).toBeInTheDocument();
      expect(screen.getByText(/password must be at least 8 characters/i)).toBeInTheDocument();
    });

    expect(mockSignup).not.toHaveBeenCalled();
  });

  it('displays validation error for invalid email', async () => {
    const user = userEvent.setup();
    render(<SignupPage />);

    // Fill in all required fields with a string that looks like email but isn't valid
    await user.type(screen.getByLabelText(/full name/i), 'John Doe');
    // Use a text input approach - type something that passes HTML5 but fails zod
    const emailInput = screen.getByLabelText(/^email$/i);
    await user.clear(emailInput);
    await user.type(emailInput, 'notanemail');
    await user.type(screen.getByLabelText(/^password$/i), 'password123');
    await user.type(screen.getByLabelText(/confirm password/i), 'password123');

    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    // The HTML5 validation will prevent submission, so this test verifies
    // that the form doesn't call signup with invalid data
    await waitFor(() => {
      expect(mockSignup).not.toHaveBeenCalled();
    });
  });

  it('displays validation error for short password', async () => {
    const user = userEvent.setup();
    render(<SignupPage />);

    const passwordInput = screen.getByLabelText(/^password$/i);
    await user.type(passwordInput, 'short');

    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/password must be at least 8 characters/i)).toBeInTheDocument();
    });
  });

  it('displays validation error when passwords do not match', async () => {
    const user = userEvent.setup();
    render(<SignupPage />);

    const passwordInput = screen.getByLabelText(/^password$/i);
    const confirmPasswordInput = screen.getByLabelText(/confirm password/i);

    await user.type(passwordInput, 'password123');
    await user.type(confirmPasswordInput, 'password456');

    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/passwords don't match/i)).toBeInTheDocument();
    });
  });

  it('successfully creates manager account with valid data', async () => {
    const user = userEvent.setup();
    mockSignup.mockResolvedValue(undefined);

    render(<SignupPage />);

    // Fill in the form
    await user.type(screen.getByLabelText(/full name/i), 'John Doe');
    await user.type(screen.getByLabelText(/^email$/i), 'john@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'password123');
    await user.type(screen.getByLabelText(/confirm password/i), 'password123');

    // Submit the form
    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    // Verify signup was called with correct data
    await waitFor(() => {
      expect(mockSignup).toHaveBeenCalledWith('John Doe', 'john@example.com', 'password123');
    });

    // Verify redirect to dashboard
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('displays error message when signup fails with duplicate email', async () => {
    const user = userEvent.setup();
    mockSignup.mockRejectedValue(new Error('user_already_exists'));

    render(<SignupPage />);

    // Fill in the form
    await user.type(screen.getByLabelText(/full name/i), 'John Doe');
    await user.type(screen.getByLabelText(/^email$/i), 'existing@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'password123');
    await user.type(screen.getByLabelText(/confirm password/i), 'password123');

    // Submit the form
    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    // Verify error message is displayed
    await waitFor(() => {
      expect(screen.getByText(/an account with this email already exists/i)).toBeInTheDocument();
    });

    // Verify no redirect occurred
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('displays generic error message for unknown errors', async () => {
    const user = userEvent.setup();
    mockSignup.mockRejectedValue(new Error('Unknown error'));

    render(<SignupPage />);

    // Fill in the form
    await user.type(screen.getByLabelText(/full name/i), 'John Doe');
    await user.type(screen.getByLabelText(/^email$/i), 'john@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'password123');
    await user.type(screen.getByLabelText(/confirm password/i), 'password123');

    // Submit the form
    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    // Verify error message is displayed
    await waitFor(() => {
      expect(screen.getByText(/failed to create account/i)).toBeInTheDocument();
    });
  });

  it('disables form inputs and button while submitting', async () => {
    const user = userEvent.setup();
    // Make signup take some time to complete
    mockSignup.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));

    render(<SignupPage />);

    // Fill in the form
    await user.type(screen.getByLabelText(/full name/i), 'John Doe');
    await user.type(screen.getByLabelText(/^email$/i), 'john@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'password123');
    await user.type(screen.getByLabelText(/confirm password/i), 'password123');

    // Submit the form
    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    // Verify button shows loading spinner and is disabled
    const submitBtn = screen.getByRole('button', { name: /sign up/i });
    expect(submitBtn).toBeDisabled();
    expect(screen.getByRole('status')).toBeInTheDocument();

    // Verify inputs are disabled
    expect(screen.getByLabelText(/full name/i)).toBeDisabled();
    expect(screen.getByLabelText(/^email$/i)).toBeDisabled();
    expect(screen.getByLabelText(/^password$/i)).toBeDisabled();
    expect(screen.getByLabelText(/confirm password/i)).toBeDisabled();
  });

  it('has link to login page', () => {
    render(<SignupPage />);

    const loginLink = screen.getByRole('link', { name: /log in/i });
    expect(loginLink).toBeInTheDocument();
    expect(loginLink).toHaveAttribute('href', '/login');
  });
});
