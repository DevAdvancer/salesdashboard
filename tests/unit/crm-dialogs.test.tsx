import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useConfirmDialog } from '@/lib/hooks/use-confirm-dialog';
import { usePromptDialog } from '@/lib/hooks/use-prompt-dialog';

test('CRM confirmation requires an explicit confirm and preserves cancellation', async () => {
  const remove = jest.fn();
  function Form() { const { confirm, ConfirmDialog } = useConfirmDialog();
    return <><button onClick={async () => { if (await confirm({ title: 'Delete follow-up payment?', confirmText: 'Delete payment', destructive: true })) remove(); }}>Remove</button><ConfirmDialog /></>; }
  render(<Form />);
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
  expect(screen.getByRole('dialog', { name: 'Delete follow-up payment?' })).toBeVisible();
  expect(remove).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(remove).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
  await userEvent.click(screen.getByRole('button', { name: 'Delete payment' })); expect(remove).toHaveBeenCalledTimes(1);
});

test('CRM reason prompts keep input focus, reject blanks and distinguish cancellation', async () => {
  const submit = jest.fn();
  function Form() { const { prompt, promptDialog } = usePromptDialog();
    return <><button onClick={async () => { const reason = await prompt({ title: 'Withdraw request', label: 'Reason' }); if (reason !== null) submit(reason); }}>Withdraw</button>{promptDialog}</>; }
  render(<Form />);
  await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
  expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  await userEvent.type(screen.getByLabelText('Reason'), 'Duplicate request');
  expect(screen.getByLabelText('Reason')).toHaveFocus();
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(submit).toHaveBeenCalledWith('Duplicate request');
  await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
  await userEvent.keyboard('{Escape}'); expect(submit).toHaveBeenCalledTimes(1);
});
