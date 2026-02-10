/**
 * Unit tests for error handling utilities
 * Requirements: 10.6, 10.7
 */

import {
  handleValidationError,
  handleApiError,
  handlePermissionError,
  handleNetworkError,
  isNetworkError,
  handleError,
} from '@/lib/utils/error-handler';
import { toast } from '@/components/ui/use-toast';

// Mock the toast function
jest.mock('@/components/ui/use-toast', () => ({
  toast: jest.fn(),
}));

describe('Error Handler Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear console.error mock
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('handleValidationError', () => {
    it('should display validation error toast', () => {
      handleValidationError('Email is required');

      expect(toast).toHaveBeenCalledWith({
        title: 'Validation Error',
        description: 'Email is required',
        variant: 'destructive',
      });
    });

    it('should use custom title when provided', () => {
      handleValidationError('Invalid input', { title: 'Form Error' });

      expect(toast).toHaveBeenCalledWith({
        title: 'Form Error',
        description: 'Invalid input',
        variant: 'destructive',
      });
    });

    it('should not show toast when showToast is false', () => {
      handleValidationError('Error', { showToast: false });

      expect(toast).not.toHaveBeenCalled();
    });
  });

  describe('handleApiError', () => {
    it('should handle error with message property', () => {
      const error = { message: 'API request failed' };
      const result = handleApiError(error);

      expect(result).toBe('API request failed');
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'API request failed',
          variant: 'destructive',
        })
      );
    });

    it('should handle invalid credentials error', () => {
      const error = { message: 'Invalid credentials' };
      const result = handleApiError(error);

      expect(result).toBe('Invalid email or password');
    });

    it('should handle user not found error', () => {
      const error = { message: 'user_not_found' };
      const result = handleApiError(error);

      expect(result).toBe('No account found with this email');
    });

    it('should handle user already exists error', () => {
      const error = { message: 'user_already_exists' };
      const result = handleApiError(error);

      expect(result).toBe('A user with this email already exists');
    });

    it('should handle document not found error', () => {
      const error = { message: 'document_not_found' };
      const result = handleApiError(error);

      expect(result).toBe('The requested resource was not found');
    });

    it('should handle unauthorized error', () => {
      const error = { message: 'unauthorized' };
      const result = handleApiError(error);

      expect(result).toBe("You don't have permission to perform this action");
    });

    it('should include retry action when provided', () => {
      const retryFn = jest.fn();
      const error = { message: 'Request failed' };

      handleApiError(error, { retry: retryFn });

      const toastCall = (toast as jest.Mock).mock.calls[0][0];
      expect(toastCall.action).toBeDefined();
      expect(toastCall.action.props.altText).toBe('Retry');
      expect(toastCall.action.props.onClick).toBe(retryFn);
    });

    it('should handle string errors', () => {
      const result = handleApiError('Simple error string');

      expect(result).toBe('Simple error string');
    });

    it('should use default message for unknown errors', () => {
      const result = handleApiError({});

      expect(result).toBe('An unexpected error occurred');
    });
  });

  describe('handlePermissionError', () => {
    it('should display permission error toast with default message', () => {
      handlePermissionError();

      expect(toast).toHaveBeenCalledWith({
        title: 'Permission Denied',
        description: "You don't have permission to access this resource",
        variant: 'destructive',
      });
    });

    it('should display custom permission error message', () => {
      handlePermissionError('Cannot access admin panel');

      expect(toast).toHaveBeenCalledWith({
        title: 'Permission Denied',
        description: 'Cannot access admin panel',
        variant: 'destructive',
      });
    });
  });

  describe('handleNetworkError', () => {
    it('should display network error toast', () => {
      const error = new Error('Network request failed');
      handleNetworkError(error);

      expect(toast).toHaveBeenCalledWith({
        title: 'Network Error',
        description: 'Unable to connect. Please check your internet connection.',
        variant: 'destructive',
        action: undefined,
      });
    });

    it('should include retry action when provided', () => {
      const retryFn = jest.fn();
      const error = new Error('Network timeout');

      handleNetworkError(error, { retry: retryFn });

      const toastCall = (toast as jest.Mock).mock.calls[0][0];
      expect(toastCall.action).toBeDefined();
      expect(toastCall.action.props.altText).toBe('Retry');
      expect(toastCall.action.props.onClick).toBe(retryFn);
    });
  });

  describe('isNetworkError', () => {
    it('should identify network errors by message', () => {
      expect(isNetworkError({ message: 'network error' })).toBe(true);
      expect(isNetworkError({ message: 'fetch failed' })).toBe(true);
      expect(isNetworkError({ message: 'timeout exceeded' })).toBe(true);
    });

    it('should identify network errors by code', () => {
      expect(isNetworkError({ code: 'NETWORK_ERROR' })).toBe(true);
    });

    it('should identify network errors by name', () => {
      expect(isNetworkError({ name: 'NetworkError' })).toBe(true);
    });

    it('should return false for non-network errors', () => {
      expect(isNetworkError({ message: 'validation failed' })).toBe(false);
      expect(isNetworkError({ code: 'VALIDATION_ERROR' })).toBe(false);
      expect(isNetworkError({})).toBe(false);
    });
  });

  describe('handleError', () => {
    it('should route network errors to handleNetworkError', () => {
      const error = { message: 'network timeout' };
      const retryFn = jest.fn();

      handleError(error, { retry: retryFn });

      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Network Error',
          description: 'Unable to connect. Please check your internet connection.',
        })
      );
    });

    it('should route API errors to handleApiError', () => {
      const error = { message: 'Invalid credentials' };

      handleError(error);

      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Invalid email or password',
        })
      );
    });
  });
});
