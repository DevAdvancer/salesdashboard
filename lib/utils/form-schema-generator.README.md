# Form Schema Generator

## Overview

The Form Schema Generator is a utility that dynamically generates Zod validation schemas from form configuration objects. This enables the SalesHub CRM to have fully configurable forms where managers can define fields, validation rules, and requirements without writing code.

## Features

- **Dynamic Schema Generation**: Automatically creates Zod schemas from FormField configurations
- **Type-Safe Validation**: Leverages Zod for runtime type checking and validation
- **Field Type Support**: Handles text, email, phone, dropdown, textarea, and checklist fields
- **Custom Validation**: Supports regex patterns, min/max length constraints
- **Required/Optional Fields**: Automatically applies required validation based on configuration
- **Format Validation**: Built-in email and phone number format validation
- **Enum Validation**: Dropdown fields validate against configured options

## Requirements Satisfied

- **3.9**: Validate required fields based on Form_Config
- **10.4**: Use react-hook-form for form state management
- **10.5**: Use zod schemas generated from Form_Config
- **11.1**: Enforce required validation on form submission
- **11.2**: Validate email format
- **11.3**: Validate phone number format

## API Reference

### `generateZodSchema(formConfig: FormField[]): z.ZodObject<any>`

Generates a Zod schema object from an array of form field configurations.

**Parameters:**
- `formConfig`: Array of `FormField` objects defining the form structure

**Returns:**
- Zod object schema that can be used with `zodResolver` in react-hook-form

**Example:**
```typescript
import { generateZodSchema } from '@/lib/utils/form-schema-generator';

const fields = [
  {
    id: '1',
    type: 'email',
    label: 'Email',
    key: 'email',
    required: true,
    visible: true,
    order: 1,
  },
];

const schema = generateZodSchema(fields);
// Use with react-hook-form
const form = useForm({
  resolver: zodResolver(schema),
});
```

### `generateDefaultValues(formConfig: FormField[]): Record<string, any>`

Generates default values for form initialization based on field types.

**Parameters:**
- `formConfig`: Array of `FormField` objects

**Returns:**
- Object with default values for each visible field

**Default Values by Type:**
- `text`, `email`, `phone`, `textarea`, `dropdown` (optional): `''` (empty string)
- `dropdown` (required): First option from `options` array
- `checklist`: `[]` (empty array)

**Example:**
```typescript
const defaults = generateDefaultValues(fields);
// { email: '', phone: '', status: 'New', tags: [] }
```

### `getVisibleFields(formConfig: FormField[]): FormField[]`

Filters and sorts fields to return only visible fields in display order.

**Parameters:**
- `formConfig`: Array of `FormField` objects

**Returns:**
- Array of visible fields sorted by `order` property

**Example:**
```typescript
const visibleFields = getVisibleFields(fields);
// Only fields where visible=true, sorted by order
```

## Field Type Validation

### Text Fields
- Basic string validation
- Supports custom regex patterns via `validation.pattern`
- Supports min/max length via `validation.minLength` and `validation.maxLength`

```typescript
{
  type: 'text',
  validation: {
    pattern: '^[A-Z][a-z]+$',
    minLength: 2,
    maxLength: 50,
  }
}
```

### Email Fields
- Validates email format using Zod's built-in email validator
- Error message: "Please enter a valid email address"

```typescript
{
  type: 'email',
  label: 'Email Address',
  key: 'email',
  required: true,
}
```

### Phone Fields
- Validates phone number format with flexible regex
- Accepts formats: `+1234567890`, `(123) 456-7890`, `123-456-7890`
- Requires minimum 10 digits
- Error message: "Please enter a valid phone number"

```typescript
{
  type: 'phone',
  label: 'Phone Number',
  key: 'phone',
  required: false,
}
```

### Dropdown Fields
- Validates selection against configured options
- Uses Zod enum for strict validation
- Error message: "Please select a valid [field label]"

```typescript
{
  type: 'dropdown',
  label: 'Status',
  key: 'status',
  options: ['New', 'Active', 'Closed'],
  required: true,
}
```

### Textarea Fields
- Multi-line text input
- Same validation as text fields

```typescript
{
  type: 'textarea',
  label: 'Notes',
  key: 'notes',
  required: false,
}
```

### Checklist Fields
- Array of selected values
- Validates each selection against configured options
- Required checklists must have at least one selection

```typescript
{
  type: 'checklist',
  label: 'Interests',
  key: 'interests',
  options: ['Option1', 'Option2', 'Option3'],
  required: false,
}
```

## Required vs Optional Fields

### Required Fields
- Must have a non-empty value
- Strings: minimum length of 1
- Arrays: minimum length of 1
- Error message: "[Field label] is required"

### Optional Fields
- Can be empty or undefined
- Strings: accepts empty string `''`
- Arrays: accepts empty array `[]`
- Still validates format if value is provided

## Usage with React Hook Form

```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { generateZodSchema, generateDefaultValues } from '@/lib/utils/form-schema-generator';

function MyForm({ formConfig }) {
  const schema = generateZodSchema(formConfig);
  const defaults = generateDefaultValues(formConfig);
  
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });
  
  const onSubmit = (data) => {
    console.log('Valid data:', data);
  };
  
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      {/* Render fields dynamically */}
    </form>
  );
}
```

## Error Messages

All validation errors include user-friendly messages:

- **Required**: "[Field label] is required"
- **Email**: "Please enter a valid email address"
- **Phone**: "Please enter a valid phone number"
- **Dropdown**: "Please select a valid [field label]"
- **Pattern**: "Please enter a valid [field label]"
- **Min Length**: "[Field label] must be at least [n] characters"
- **Max Length**: "[Field label] must be at most [n] characters"

## Hidden Fields

Fields with `visible: false` are automatically excluded from:
- Schema validation
- Default values generation
- Visible fields list

This allows for internal fields (like `ownerId`, `assignedToId`) that are set programmatically rather than by user input.

## Testing

The form schema generator includes comprehensive unit tests covering:
- All field types
- Required/optional validation
- Format validation (email, phone)
- Custom validation patterns
- Length constraints
- Dropdown enum validation
- Hidden field handling
- Multiple field combinations

Run tests:
```bash
npm test -- tests/unit/form-schema-generator.test.ts
```

## Integration with Form Builder

The form schema generator works seamlessly with the Form Builder system:

1. Manager configures form fields in Form Builder
2. Configuration is saved to `form_config` collection
3. Form component fetches configuration
4. `generateZodSchema()` creates validation schema
5. Form renders with dynamic validation

This creates a complete no-code form configuration system where managers control all aspects of form behavior without developer intervention.
