import React from 'react';
import * as Sentry from '@sentry/nextjs';
import { toast } from '@/components/ui/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { SUPPORT_EMAIL } from '@/lib/constants/support';

/**
 * Error handling utilities for consistent error notifications
 * Requirements: 10.7, 11.4
 */

export interface ErrorHandlerOptions {
  title?: string;
  showToast?: boolean;
  retry?: () => void | Promise<void>;
}

function getStatusCode(error: any): number | null {
  const candidate =
    error?.status ??
    error?.response?.status ??
    error?.response?.statusCode ??
    error?.statusCode;

  if (typeof candidate === 'number') return candidate;
  if (typeof candidate === 'string') {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function isTemporaryError(error: any, message: string): boolean {
  const status = getStatusCode(error);
  if (status && [408, 425, 429, 500, 502, 503, 504].includes(status)) return true;

  const normalized = message.toLowerCase();
  return (
    normalized.includes('timeout') ||
    normalized.includes('temporar') ||
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('service unavailable') ||
    normalized.includes('bad gateway') ||
    normalized.includes('gateway timeout')
  );
}

function refreshPage() {
  if (typeof window === 'undefined') return;
  window.location.reload();
}

function openSupportEmail() {
  if (typeof window === 'undefined') return;
  window.location.href = `mailto:${SUPPORT_EMAIL}`;
}

function createToastAction(
  label: string,
  altText: string,
  onClick: () => void | Promise<void>,
) {
  return React.createElement(
    ToastAction,
    { altText, onClick },
    label,
  ) as any;
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
    });
  }

  console.error('Validation error:', message);
  Sentry.captureException(new Error(message));
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
  let isExpectedUserError = false;

  if (
    message.includes('Invalid credentials') ||
    message.includes('user_invalid_credentials')
  ) {
    message = 'Invalid email or password';
    isExpectedUserError = true;
  } else if (message.includes('user_not_found')) {
    message = 'No account found with this email';
    isExpectedUserError = true;
  } else if (message.includes('user_already_exists')) {
    message = 'A user with this email already exists';
    isExpectedUserError = true;
  } else if (message.includes('document_not_found')) {
    message = 'The requested resource was not found';
    isExpectedUserError = true;
  } else if (message.includes('unauthorized') || message.includes('403')) {
    message = 'You don\'t have permission to perform this action';
    isExpectedUserError = true;
  }

  const status = getStatusCode(error);
  const isTemporary = !isExpectedUserError && isTemporaryError(error, message);
  const needsSupport =
    !isExpectedUserError &&
    !isTemporary &&
    ((typeof status === 'number' && status >= 500) ||
      message === 'An unexpected error occurred');

  if (isTemporary) {
    message = `This looks like a temporary issue. Please refresh to check, and if the issue is not solved, please contact support at ${SUPPORT_EMAIL}.`;
  } else if (needsSupport) {
    message = `We couldn't complete that right now. Please refresh to check, and if the issue is not solved, please contact support at ${SUPPORT_EMAIL}.`;
  }

  if (showToast) {
    toast({
      title,
      description: message,
      action: isTemporary
        ? createToastAction('Refresh', 'Refresh', refreshPage)
        : needsSupport
          ? createToastAction('Email support', 'Email support', openSupportEmail)
          : retry
            ? createToastAction('Try again', 'Try again', retry)
            : undefined,
    });
  }

  if (isExpectedUserError) {
    console.warn('API warning (expected):', message);
  } else {
    console.error('API error:', error);
    Sentry.captureException(error);
  }
  
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
    });
  }

  console.error('Permission error:', message);
  Sentry.captureException(new Error(message));
}

/**
 * Handle network errors with retry option
 */
export function handleNetworkError(
  error: any,
  options: ErrorHandlerOptions = {}
) {
  const { title = 'Network Error', showToast = true, retry } = options;

  const message =
    `We're having trouble connecting right now. Please refresh to check, and if the issue is not solved, please contact support at ${SUPPORT_EMAIL}.`;

  if (showToast) {
    toast({
      title,
      description: message,
      action: createToastAction('Refresh', 'Refresh', refreshPage),
    });
  }

  console.error('Network error:', error);
  Sentry.captureException(error);

  return message;
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
