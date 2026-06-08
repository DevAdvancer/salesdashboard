import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getErrorMessage(error: unknown, fallbackMessage?: string): string {
  let message = '';
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === 'string') {
    message = error;
  } else if (error && typeof error === 'object' && 'message' in error) {
    message = String(error.message);
  } else {
    message = fallbackMessage || 'An unexpected error occurred';
  }

  if (message.includes('Server Components render') || message.includes('digest')) {
    return 'There is a new update, please refresh. If the issue persists, let support know via email and it will be fixed.';
  }

  return message;
}
