import { act, fireEvent, render, screen } from '@testing-library/react';
import { LinkedinExtensionGuide } from '@/components/linkedin-extension-guide';

const attribute = 'data-crm-hub-linkedin-helper-version';
afterEach(() => document.documentElement.removeAttribute(attribute));

it('offers v2.2.1 to every user and collapses on detection', async () => {
  const onDetection = jest.fn();
  render(<LinkedinExtensionGuide onDetection={onDetection} />);
  expect(screen.getByRole('link', { name: 'Download v2.2.1' }))
    .toHaveAttribute('href', '/downloads/crm-hub-linkedin-helper-2.2.1-chrome.zip');
  expect(screen.queryByText(/beta/i)).not.toBeInTheDocument();
  await act(async () => document.documentElement.setAttribute(attribute, '2.2.1'));
  expect(onDetection).toHaveBeenLastCalledWith(true);
  expect(screen.queryByRole('link', { name: 'Download v2.2.1' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show LinkedIn Helper installation guide' }));
  expect(screen.getByRole('link', { name: 'Download v2.2.1' })).toBeInTheDocument();
});

it.each(['1.6.0', '2.0.0', '2.1.0', '2.1.1', '2.2.0'])('offers the current release to a user with v%s', async oldVersion => {
  document.documentElement.setAttribute(attribute, oldVersion);
  const onDetection = jest.fn();
  render(<LinkedinExtensionGuide onDetection={onDetection} />);
  expect(onDetection).toHaveBeenLastCalledWith(false);
  expect(screen.getByRole('link', { name: 'Download v2.2.1' })).toBeInTheDocument();
  await act(async () => document.documentElement.setAttribute(attribute, '2.2.1'));
  expect(onDetection).toHaveBeenLastCalledWith(true);
  expect(screen.queryByRole('link', { name: 'Download v2.2.1' })).not.toBeInTheDocument();
});
