import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { OtpCodeInput } from '@/components/ui/otp-code-input';

function Example() { const [value, setValue] = useState(''); return <><OtpCodeInput id="code" value={value} onChange={setValue} /><output data-testid="code-value">{value}</output></>; }
test('renders six boxes, advances on digits, supports arrows and backspace', () => {
  render(<Example />);
  const boxes = screen.getAllByRole('textbox');
  expect(boxes).toHaveLength(6);
  fireEvent.change(boxes[0], { target: { value: '1' } });
  expect(boxes[1]).toHaveFocus();
  fireEvent.change(boxes[1], { target: { value: '2' } });
  expect(boxes[2]).toHaveFocus();
  fireEvent.keyDown(boxes[2], { key: 'Backspace' });
  expect(boxes[1]).toHaveFocus(); expect(boxes[1]).toHaveValue('');
  fireEvent.keyDown(boxes[1], { key: 'ArrowLeft' }); expect(boxes[0]).toHaveFocus();
  fireEvent.change(boxes[0], { target: { value: 'a' } }); expect(boxes[0]).toHaveValue('');
});
test('pastes or autofills the complete code, including leading zeroes', () => {
  render(<Example />);
  const boxes = screen.getAllByRole('textbox');
  fireEvent.paste(boxes[3], { clipboardData: { getData: () => '012 345' } });
  expect(boxes.map(box => (box as HTMLInputElement).value).join('')).toBe('012345');
  fireEvent.change(boxes[0], { target: { value: '987654' } });
  expect(screen.getByTestId('code-value')).toHaveTextContent('987654');
  expect(boxes[0]).toHaveAttribute('autocomplete', 'one-time-code');
});
