/**
 * Example usage of the form schema generator with react-hook-form
 * 
 * This file demonstrates how to use the generateZodSchema function
 * to create dynamic forms based on form configuration.
 */

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { generateZodSchema, generateDefaultValues, getVisibleFields } from './form-schema-generator';
import { FormField } from '@/lib/types';

// Example: Dynamic Lead Form Component
export function DynamicLeadForm({ formConfig }: { formConfig: FormField[] }) {
  // Get only visible fields sorted by order
  const visibleFields = getVisibleFields(formConfig);
  
  // Generate Zod schema from form configuration
  const schema = generateZodSchema(formConfig);
  
  // Generate default values for the form
  const defaultValues = generateDefaultValues(formConfig);
  
  // Initialize react-hook-form with generated schema and defaults
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues,
  });
  
  // Handle form submission
  const onSubmit = (data: any) => {
    console.log('Form data:', data);
    // Submit to API...
  };
  
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      {visibleFields.map((field) => (
        <div key={field.id}>
          <label htmlFor={field.key}>
            {field.label}
            {field.required && <span className="text-red-500">*</span>}
          </label>
          
          {/* Render different input types based on field type */}
          {field.type === 'textarea' ? (
            <textarea
              id={field.key}
              {...register(field.key)}
              placeholder={field.placeholder}
            />
          ) : field.type === 'dropdown' ? (
            <select id={field.key} {...register(field.key)}>
              <option value="">Select {field.label}</option>
              {field.options?.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : field.type === 'checklist' ? (
            <div>
              {field.options?.map((option) => (
                <label key={option}>
                  <input
                    type="checkbox"
                    value={option}
                    {...register(field.key)}
                  />
                  {option}
                </label>
              ))}
            </div>
          ) : (
            <input
              id={field.key}
              type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
              {...register(field.key)}
              placeholder={field.placeholder}
            />
          )}
          
          {/* Display validation errors */}
          {errors[field.key] && (
            <span className="text-red-500 text-sm">
              {errors[field.key]?.message as string}
            </span>
          )}
        </div>
      ))}
      
      <button type="submit">Submit</button>
    </form>
  );
}

// Example: Using with async form config loading
export function LeadFormContainer() {
  const [formConfig, setFormConfig] = React.useState<FormField[]>([]);
  const [loading, setLoading] = React.useState(true);
  
  React.useEffect(() => {
    // Fetch form configuration from API
    async function loadFormConfig() {
      try {
        const response = await fetch('/api/form-config');
        const data = await response.json();
        setFormConfig(data.fields);
      } catch (error) {
        console.error('Failed to load form config:', error);
      } finally {
        setLoading(false);
      }
    }
    
    loadFormConfig();
  }, []);
  
  if (loading) {
    return <div>Loading form...</div>;
  }
  
  return <DynamicLeadForm formConfig={formConfig} />;
}

// Example: Validating data programmatically
export function validateLeadData(formConfig: FormField[], data: any) {
  const schema = generateZodSchema(formConfig);
  
  try {
    const validatedData = schema.parse(data);
    return { success: true, data: validatedData };
  } catch (error) {
    return { success: false, error };
  }
}
