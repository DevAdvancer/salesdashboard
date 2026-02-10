/**
 * Unit tests for validation error display
 * Requirements: 10.7, 11.4
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Test form component with validation
const testSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Please enter a valid phone number'),
  required: z.string().min(1, 'This field is required'),
});

type TestFormData = z.infer<typeof testSchema>;

function TestForm({ onSubmit }: { onSubmit: (data: TestFormData) => void }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TestFormData>({
    resolver: zodResolver(testSchema),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" {...register('email')} />
        {errors.email && (
          <p className="text-sm text-red-500">{errors.email.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="phone">Phone</Label>
        <Input id="phone" {...register('phone')} />
        {errors.phone && (
          <p className="text-sm text-red-500">{errors.phone.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="required">Required Field</Label>
        <Input id="required" {...register('required')} />
        {errors.required && (
          <p className="text-sm text-red-500">{errors.required.message}</p>
        )}
      </div>

      <Button type="submit">Submit</Button>
    </form>
  );
}

describe('Validation Error Display', () => {
  it('should display email validation error', async () => {
    const onSubmit = jest.fn();
    const { container } = render(<TestForm onSubmit={onSubmit} />);

    const emailInput = screen.getByLabelText('Email');
    const submitButton = screen.getByRole('button', { name: /submit/i });

    // Enter invalid email
    emailInput.setAttribute('value', 'invalid-email');
    submitButton.click();

    await waitFor(() => {
      expect(screen.getByText('Please enter a valid email address')).toBeInTheDocument();
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('should display phone validation error', async () => {
    const onSubmit = jest.fn();
    render(<TestForm onSubmit={onSubmit} />);

    const phoneInput = screen.getByLabelText('Phone');
    const submitButton = screen.getByRole('button', { name: /submit/i });

    // Enter invalid phone
    phoneInput.setAttribute('value', 'abc');
    submitButton.click();

    await waitFor(() => {
      expect(screen.getByText('Please enter a valid phone number')).toBeInTheDocument();
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('should display required field error', async () => {
    const onSubmit = jest.fn();
    render(<TestForm onSubmit={onSubmit} />);

    const submitButton = screen.getByRole('button', { name: /submit/i });

    // Submit without filling required field
    submitButton.click();

    await waitFor(() => {
      expect(screen.getByText('This field is required')).toBeInTheDocument();
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('should display multiple validation errors simultaneously', async () => {
    const onSubmit = jest.fn();
    render(<TestForm onSubmit={onSubmit} />);

    const emailInput = screen.getByLabelText('Email');
    const phoneInput = screen.getByLabelText('Phone');
    const submitButton = screen.getByRole('button', { name: /submit/i });

    // Enter invalid data
    emailInput.setAttribute('value', 'bad-email');
    phoneInput.setAttribute('value', 'bad-phone');
    submitButton.click();

    await waitFor(() => {
      expect(screen.getByText('Please enter a valid email address')).toBeInTheDocument();
      expect(screen.getByText('Please enter a valid phone number')).toBeInTheDocument();
      expect(screen.getByText('This field is required')).toBeInTheDocument();
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
