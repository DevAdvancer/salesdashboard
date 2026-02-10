import React from 'react';
import { toast } from '@/components/ui/use-toast';
import { ToastAction } from '@/components/ui/toast';

/**
 * Error handling utilities for consistent error notifications
 * Requirements: 10.7, 11.4
 */

export interface ErrorHandlerOptions {
  title?: string;
  showToast?: boolean;
  retry?: () => void | Promise<void>;
}

/**
 * Handle validation errors
 */
export function handleValidationError(
  message: string,
  options: ErrorHandlerOptions = {}
) {
  const { title = 'Validation Error', showToast = true } = options;

  if (showToast) {
    toast({
      title,
      description: message,
      variant: 'destructive',
    });
  }

  console.error('Validation error:', message);
}

/**
 * Handle API errors
 */
export function handleApiError(
  error: any,
  options: ErrorHandlerOptions = {}
) {
  const { title = 'Error', showToast = true, retry } = options;

  let message = 'An unexpected error occurred';

  // Extract error message
  if (error?.message) {
    message = error.message;
  } else if (typeof error === 'string') {
    message = error;
  }

  // Handle specific error types
  if (message.includes('Invalid credentials') || message.includes('user_invalid_credentials')) {
    message = 'Invalid email or password';
  } else if (message.includes('user_not_found')) {
    message = 'No account found with this email';
  } else if (message.includes('user_already_exists')) {
    message = 'A user with this email already exists';
  } else if (message.includes('document_not_found')) {
    message = 'The requested resource was not found';
  } else if (message.includes('unauthorized') || message.includes('403')) {
    message = 'You don\'t have permission to perform this action';
  }

  if (showToast) {
    toast({
      title,
      description: message,
      variant: 'destructive',
      action: retry
        ? React.createElement(ToastAction, { altText: 'Retry', onClick: retry }, 'Retry') as any
        : undefined,
    });
  }

  console.error('API error:', error);
  return message;
}

/**
 * Handle permission errors
 */
export function handlePermissionError(
  message: string = 'You don\'t have permission to access this resource',
  options: ErrorHandlerOptions = {}
) {
  const { title = 'Permission Denied', showToast = true } = options;

  if (showToast) {
    toast({
      title,
      description: message,
      variant: 'destructive',
    });
  }

  console.error('Permission error:', message);
}

/**
 * Handle network errors with retry option
 */
export function handleNetworkError(
  error: any,
  options: ErrorHandlerOptions = {}
) {
  const { title = 'Network Error', showToast = true, retry } = options;

  const message = 'Unable to connect. Please check your internet connection.';

  if (showToast) {
    toast({
      title,
      description: message,
      variant: 'destructive',
      action: retry
        ? React.createElement(ToastAction, { altText: 'Retry', onClick: retry }, 'Retry') as any
        : undefined,
    });
  }

  console.error('Network error:', error);
}

/**
 * Check if error is a network error
 */
export function isNetworkError(error: any): boolean {
  return (
    error?.message?.includes('network') ||
    error?.message?.includes('fetch') ||
    error?.message?.includes('timeout') ||
    error?.code === 'NETWORK_ERROR' ||
    error?.name === 'NetworkError'
  );
}

/**
 * Generic error handler that routes to specific handlers
 */
export function handleError(
  error: any,
  options: ErrorHandlerOptions = {}
) {
  if (isNetworkError(error)) {
    return handleNetworkError(error, options);
  }

  return handleApiError(error, options);
}
