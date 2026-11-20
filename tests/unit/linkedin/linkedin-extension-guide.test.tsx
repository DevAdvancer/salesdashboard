import { act, fireEvent, render, screen } from '@testing-library/react';
import { LinkedinExtensionGuide } from '@/components/linkedin-extension-guide';

const attribute = 'data-crm-hub-linkedin-helper-version';
beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-11-20T14:00:00Z')));
afterEach(() => {
  document.documentElement.removeAttribute(attribute);
  jest.useRealTimers();
});

it('starts with installation instructions and collapses on first detection', async () => {
  const onDetection = jest.fn();
  render(<LinkedinExtensionGuide onDetection={onDetection} />);
  expect(onDetection).not.toHaveBeenCalled();
  expect(screen.getByText('Download v2.0.0')).toBeInTheDocument();
  await act(async () => document.documentElement.setAttribute(attribute, '2.0.0'));
  expect(screen.getByText('Detected · v2.0.0')).toBeInTheDocument();
  expect(onDetection).toHaveBeenCalledWith(true);
  expect(screen.queryByText('Download v2.0.0')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show LinkedIn Helper installation guide' }));
  expect(screen.getByText('Download v2.0.0')).toBeInTheDocument();
  await act(async () => document.documentElement.setAttribute(attribute, '2.0.0'));
  expect(screen.getByText('Download v2.0.0')).toBeInTheDocument();
  expect(onDetection).toHaveBeenCalledTimes(1);
});

it('keeps an older version expanded at the top with a visible download', () => {
  document.documentElement.setAttribute(attribute, '1.6.0');
  const onDetection = jest.fn();
  render(<LinkedinExtensionGuide onDetection={onDetection} />);
  expect(onDetection).toHaveBeenCalledWith(false);
  expect(screen.getByText('Update needed · v1.6.0')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Collapse' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Download v2.0.0' })).toHaveAttribute('href', '/downloads/crm-hub-linkedin-helper-2.0.0-chrome.zip');
});

it('directs beta users on v2.1.0 to the clipboard-safe release', async () => {
  document.documentElement.setAttribute(attribute, '2.1.0');
  render(<LinkedinExtensionGuide conversationsBeta />);
  expect(screen.getByText('Update needed · v2.1.0')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Download v2.1.1 beta' })).toHaveAttribute('href', '/downloads/crm-hub-linkedin-helper-2.1.1-chrome.zip');
  await act(async () => document.documentElement.setAttribute(attribute, '2.1.1'));
  expect(screen.getByText('Detected · v2.1.1')).toBeInTheDocument();
});

it('moves between update and current states when the installed version changes', async () => {
  document.documentElement.setAttribute(attribute, '2.0.0');
  const onDetection = jest.fn();
  render(<LinkedinExtensionGuide onDetection={onDetection} />);
  expect(onDetection).toHaveBeenLastCalledWith(true);
  await act(async () => document.documentElement.setAttribute(attribute, '1.6.0'));
  expect(onDetection).toHaveBeenLastCalledWith(false);
  expect(screen.getByRole('link', { name: 'Download v2.0.0' })).toBeInTheDocument();
  await act(async () => document.documentElement.setAttribute(attribute, '2.0.0'));
  expect(onDetection).toHaveBeenLastCalledWith(true);
  expect(screen.queryByRole('link', { name: 'Download v2.0.0' })).not.toBeInTheDocument();
});

it('offers the public extension at launch and requires the new version', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-21T13:59:59.999Z'));
  try {
    document.documentElement.setAttribute(attribute, '2.1.1');
    const detected = jest.fn();
    render(<LinkedinExtensionGuide onDetection={detected} conversationsBeta />);
    expect(detected).toHaveBeenLastCalledWith(true);
    await act(async () => { jest.advanceTimersByTime(1); });
    expect(detected).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('link', { name: 'Download v2.2.0' }))
      .toHaveAttribute('href', '/downloads/crm-hub-linkedin-helper-2.2.0-chrome.zip');
    expect(screen.queryByText(/beta/i)).not.toBeInTheDocument();
    await act(async () => document.documentElement.setAttribute(attribute, '2.2.0'));
    expect(detected).toHaveBeenLastCalledWith(true);
  } finally {
    jest.useRealTimers();
  }
});
