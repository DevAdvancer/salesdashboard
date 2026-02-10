import { z } from 'zod';
import { FormField } from '@/lib/types';

/**
 * Generate a Zod schema from form configuration
 * 
 * This function takes a form configuration (array of FormField objects) and generates
 * a Zod schema that can be used for form validation with react-hook-form.
 * 
 * Requirements:
 * - 3.9: Validate required fields based on Form_Config
 * - 10.4: Use react-hook-form for form state management
 * - 10.5: Use zod schemas generated from Form_Config
 * - 11.1: Enforce required validation on form submission
 * - 11.2: Validate email format
 * - 11.3: Validate phone number format
 * 
 * @param formConfig - Array of form field configurations
 * @returns Zod schema object for form validation
 */
export function generateZodSchema(formConfig: FormField[]): z.ZodObject<any> {
  const schemaShape: Record<string, z.ZodTypeAny> = {};

  for (const field of formConfig) {
    // Skip hidden fields - they don't need validation in the form
    if (!field.visible) {
      continue;
    }

    let fieldSchema: z.ZodTypeAny;

    // Map field types to appropriate Zod validators
    switch (field.type) {
      case 'email':
        // Email validation with format checking (Requirement 11.2)
        fieldSchema = z
          .string()
          .email('Please enter a valid email address');
        break;

      case 'phone':
        // Phone validation with format checking (Requirement 11.3)
        // Accepts formats like: +1234567890, (123) 456-7890, 123-456-7890, +1 (123) 456-7890, etc.
        // Requires at least 10 digits total
        fieldSchema = z
          .string()
          .refine(
            (val) => {
              // Remove all non-digit characters to count digits
              const digits = val.replace(/\D/g, '');
              // Must have at least 10 digits
              if (digits.length < 10) return false;
              // Must match phone pattern
              return /^[\+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,4}[-\s\.]?[0-9]{1,9}$/.test(val);
            },
            { message: 'Please enter a valid phone number' }
          );
        break;

      case 'dropdown':
        // Dropdown validation with enum constraint
        if (field.options && field.options.length > 0) {
          // Create enum from options array
          fieldSchema = z.enum(field.options as [string, ...string[]]);
        } else {
          // Fallback to string if no options defined
          fieldSchema = z.string();
        }
        break;

      case 'textarea':
        // Textarea is just a multi-line text field
        fieldSchema = z.string();
        break;

      case 'checklist':
        // Checklist returns an array of selected values
        if (field.options && field.options.length > 0) {
          fieldSchema = z.array(z.enum(field.options as [string, ...string[]]));
        } else {
          fieldSchema = z.array(z.string());
        }
        break;

      case 'text':
      default:
        // Default text field validation
        fieldSchema = z.string();
        break;
    }

    // Apply custom validation rules if specified
    if (field.validation) {
      if (field.type === 'text' && fieldSchema instanceof z.ZodString) {
        // Apply pattern validation
        if (field.validation.pattern) {
          fieldSchema = fieldSchema.regex(
            new RegExp(field.validation.pattern),
            `Please enter a valid ${field.label.toLowerCase()}`
          );
        }

        // Apply length constraints
        if (field.validation.minLength !== undefined) {
          fieldSchema = fieldSchema.min(
            field.validation.minLength,
            `${field.label} must be at least ${field.validation.minLength} characters`
          );
        }

        if (field.validation.maxLength !== undefined) {
          fieldSchema = fieldSchema.max(
            field.validation.maxLength,
            `${field.label} must be at most ${field.validation.maxLength} characters`
          );
        }
      }
    }

    // Apply required/optional based on field configuration (Requirements 3.9, 11.1)
    if (field.required) {
      // For required fields, ensure non-empty values
      if (fieldSchema instanceof z.ZodString) {
        fieldSchema = fieldSchema.min(1, `${field.label} is required`);
      } else if (fieldSchema instanceof z.ZodArray) {
        fieldSchema = fieldSchema.min(1, `${field.label} is required`);
      }
    } else {
      // For optional fields, allow empty strings or undefined
      if (fieldSchema instanceof z.ZodString) {
        // Allow empty strings for optional text fields
        fieldSchema = fieldSchema.optional().or(z.literal(''));
      } else if (fieldSchema instanceof z.ZodArray) {
        fieldSchema = fieldSchema.optional();
      } else if (fieldSchema instanceof z.ZodEnum) {
        // For optional enums (dropdowns), allow empty string
        fieldSchema = fieldSchema.optional().or(z.literal(''));
      } else {
        fieldSchema = fieldSchema.optional();
      }
    }

    // Add the field schema to the shape object using the field's key
    schemaShape[field.key] = fieldSchema;
  }

  // Return a Zod object schema
  return z.object(schemaShape);
}

/**
 * Generate default values for a form based on form configuration
 * 
 * This helper function creates an object with default values for all fields,
 * which can be used to initialize react-hook-form.
 * 
 * @param formConfig - Array of form field configurations
 * @returns Object with default values for each field
 */
export function generateDefaultValues(formConfig: FormField[]): Record<string, any> {
  const defaultValues: Record<string, any> = {};

  for (const field of formConfig) {
    // Skip hidden fields
    if (!field.visible) {
      continue;
    }

    // Set appropriate default values based on field type
    switch (field.type) {
      case 'checklist':
        defaultValues[field.key] = [];
        break;
      case 'dropdown':
        // Use first option as default if field is required
        defaultValues[field.key] = field.required && field.options?.[0] ? field.options[0] : '';
        break;
      default:
        defaultValues[field.key] = '';
        break;
    }
  }

  return defaultValues;
}

/**
 * Filter visible fields from form configuration
 * 
 * Helper function to get only the fields that should be displayed to users.
 * 
 * @param formConfig - Array of form field configurations
 * @returns Array of visible fields sorted by order
 */
export function getVisibleFields(formConfig: FormField[]): FormField[] {
  return formConfig
    .filter((field) => field.visible)
    .sort((a, b) => a.order - b.order);
}
