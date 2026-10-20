import { act, fireEvent, render, screen } from '@testing-library/react';
import { LinkedinExtensionGuide } from '@/components/linkedin-extension-guide';

const attribute = 'data-crm-hub-linkedin-helper-version';
afterEach(() => document.documentElement.removeAttribute(attribute));

it('starts with installation instructions and collapses on first detection', async () => {
  const onDetection = jest.fn();
  render(<LinkedinExtensionGuide onDetection={onDetection} />);
  expect(onDetection).not.toHaveBeenCalled();
  expect(screen.getByText('Download v1.7.0')).toBeInTheDocument();
  await act(async () => document.documentElement.setAttribute(attribute, '1.7.0'));
  expect(screen.getByText('Detected · v1.7.0')).toBeInTheDocument();
  expect(onDetection).toHaveBeenCalledWith(true);
  expect(screen.queryByText('Download v1.7.0')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show LinkedIn Helper installation guide' }));
  expect(screen.getByText('Download v1.7.0')).toBeInTheDocument();
  await act(async () => document.documentElement.setAttribute(attribute, '1.7.0'));
  expect(screen.getByText('Download v1.7.0')).toBeInTheDocument();
  expect(onDetection).toHaveBeenCalledTimes(1);
});

it('keeps an older version expanded at the top with a visible download', () => {
  document.documentElement.setAttribute(attribute, '1.6.0');
  const onDetection = jest.fn();
  render(<LinkedinExtensionGuide onDetection={onDetection} />);
  expect(onDetection).toHaveBeenCalledWith(false);
  expect(screen.getByText('Update needed · v1.6.0')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Collapse' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Download v1.7.0' })).toHaveAttribute('href', '/downloads/crm-hub-linkedin-helper-1.7.0-chrome.zip');
});

it('moves between update and current states when the installed version changes', async () => {
  document.documentElement.setAttribute(attribute, '1.7.0');
  const onDetection = jest.fn();
  render(<LinkedinExtensionGuide onDetection={onDetection} />);
  expect(onDetection).toHaveBeenLastCalledWith(true);
  await act(async () => document.documentElement.setAttribute(attribute, '1.6.0'));
  expect(onDetection).toHaveBeenLastCalledWith(false);
  expect(screen.getByRole('link', { name: 'Download v1.7.0' })).toBeInTheDocument();
  await act(async () => document.documentElement.setAttribute(attribute, '1.7.0'));
  expect(onDetection).toHaveBeenLastCalledWith(true);
  expect(screen.queryByRole('link', { name: 'Download v1.7.0' })).not.toBeInTheDocument();
});
