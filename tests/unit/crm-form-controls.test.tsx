import { useRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { CrmSelect } from '@/components/ui/crm-select';
import { Input } from '@/components/ui/input';
import { selectCrmDate, selectCrmOption } from '@/tests/helpers/custom-controls';

test('custom options keep real form values, empty options and controlled change handlers', async () => {
  const change = jest.fn();
  function Form() { const [value, setValue] = useState(''); return <form data-testid="form"><label htmlFor="branch">Branch</label>
    <CrmSelect id="branch" name="branch" value={value} onChange={event => { change(event.target.name, event.target.value); setValue(event.target.value); }}>
      <option value="">Choose branch</option><option value="ncr">NCR</option><option value="ahm">AHM</option>
    </CrmSelect></form>; }
  render(<Form />);
  await selectCrmOption(screen.getByLabelText('Branch'), 'ahm');
  expect(change).toHaveBeenLastCalledWith('branch', 'ahm');
  expect(new FormData(screen.getByTestId('form') as HTMLFormElement).get('branch')).toBe('ahm');
  await selectCrmOption(screen.getByLabelText('Branch'), '');
  expect(change).toHaveBeenLastCalledWith('branch', '');
});

test('supports React Hook Form registration, setValue, required validation and reset', async () => {
  const save = jest.fn();
  function Form() {
    const { register, handleSubmit, setValue, reset } = useForm({ defaultValues: { branch: '' } });
    return <form onSubmit={handleSubmit(save)}><label htmlFor="branch">Branch</label>
      <CrmSelect id="branch" {...register('branch', { required: true })}><option value="">Choose</option><option value="ncr">NCR</option><option value="ahm">AHM</option></CrmSelect>
      <button type="button" onClick={() => setValue('branch', 'ncr')}>Set NCR</button><button type="button" onClick={() => reset()}>Reset</button><button>Save</button>
    </form>;
  }
  render(<Form />);
  await userEvent.click(screen.getByRole('button', { name: 'Save' })); expect(save).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Set NCR' }));
  expect(screen.getByLabelText('Branch')).toHaveTextContent('NCR');
  await selectCrmOption(screen.getByLabelText('Branch'), 'ahm');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ branch: 'ahm' }, expect.anything()));
  await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
  expect(screen.getByLabelText('Branch')).toHaveTextContent('Choose');
});

test('custom calendars preserve input date values, constraints and form submission', async () => {
  const change = jest.fn();
  function Form() { const [value, setValue] = useState('2026-11-01'); return <form data-testid="date-form"><label htmlFor="date">Payment date</label>
    <Input type="date" id="date" name="date" value={value} min="2026-11-01" max="2026-11-30" onChange={event => { setValue(event.target.value); change(event.target.value); }} /></form>; }
  render(<Form />);
  await selectCrmDate(screen.getByLabelText('Payment date'), '2026-11-04');
  expect(change).toHaveBeenLastCalledWith('2026-11-04');
  expect(new FormData(screen.getByTestId('date-form') as HTMLFormElement).get('date')).toBe('2026-11-04');
  expect(screen.getByLabelText('Payment date')).toHaveTextContent('Nov 4, 2026');
});
