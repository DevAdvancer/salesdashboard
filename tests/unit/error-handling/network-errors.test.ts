/**
 * Unit tests for network error handling with retry
 * Requirements: 10.6, 10.7
 */

import { handleNetworkError, isNetworkError, handleError } from '@/lib/utils/error-handler';
import { toast } from '@/components/ui/use-toast';

// Mock the toast function
jest.mock('@/components/ui/use-toast', () => ({
  toast: jest.fn(),
}));

describe('Network Error Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Network Error Detection', () => {
    it('should detect network errors by message content', () => {
      expect(isNetworkError({ message: 'network timeout' })).toBe(true);
      expect(isNetworkError({ message: 'fetch failed' })).toBe(true);
      expect(isNetworkError({ message: 'connection timeout' })).toBe(true);
    });

    it('should detect network errors by error code', () => {
      expect(isNetworkError({ code: 'NETWORK_ERROR' })).toBe(true);
    });

    it('should detect network errors by error name', () => {
      expect(isNetworkError({ name: 'NetworkError' })).toBe(true);
    });

    it('should not detect non-network errors', () => {
      expect(isNetworkError({ message: 'validation failed' })).toBe(false);
      expect(isNetworkError({ message: 'unauthorized' })).toBe(false);
      expect(isNetworkError({ code: 'VALIDATION_ERROR' })).toBe(false);
    });
  });

  describe('Network Error Notification', () => {
    it('should show network error toast with default message', () => {
      const error = new Error('network timeout');
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
      const error = new Error('fetch failed');

      handleNetworkError(error, { retry: retryFn });

      const toastCall = (toast as jest.Mock).mock.calls[0][0];
      expect(toastCall.title).toBe('Network Error');
      expect(toastCall.action).toBeDefined();
      expect(toastCall.action.props.altText).toBe('Retry');
      expect(toastCall.action.props.onClick).toBe(retryFn);
    });

    it('should use custom title when provided', () => {
      const error = new Error('connection lost');
      handleNetworkError(error, { title: 'Connection Failed' });

      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Connection Failed',
        })
      );
    });
  });

  describe('Retry Functionality', () => {
    it('should call retry function when retry action is clicked', () => {
      const retryFn = jest.fn();
      const error = new Error('network error');

      handleNetworkError(error, { retry: retryFn });

      // Get the toast call
      const toastCall = (toast as jest.Mock).mock.calls[0][0];
      const retryAction = toastCall.action;

      // Simulate clicking retry via props
      retryAction.props.onClick();

      expect(retryFn).toHaveBeenCalled();
    });

    it('should handle async retry functions', async () => {
      const retryFn = jest.fn().mockResolvedValue(undefined);
      const error = new Error('timeout');

      handleNetworkError(error, { retry: retryFn });

      const toastCall = (toast as jest.Mock).mock.calls[0][0];
      const retryAction = toastCall.action;

      await retryAction.props.onClick();

      expect(retryFn).toHaveBeenCalled();
    });
  });

  describe('Generic Error Handler Routing', () => {
    it('should route network errors to network handler', () => {
      const error = { message: 'network timeout' };
      handleError(error);

      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Network Error',
          description: 'Unable to connect. Please check your internet connection.',
        })
      );
    });

    it('should route API errors to API handler', () => {
      const error = { message: 'Invalid credentials' };
      handleError(error);

      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error',
          description: 'Invalid email or password',
        })
      );
    });

    it('should pass retry option to appropriate handler', () => {
      const retryFn = jest.fn();
      const networkError = { message: 'network failed' };

      handleError(networkError, { retry: retryFn });

      const toastCall = (toast as jest.Mock).mock.calls[0][0];
      expect(toastCall.action).toBeDefined();
      expect(toastCall.action.props.onClick).toBe(retryFn);
    });
  });

  describe('Real-world Network Error Scenarios', () => {
    it('should handle fetch timeout errors', () => {
      const error = new Error('network timeout');
      handleError(error, { retry: jest.fn() });

      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Unable to connect. Please check your internet connection.',
        })
      );
    });

    it('should handle connection refused errors', () => {
      const error = { message: 'Failed to fetch', name: 'NetworkError' };
      handleError(error);

      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Network Error',
        })
      );
    });

    it('should handle offline errors', () => {
      const error = { code: 'NETWORK_ERROR', message: 'No internet connection' };
      handleError(error);

      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Network Error',
        })
      );
    });
  });
});
