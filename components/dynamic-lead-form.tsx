'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormField } from '@/lib/types';
import { generateZodSchema, getVisibleFields } from '@/lib/utils/form-schema-generator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/contexts/auth-context';
import { LeadAssignmentDropdown } from '@/components/lead-assignment-dropdown';

interface DynamicLeadFormProps {
  formConfig: FormField[];
  onSubmit: (data: Record<string, any>) => void | Promise<void>;
  defaultValues?: Record<string, any>;
  submitLabel?: string;
  isLoading?: boolean;
}

/**
 * DynamicLeadForm Component
 *
 * Renders a dynamic form based on form configuration with the following features:
 * - Filters fields by visible=true for agents (managers see all fields in builder)
 * - Sorts fields by order property
 * - Renders fields based on type (text, email, phone, dropdown, textarea, checklist)
 * - Applies generated zod schema for validation
 * - Displays field-level error messages
 *
 * Requirements: 3.8, 3.9, 10.4, 10.5, 11.4, 11.5
 */
export function DynamicLeadForm({
  formConfig,
  onSubmit,
  defaultValues = {},
  submitLabel = 'Submit',
  isLoading = false,
}: DynamicLeadFormProps) {
  const { user, isAgent } = useAuth();

  // State for the lead assignment dropdown (Requirement 4.2, 4.3, 4.4)
  // Agents auto-assign to themselves; managers/team leads pick from dropdown
  const [assignedToId, setAssignedToId] = useState<string | null>(
    isAgent && user ? user.$id : null
  );

  // Filter out ownerId and assignedToId from configurable form fields (Requirement 4.5)
  // These are handled automatically: ownerId by createLead, assignedToId by the dropdown
  const filteredConfig = formConfig.filter(
    (f) => f.key !== 'ownerId' && f.key !== 'assignedToId'
  );

  // Filter visible fields for agents (Requirement 3.8)
  // Managers see all fields in form builder, but in lead forms, we filter for agents
  const visibleFields = isAgent
    ? getVisibleFields(filteredConfig)
    : filteredConfig.filter(f => f.visible).sort((a, b) => a.order - b.order);

  // Generate zod schema from form config (Requirements 10.5, 11.1, 11.2, 11.3)
  const schema = generateZodSchema(filteredConfig);

  // Initialize react-hook-form (Requirement 10.4)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    watch,
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues,
  });

  const handleFormSubmit = async (data: Record<string, any>) => {
    // Inject assignedToId into the submitted data (Requirement 4.2, 4.3, 4.4)
    const submissionData = {
      ...data,
      ...(assignedToId ? { assignedToId } : {}),
    };
    await onSubmit(submissionData);
  };

  /**
   * Render field based on type
   */
  const renderField = (field: FormField) => {
    const error = errors[field.key];
    const errorMessage = error?.message as string | undefined;

    switch (field.type) {
      case 'text':
      case 'email':
      case 'phone':
        return (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={field.key}>
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <Input
              id={field.key}
              type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
              placeholder={field.placeholder}
              {...register(field.key)}
              className={error ? 'border-red-500' : ''}
            />
            {errorMessage && (
              <p className="text-sm text-red-500">{errorMessage}</p>
            )}
          </div>
        );

      case 'textarea':
        return (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={field.key}>
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <textarea
              id={field.key}
              placeholder={field.placeholder}
              {...register(field.key)}
              className={`flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                error ? 'border-red-500' : ''
              }`}
              rows={4}
            />
            {errorMessage && (
              <p className="text-sm text-red-500">{errorMessage}</p>
            )}
          </div>
        );

      case 'dropdown':
        return (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={field.key}>
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <select
              id={field.key}
              {...register(field.key)}
              className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                error ? 'border-red-500' : ''
              }`}
            >
              <option value="">Select {field.label}</option>
              {field.options?.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {errorMessage && (
              <p className="text-sm text-red-500">{errorMessage}</p>
            )}
          </div>
        );

      case 'checklist':
        return (
          <div key={field.id} className="space-y-2">
            <Label>
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            <div className="space-y-2">
              {field.options?.map((option, index) => (
                <div key={option} className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id={`${field.key}-${index}`}
                    value={option}
                    {...register(field.key)}
                    className="h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
                  />
                  <Label
                    htmlFor={`${field.key}-${index}`}
                    className="text-sm font-normal cursor-pointer"
                  >
                    {option}
                  </Label>
                </div>
              ))}
            </div>
            {errorMessage && (
              <p className="text-sm text-red-500">{errorMessage}</p>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
      {/* Lead Assignment Dropdown - role-aware (Requirements 4.2, 4.3, 4.4) */}
      {user && (
        <LeadAssignmentDropdown
          creatorRole={user.role}
          creatorBranchIds={user.branchIds ?? []}
          creatorId={user.$id}
          value={assignedToId}
          onChange={setAssignedToId}
        />
      )}

      {/* Render fields in order (Requirement 3.8) */}
      {visibleFields.map((field) => renderField(field))}

      {/* Submit button - disabled when invalid (Requirement 11.5) */}
      <div className="flex justify-end space-x-4">
        <Button
          type="submit"
          disabled={isLoading || isSubmitting}
          className="min-w-[120px]"
        >
          {isLoading || isSubmitting ? 'Submitting...' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
