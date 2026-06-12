'use client';

import * as React from 'react';
import { Button, type ButtonProps } from './button';
import { useSingleClick } from '@/lib/hooks/use-single-click';

export interface SingleClickButtonProps
  extends Omit<ButtonProps, 'onClick' | 'loading'> {
  /**
   * Stable key used to dedupe concurrent invocations.
   * Use the row/entity id for table rows, or a static name for form submits.
   */
  actionKey: string;
  /**
   * Async handler. The wrapper will:
   *   1. Set `loading` to true while the promise is pending
   *   2. Block any further clicks until the promise settles
   *   3. Reset `loading` to false in `finally` (even on error)
   */
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => Promise<void> | void;
}

/**
 * Drop-in replacement for `Button` for any action that performs async work.
 *
 * Guarantees a SINGLE network call per `actionKey` until the handler resolves.
 * The internal `useSingleClick` guard catches:
 *   - rapid mouse double-clicks
 *   - keyboard Enter spam while focused
 *   - accidental mobile double-taps
 *
 * The button also flips to its built-in loading state (spinner + disabled)
 * during the request, so users get immediate visual feedback.
 */
export const SingleClickButton = React.forwardRef<
  HTMLButtonElement,
  SingleClickButtonProps
>(({ actionKey, onClick, disabled, children, ...props }, ref) => {
  const { run, isRunning } = useSingleClick();
  const [pending, setPending] = React.useState(false);

  // Use both the ref-based guard AND local pending state so the button shows
  // a spinner even when the parent is in a controlled "saving" state.
  const loading = pending || isRunning(actionKey);

  const handleClick = React.useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      // Don't preventDefault by default — let the consumer decide via `type`.
      await run(actionKey, async () => {
        setPending(true);
        try {
          await onClick(event);
        } finally {
          setPending(false);
        }
      });
    },
    [actionKey, onClick, run],
  );

  return (
    <Button
      ref={ref}
      loading={loading}
      disabled={disabled || loading}
      onClick={handleClick}
      {...props}
    >
      {children}
    </Button>
  );
});

SingleClickButton.displayName = 'SingleClickButton';
