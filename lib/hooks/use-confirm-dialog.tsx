'use client';

import { useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

interface UseConfirmDialogReturn {
  /**
   * Open the dialog. Returns a promise that resolves to `true` when the
   * user confirms, `false` when they cancel, and `false` on backdrop click.
   */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Render this once near the root of the page. */
  ConfirmDialog: () => React.ReactElement;
}

/**
 * Promise-based confirmation dialog hook.
 *
 * Consolidates the previously duplicated `useConfirmDialog` definitions that
 * lived in `app/branches/page.tsx` and `app/users/page.tsx`.
 *
 * @example
 *   const { confirm, ConfirmDialog } = useConfirmDialog();
 *   const handleDelete = async () => {
 *     const ok = await confirm({ title: 'Delete lead?', destructive: true });
 *     if (!ok) return;
 *     await deleteLead();
 *   };
 *   return <>...<ConfirmDialog /></>;
 */
export function useConfirmDialog(): UseConfirmDialogReturn {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('Confirm');
  const [cancelText, setCancelText] = useState('Cancel');
  const [destructive, setDestructive] = useState(false);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const close = (value: boolean) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setOpen(false);
    resolver?.(value);
  };

  const confirm = (options: ConfirmOptions) => {
    setTitle(options.title);
    setDescription(options.description ?? null);
    setConfirmText(options.confirmText ?? 'Confirm');
    setCancelText(options.cancelText ?? 'Cancel');
    setDestructive(Boolean(options.destructive));
    setOpen(true);

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  };

  const ConfirmDialog = () => (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && open) close(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            {cancelText}
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            onClick={() => close(true)}
          >
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { confirm, ConfirmDialog };
}
