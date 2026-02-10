import { z } from 'zod';
import { generateZodSchema, generateDefaultValues, getVisibleFields } from '@/lib/utils/form-schema-generator';
import { FormField } from '@/lib/types';

describe('Form Schema Generator', () => {
  describe('generateZodSchema', () => {
    it('should generate schema for text fields', () => {
      const fields: FormField[] = [
        {
          id: '1',
          type: 'text',
          label: 'First Name',
          key: 'firstName',
          required: true,
          visible: true,
          order: 1,
        },
      ];

      const schema = generateZodSchema(fields);
      
      // Valid data should pass
      expect(() => schema.parse({ firstName: 'John' })).not.toThrow();
      
      // Empty required field should fail
      expect(() => schema.parse({ firstName: '' })).toThrow();
    });

    it('should generate schema for email fields with format validation', () => {
      const fields: FormField[] = [
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
      
      // Valid email should pass
      expect(() => schema.parse({ email: 'test@example.com' })).not.toThrow();
      
      // Invalid email should fail
      expect(() => schema.parse({ email: 'invalid-email' })).toThrow();
      expect(() => schema.parse({ email: 'test@' })).toThrow();
      expect(() => schema.parse({ email: '@example.com' })).toThrow();
    });

    it('should generate schema for phone fields with format validation', () => {
      const fields: FormField[] = [
        {
          id: '1',
          type: 'phone',
          label: 'Phone',
          key: 'phone',
          required: true,
          visible: true,
          order: 1,
        },
      ];

      const schema = generateZodSchema(fields);
      
      // Valid phone numbers should pass
      expect(() => schema.parse({ phone: '+1234567890' })).not.toThrow();
      expect(() => schema.parse({ phone: '1234567890' })).not.toThrow();
      expect(() => schema.parse({ phone: '123-456-7890' })).not.toThrow();
      expect(() => schema.parse({ phone: '(123) 456-7890' })).not.toThrow();
      
      // Invalid phone should fail
      expect(() => schema.parse({ phone: 'abc' })).toThrow();
      expect(() => schema.parse({ phone: '123' })).toThrow();
    });

    it('should generate schema for dropdown fields with enum validation', () => {
      const fields: FormField[] = [
        {
          id: '1',
          type: 'dropdown',
          label: 'Status',
          key: 'status',
          required: true,
          visible: true,
          order: 1,
          options: ['New', 'Contacted', 'Qualified'],
        },
      ];

      const schema = generateZodSchema(fields);
      
      // Valid option should pass
      expect(() => schema.parse({ status: 'New' })).not.toThrow();
      expect(() => schema.parse({ status: 'Contacted' })).not.toThrow();
      
      // Invalid option should fail
      expect(() => schema.parse({ status: 'InvalidStatus' })).toThrow();
    });

    it('should generate schema for textarea fields', () => {
      const fields: FormField[] = [
        {
          id: '1',
          type: 'textarea',
          label: 'Notes',
          key: 'notes',
          required: false,
          visible: true,
          order: 1,
        },
      ];

      const schema = generateZodSchema(fields);
      
      // Valid textarea content should pass
      expect(() => schema.parse({ notes: 'Some notes here' })).not.toThrow();
      expect(() => schema.parse({ notes: '' })).not.toThrow();
      expect(() => schema.parse({})).not.toThrow();
    });

    it('should generate schema for checklist fields', () => {
      const fields: FormField[] = [
        {
          id: '1',
          type: 'checklist',
          label: 'Interests',
          key: 'interests',
          required: true,
          visible: true,
          order: 1,
          options: ['Option1', 'Option2', 'Option3'],
        },
      ];

      const schema = generateZodSchema(fields);
      
      // Valid selections should pass
      expect(() => schema.parse({ interests: ['Option1'] })).not.toThrow();
      expect(() => schema.parse({ interests: ['Option1', 'Option2'] })).not.toThrow();
      
      // Empty required checklist should fail
      expect(() => schema.parse({ interests: [] })).toThrow();
      
      // Invalid option should fail
      expect(() => schema.parse({ interests: ['InvalidOption'] })).toThrow();
    });

    it('should apply required validation correctly', () => {
      const fields: FormField[] = [
        {
          id: '1',
          type: 'text',
          label: 'Required Field',
          key: 'requiredField',
          required: true,
          visible: true,
          order: 1,
        },
        {
          id: '2',
          type: 'text',
          label: 'Optional Field',
          key: 'optionalField',
          required: false,
          visible: true,
          order: 2,
        },
      ];

      const schema = generateZodSchema(fields);
      
      // Required field must have value
      expect(() => schema.parse({ requiredField: 'value', optionalField: '' })).not.toThrow();
      expect(() => schema.parse({ requiredField: '', optionalField: '' })).toThrow();
      
      // Optional field can be empty
      expect(() => schema.parse({ requiredField: 'value' })).not.toThrow();
      expect(() => schema.parse({ requiredField: 'value', optionalField: 'value' })).not.toThrow();
    });

    it('should apply custom validation patterns', () => {
      const fields: FormField[] = [
        {
          id: '1',
          type: 'text',
          label: 'SSN Last 4',
          key: 'ssnLast4',
          required: false,
          visible: true,
          order: 1,
          validation: {
            pattern: '^\\d{4}$',
            minLength: 4,
            maxLength: 4,
          },
        },
      ];

      const schema = generateZodSchema(fields);
      
      // Valid SSN should pass
      expect(() => schema.parse({ ssnLast4: '1234' })).not.toThrow();
      
      // Invalid patterns should fail
      expect(() => schema.parse({ ssnLast4: '123' })).toThrow();
      expect(() => schema.parse({ ssnLast4: '12345' })).toThrow();
      expect(() => schema.parse({ ssnLast4: 'abcd' })).toThrow();
      
      // Empty optional field should pass
      expect(() => schema.parse({ ssnLast4: '' })).not.toThrow();
      expect(() => schema.parse({})).not.toThrow();
    });

    it('should apply minLength and maxLength validation', () => {
      const fields: FormField[] = [
        {
          id: '1',
          type: 'text',
          label: 'Username',
          key: 'username',
          required: true,
          visible: true,
          order: 1,
          validation: {
            minLength: 3,
            maxLength: 20,
          },
        },
      ];

      const schema = generateZodSchema(fields);
      
      // Valid length should pass
      expect(() => schema.parse({ username: 'john' })).not.toThrow();
      expect(() => schema.parse({ username: 'johndoe' })).not.toThrow();
      
      // Too short should fail
      expect(() => schema.parse({ username: 'ab' })).toThrow();
      
      // Too long should fail
      expect(() => schema.parse({ username: 'a'.repeat(21) })).toThrow();
    });

    it('should skip hidden fields', () => {
      const fields: FormField[] = [
        {
          id: '1',
          type: 'text',
          label: 'Visible Field',
          key: 'visibleField',
          required: true,
          visible: true,
          order: 1,
        },
        {
          id: '2',
          type: 'text',
          label: 'Hidden Field',
          key: 'hiddenField',
          required: true,
          visible: false,
          order: 2,
        },
      ];

      const schema = generateZodSchema(fields);
      
      // Should only validate visible field
      expect(() => schema.parse({ visibleField: 'value' })).not.toThrow();
      
      // Hidden field should not be required in validation
      const result = schema.parse({ visibleField: 'value' });
      expect(result).toEqual({ visibleField: 'value' });
    });

    it('should handle multiple fields with different types', () => {
      const fields: FormField[] = [
        {
          id: '1',
          type: 'text',
          label: 'Name',
          key: 'name',
          required: true,
          visible: true,
          order: 1,
        },
        {
          id: '2',
          type: 'email',
          label: 'Email',
          key: 'email',
          required: true,
          visible: true,
          order: 2,
        },
        {
          id: '3',
          type: 'phone',
          label: 'Phone',
          key: 'phone',
          required: false,
          visible: true,
          order: 3,
        },
        {
          id: '4',
          type: 'dropdown',
          label: 'Status',
          key: 'status',
          required: true,
          visible: true,
          order: 4,
          options: ['Active', 'Inactive'],
        },
      ];

      const schema = generateZodSchema(fields);
      
      // Valid data should pass
      const validData = {
        name: 'John Doe',
        email: 'john@example.com',
        phone: '1234567890',
        status: 'Active',
      };
      expect(() => schema.parse(validData)).not.toThrow();
      
      // Invalid email should fail
      expect(() => schema.parse({ ...validData, email: 'invalid' })).toThrow();
      
      // Invalid status should fail
      expect(() => schema.parse({ ...validData, status: 'Unknown' })).toThrow();
    });
  });

  describe('generateDefaultValues', () => {
    it('should generate default values for all visible fields', () => {
      const fields: FormField[] = [
        {
          id: '1',
          type: 'text',
          label: 'Name',
          key: 'name',
          required: true,
          visible: true,
          order: 1,
        },
        {
          id: '2',
          type: 'dropdown',
          label: 'Status',
          key: 'status',
          required: true,
          visible: true,
          order: 2,
          options: ['New', 'Active'],
        },
        {
          id: '3',
          type: 'checklist',
          label: 'Tags',
          key: 'tags',
          required: false,
          visible: true,
          order: 3,
          options: ['Tag1', 'Tag2'],
        },
      ];

      const defaults = generateDefaultValues(fields);
      
      expect(defaults).toEqual({
        name: '',
        status: 'New', // First option for required dropdown
        tags: [], // Empty array for checklist
      });
    });

    it('should skip hidden fields', () => {
      const fields: FormField[] = [
        {
          id: '1',
          type: 'text',
          label: 'Visible',
          key: 'visible',
          required: true,
          visible: true,
          order: 1,
        },
        {
          id: '2',
          type: 'text',
          label: 'Hidden',
          key: 'hidden',
          required: true,
          visible: false,
          order: 2,
        },
      ];

      const defaults = generateDefaultValues(fields);
      
      expect(defaults).toEqual({
        visible: '',
      });
      expect(defaults).not.toHaveProperty('hidden');
    });
  });

  describe('getVisibleFields', () => {
    it('should filter and sort visible fields', () => {
      const fields: FormField[] = [
        {
          id: '3',
          type: 'text',
          label: 'Third',
          key: 'third',
          required: true,
          visible: true,
          order: 3,
        },
        {
          id: '1',
          type: 'text',
          label: 'First',
          key: 'first',
          required: true,
          visible: true,
          order: 1,
        },
        {
          id: '2',
          type: 'text',
          label: 'Hidden',
          key: 'hidden',
          required: true,
          visible: false,
          order: 2,
        },
        {
          id: '4',
          type: 'text',
          label: 'Second',
          key: 'second',
          required: true,
          visible: true,
          order: 2,
        },
      ];

      const visibleFields = getVisibleFields(fields);
      
      expect(visibleFields).toHaveLength(3);
      expect(visibleFields[0].key).toBe('first');
      expect(visibleFields[1].key).toBe('second');
      expect(visibleFields[2].key).toBe('third');
    });

    it('should return empty array when no visible fields', () => {
      const fields: FormField[] = [
        {
          id: '1',
          type: 'text',
          label: 'Hidden',
          key: 'hidden',
          required: true,
          visible: false,
          order: 1,
        },
      ];

      const visibleFields = getVisibleFields(fields);
      
      expect(visibleFields).toHaveLength(0);
    });
  });
});
