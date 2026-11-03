import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

export async function selectCrmOption(trigger: HTMLElement, value: string) {
  const formControl = document.getElementById(`${trigger.id}-form-control`) as HTMLSelectElement;
  const option = [...formControl.options].find(option => option.value === value);
  if (!option) throw new Error(`Option ${value} is unavailable.`);
  if (trigger.getAttribute('aria-expanded') !== 'true') await userEvent.click(trigger);
  await userEvent.click(await screen.findByRole('option', { name: option.label.trim().replace(/\s+/g, ' '), exact: true }));
}

export async function selectCrmDate(trigger: HTMLElement, date: string) {
  await userEvent.click(trigger);
  const popup = await screen.findByRole('dialog', { name: 'Choose date' });
  const label = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const targetMonth = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  for (let attempt = 0; attempt < 120; attempt++) {
    if (within(popup).queryByText(targetMonth)) break;
    const title = within(popup).getByText(/^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/).textContent!;
    const current = new Date(`${title} 01`);
    await userEvent.click(within(popup).getByRole('button', { name: current < new Date(`${date}T12:00:00`) ? 'Next month' : 'Previous month' }));
  }
  await userEvent.click(within(popup).getByRole('button', { name: label, exact: true }));
}
