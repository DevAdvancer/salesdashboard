import { act, fireEvent, render, screen } from '@testing-library/react';
import { LinkedinExtensionGuide } from '@/components/linkedin-extension-guide';

const attribute = 'data-crm-hub-linkedin-helper-version';
afterEach(() => document.documentElement.removeAttribute(attribute));

it('starts with installation instructions and collapses on first detection', async () => {
  const onDetection = jest.fn();
  render(<LinkedinExtensionGuide beta onDetection={onDetection} />);
  expect(onDetection).not.toHaveBeenCalled();
  expect(screen.getByText('Download LinkedIn Helper')).toBeInTheDocument();
  await act(async () => document.documentElement.setAttribute(attribute, '1.8.9'));
  expect(screen.getByText('Detected · v1.8.9')).toBeInTheDocument();
  expect(onDetection).toHaveBeenCalledWith(true);
  expect(screen.queryByText('Download LinkedIn Helper')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show LinkedIn Helper installation guide' }));
  expect(screen.getByText('Download LinkedIn Helper')).toBeInTheDocument();
  await act(async () => document.documentElement.setAttribute(attribute, '1.8.9'));
  expect(screen.getByText('Download LinkedIn Helper')).toBeInTheDocument();
  expect(onDetection).toHaveBeenCalledTimes(1);
});

it('keeps an older version expanded at the top with a visible download', () => {
  document.documentElement.setAttribute(attribute, '1.6.0');
  const onDetection = jest.fn();
  render(<LinkedinExtensionGuide beta onDetection={onDetection} />);
  expect(onDetection).toHaveBeenCalledWith(false);
  expect(screen.getByText('Update needed · v1.6.0')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Collapse' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Download LinkedIn Helper' })).toHaveAttribute('href', '/api/extension/linkedin/download');
  expect(screen.getByRole('link', { name: 'Download LinkedIn Helper' })).toHaveAttribute('download', 'LinkedIn Helper.zip');
});

it('moves between update and current states when the installed version changes', async () => {
  document.documentElement.setAttribute(attribute, '1.8.9');
  const onDetection = jest.fn();
  render(<LinkedinExtensionGuide beta onDetection={onDetection} />);
  expect(onDetection).toHaveBeenLastCalledWith(true);
  await act(async () => document.documentElement.setAttribute(attribute, '1.6.0'));
  expect(onDetection).toHaveBeenLastCalledWith(false);
  expect(screen.getByRole('link', { name: 'Download LinkedIn Helper' })).toBeInTheDocument();
  await act(async () => document.documentElement.setAttribute(attribute, '1.8.9'));
  expect(onDetection).toHaveBeenLastCalledWith(true);
  expect(screen.queryByRole('link', { name: 'Download LinkedIn Helper' })).not.toBeInTheDocument();
});
jest.mock('@/app/actions/beta', () => ({ getMyLinkedinHelperAccessAction: jest.fn() }));

it('keeps v1.7 current for stable users without advertising a beta update', () => {
  document.documentElement.setAttribute(attribute, '1.7.0');
  const onDetection = jest.fn();
  render(<LinkedinExtensionGuide onDetection={onDetection} />);
  expect(screen.getByText('Detected · v1.7.0')).toBeInTheDocument();
  expect(onDetection).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: 'Show LinkedIn Helper installation guide' }));
  expect(screen.queryByText(/1\.8\.9/)).not.toBeInTheDocument();
  expect(screen.queryByText('Beta')).not.toBeInTheDocument();
  expect(screen.getByText(/Send the invitation on LinkedIn first/)).toBeInTheDocument();
  expect(screen.queryByText(/Lock account for this browser profile/)).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Download LinkedIn Helper' })).toHaveAttribute('download', 'LinkedIn Helper.zip');
});
