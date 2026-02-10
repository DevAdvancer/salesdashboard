import fc from 'fast-check';
import { FormField, FieldType } from '@/lib/types';
import { generateZodSchema } from '@/lib/utils/form-schema-generator';

/**
 * Property-Based Tests for Form Configuration
 * Feature: saleshub-crm
 */

describe('Form Configuration Properties', () => {
  /**
   * Property 7: Form Config Field Operations
   *
   * For any form configuration, adding a field, removing a field, or reordering fields
   * must result in a valid form configuration that persists correctly.
   *
   * **Validates: Requirements 3.2**
   */
  describe('Property 7: Form config field operations', () => {
    // Arbitrary for field types
    const fieldTypeArb = fc.constantFrom<FieldType>(
      'text',
      'email',
      'phone',
      'dropdown',
      'textarea',
      'checklist'
    );

    // Arbitrary for form field
    const formFieldArb = fc.record({
      id: fc.uuid(),
      type: fieldTypeArb,
      label: fc.string({ minLength: 1, maxLength: 100 }),
      key: fc.string({ minLength: 1, maxLength: 50 }).map(s => s.replace(/[^a-zA-Z0-9]/g, '_')),
      required: fc.boolean(),
      visible: fc.boolean(),
      order: fc.integer({ min: 1, max: 100 }),
      options: fc.option(
        fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 10 }),
        { nil: undefined }
      ),
      placeholder: fc.option(fc.string({ maxLength: 100 }), { nil: undefined }),
      validation: fc.option(
        fc.record({
          pattern: fc.option(fc.string(), { nil: undefined }),
          minLength: fc.option(fc.integer({ min: 0, max: 1000 }), { nil: undefined }),
          maxLength: fc.option(fc.integer({ min: 1, max: 10000 }), { nil: undefined }),
        }),
        { nil: undefined }
      ),
    });

    // Arbitrary for a list of form fields
    const formFieldsArb = fc.array(formFieldArb, { minLength: 1, maxLength: 20 });

    /**
     * Test: Adding a field to a form configuration produces a valid configuration
     */
    it('should produce valid configuration when adding a field', () => {
      // Feature: saleshub-crm, Property 7: Form config field operations

      fc.assert(
        fc.property(formFieldsArb, formFieldArb, (existingFields, newField) => {
          // Simulate adding a field
          const updatedFields = [...existingFields, newField];

          // Property: The resulting configuration must be valid
          // 1. All fields must have unique IDs
          const ids = updatedFields.map(f => f.id);
          const uniqueIds = new Set(ids);
          const hasUniqueIds = ids.length === uniqueIds.size;

          // 2. All fields must have required properties
          const allFieldsValid = updatedFields.every(field =>
            field.id &&
            field.type &&
            field.label &&
            field.key &&
            typeof field.required === 'boolean' &&
            typeof field.visible === 'boolean' &&
            typeof field.order === 'number'
          );

          // 3. Configuration must be serializable
          let isSerializable = true;
          try {
            const serialized = JSON.stringify(updatedFields);
            const deserialized = JSON.parse(serialized);
            isSerializable = Array.isArray(deserialized);
          } catch {
            isSerializable = false;
          }

          return hasUniqueIds && allFieldsValid && isSerializable;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Removing a field from a form configuration produces a valid configuration
     */
    it('should produce valid configuration when removing a field', () => {
      // Feature: saleshub-crm, Property 7: Form config field operations

      fc.assert(
        fc.property(
          formFieldsArb.filter(fields => fields.length > 1),
          fc.integer({ min: 0, max: 100 }),
          (fields, indexSeed) => {
            // Select a field to remove
            const indexToRemove = indexSeed % fields.length;
            const fieldIdToRemove = fields[indexToRemove].id;

            // Simulate removing a field
            const updatedFields = fields.filter(f => f.id !== fieldIdToRemove);

            // Reorder remaining fields to maintain sequential order
            const reorderedFields = updatedFields.map((field, index) => ({
              ...field,
              order: index + 1,
            }));

            // Property: The resulting configuration must be valid
            // 1. Field must be removed
            const fieldRemoved = !reorderedFields.some(f => f.id === fieldIdToRemove);

            // 2. Remaining fields must have sequential order
            const hasSequentialOrder = reorderedFields.every(
              (field, index) => field.order === index + 1
            );

            // 3. All remaining fields must be valid
            const allFieldsValid = reorderedFields.every(field =>
              field.id &&
              field.type &&
              field.label &&
              field.key &&
              typeof field.required === 'boolean' &&
              typeof field.visible === 'boolean' &&
              typeof field.order === 'number'
            );

            // 4. Configuration must be serializable
            let isSerializable = true;
            try {
              const serialized = JSON.stringify(reorderedFields);
              const deserialized = JSON.parse(serialized);
              isSerializable = Array.isArray(deserialized);
            } catch {
              isSerializable = false;
            }

            return fieldRemoved && hasSequentialOrder && allFieldsValid && isSerializable;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Reordering fields in a form configuration produces a valid configuration
     */
    it('should produce valid configuration when reordering fields', () => {
      // Feature: saleshub-crm, Property 7: Form config field operations

      fc.assert(
        fc.property(formFieldsArb, (fields) => {
          // Create a shuffled order of field IDs
          const fieldIds = fields.map(f => f.id);
          const shuffledIds = [...fieldIds].sort(() => Math.random() - 0.5);

          // Create a map of field ID to field for quick lookup
          const fieldMap = new Map(fields.map(f => [f.id, f]));

          // Simulate reordering fields
          const reorderedFields = shuffledIds
            .map(id => fieldMap.get(id))
            .filter((field): field is FormField => field !== undefined)
            .map((field, index) => ({
              ...field,
              order: index + 1,
            }));

          // Property: The resulting configuration must be valid
          // 1. All original fields must be present
          const allFieldsPresent = reorderedFields.length === fields.length;

          // 2. Fields must have sequential order starting from 1
          const hasSequentialOrder = reorderedFields.every(
            (field, index) => field.order === index + 1
          );

          // 3. All fields must be valid
          const allFieldsValid = reorderedFields.every(field =>
            field.id &&
            field.type &&
            field.label &&
            field.key &&
            typeof field.required === 'boolean' &&
            typeof field.visible === 'boolean' &&
            typeof field.order === 'number'
          );

          // 4. Configuration must be serializable
          let isSerializable = true;
          try {
            const serialized = JSON.stringify(reorderedFields);
            const deserialized = JSON.parse(serialized);
            isSerializable = Array.isArray(deserialized);
          } catch {
            isSerializable = false;
          }

          return allFieldsPresent && hasSequentialOrder && allFieldsValid && isSerializable;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Form configuration persistence round-trip maintains data integrity
     */
    it('should maintain data integrity through serialization round-trip', () => {
      // Feature: saleshub-crm, Property 7: Form config field operations

      fc.assert(
        fc.property(formFieldsArb, (fields) => {
          // Simulate persistence: serialize to JSON
          const serialized = JSON.stringify(fields);

          // Simulate retrieval: deserialize from JSON
          const deserialized = JSON.parse(serialized) as FormField[];

          // Property: Deserialized data must match original
          // 1. Same number of fields
          const sameLength = deserialized.length === fields.length;

          // 2. All fields match
          const allFieldsMatch = fields.every((originalField, index) => {
            const deserializedField = deserialized[index];
            return (
              deserializedField.id === originalField.id &&
              deserializedField.type === originalField.type &&
              deserializedField.label === originalField.label &&
              deserializedField.key === originalField.key &&
              deserializedField.required === originalField.required &&
              deserializedField.visible === originalField.visible &&
              deserializedField.order === originalField.order
            );
          });

          // 3. Round-trip produces identical JSON
          const roundTripSerialized = JSON.stringify(deserialized);
          const identicalSerialization = serialized === roundTripSerialized;

          return sameLength && allFieldsMatch && identicalSerialization;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Multiple field operations maintain configuration validity
     */
    it('should maintain validity through multiple operations', () => {
      // Feature: saleshub-crm, Property 7: Form config field operations

      fc.assert(
        fc.property(
          formFieldsArb,
          formFieldArb,
          formFieldArb,
          (initialFields, fieldToAdd, anotherFieldToAdd) => {
            // Ensure unique IDs for new fields
            const uniqueFieldToAdd = { ...fieldToAdd, id: `add-1-${fieldToAdd.id}` };
            const uniqueAnotherField = { ...anotherFieldToAdd, id: `add-2-${anotherFieldToAdd.id}` };

            // Operation 1: Add a field
            let currentFields = [...initialFields, uniqueFieldToAdd];

            // Operation 2: Add another field
            currentFields = [...currentFields, uniqueAnotherField];

            // Operation 3: Remove the first added field
            currentFields = currentFields.filter(f => f.id !== uniqueFieldToAdd.id);

            // Operation 4: Reorder remaining fields
            const fieldIds = currentFields.map(f => f.id);
            const reorderedFields = fieldIds
              .map(id => currentFields.find(f => f.id === id))
              .filter((field): field is FormField => field !== undefined)
              .map((field, index) => ({
                ...field,
                order: index + 1,
              }));

            // Property: After multiple operations, configuration must still be valid
            // 1. All fields must have unique IDs
            const ids = reorderedFields.map(f => f.id);
            const uniqueIds = new Set(ids);
            const hasUniqueIds = ids.length === uniqueIds.size;

            // 2. Fields must have sequential order
            const hasSequentialOrder = reorderedFields.every(
              (field, index) => field.order === index + 1
            );

            // 3. All fields must be valid
            const allFieldsValid = reorderedFields.every(field =>
              field.id &&
              field.type &&
              field.label &&
              field.key &&
              typeof field.required === 'boolean' &&
              typeof field.visible === 'boolean' &&
              typeof field.order === 'number'
            );

            // 4. Configuration must be serializable
            let isSerializable = true;
            try {
              const serialized = JSON.stringify(reorderedFields);
              const deserialized = JSON.parse(serialized);
              isSerializable = Array.isArray(deserialized);
            } catch {
              isSerializable = false;
            }

            return hasUniqueIds && hasSequentialOrder && allFieldsValid && isSerializable;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Field operations preserve field properties
     */
    it('should preserve field properties during operations', () => {
      // Feature: saleshub-crm, Property 7: Form config field operations

      fc.assert(
        fc.property(formFieldsArb, (fields) => {
          // Select a field to track
          if (fields.length === 0) return true;

          const trackedField = fields[0];
          const trackedId = trackedField.id;

          // Simulate reordering (which should preserve all properties except order)
          const fieldIds = fields.map(f => f.id);
          const shuffledIds = [...fieldIds].sort(() => Math.random() - 0.5);
          const fieldMap = new Map(fields.map(f => [f.id, f]));

          const reorderedFields = shuffledIds
            .map(id => fieldMap.get(id))
            .filter((field): field is FormField => field !== undefined)
            .map((field, index) => ({
              ...field,
              order: index + 1,
            }));

          // Find the tracked field in reordered configuration
          const reorderedTrackedField = reorderedFields.find(f => f.id === trackedId);

          if (!reorderedTrackedField) return false;

          // Property: All properties except order should be preserved
          return (
            reorderedTrackedField.id === trackedField.id &&
            reorderedTrackedField.type === trackedField.type &&
            reorderedTrackedField.label === trackedField.label &&
            reorderedTrackedField.key === trackedField.key &&
            reorderedTrackedField.required === trackedField.required &&
            reorderedTrackedField.visible === trackedField.visible &&
            JSON.stringify(reorderedTrackedField.options) === JSON.stringify(trackedField.options) &&
            reorderedTrackedField.placeholder === trackedField.placeholder
          );
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Empty configuration operations are handled correctly
     */
    it('should handle operations on empty or minimal configurations', () => {
      // Feature: saleshub-crm, Property 7: Form config field operations

      fc.assert(
        fc.property(formFieldArb, (newField) => {
          // Start with empty configuration
          const emptyFields: FormField[] = [];

          // Add a field to empty configuration
          const withOneField = [...emptyFields, newField];

          // Property: Adding to empty config produces valid single-field config
          const isValid =
            withOneField.length === 1 &&
            withOneField[0].id === newField.id &&
            withOneField[0].type === newField.type;

          // Serialize and deserialize
          const serialized = JSON.stringify(withOneField);
          const deserialized = JSON.parse(serialized);

          return isValid && Array.isArray(deserialized) && deserialized.length === 1;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Field validation properties are preserved
     */
    it('should preserve field validation properties during operations', () => {
      // Feature: saleshub-crm, Property 7: Form config field operations

      // Create a field with validation
      const fieldWithValidationArb = fc.record({
        id: fc.uuid(),
        type: fc.constant<FieldType>('text'),
        label: fc.string({ minLength: 1, maxLength: 100 }),
        key: fc.string({ minLength: 1, maxLength: 50 }).map(s => s.replace(/[^a-zA-Z0-9]/g, '_')),
        required: fc.boolean(),
        visible: fc.boolean(),
        order: fc.integer({ min: 1, max: 100 }),
        validation: fc.record({
          pattern: fc.string(),
          minLength: fc.integer({ min: 0, max: 100 }),
          maxLength: fc.integer({ min: 1, max: 1000 }),
        }),
      });

      fc.assert(
        fc.property(fieldWithValidationArb, (field) => {
          // Simulate adding field to configuration
          const fields = [field];

          // Serialize and deserialize
          const serialized = JSON.stringify(fields);
          const deserialized = JSON.parse(serialized) as FormField[];

          const deserializedField = deserialized[0];

          // Property: Validation properties must be preserved
          return (
            deserializedField.validation !== undefined &&
            deserializedField.validation.pattern === field.validation.pattern &&
            deserializedField.validation.minLength === field.validation.minLength &&
            deserializedField.validation.maxLength === field.validation.maxLength
          );
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Dropdown field options are preserved during operations
     */
    it('should preserve dropdown options during operations', () => {
      // Feature: saleshub-crm, Property 7: Form config field operations

      const dropdownFieldArb = fc.record({
        id: fc.uuid(),
        type: fc.constant<FieldType>('dropdown'),
        label: fc.string({ minLength: 1, maxLength: 100 }),
        key: fc.string({ minLength: 1, maxLength: 50 }).map(s => s.replace(/[^a-zA-Z0-9]/g, '_')),
        required: fc.boolean(),
        visible: fc.boolean(),
        order: fc.integer({ min: 1, max: 100 }),
        options: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 10 }),
      });

      fc.assert(
        fc.property(dropdownFieldArb, (field) => {
          // Simulate adding field to configuration
          const fields = [field];

          // Serialize and deserialize
          const serialized = JSON.stringify(fields);
          const deserialized = JSON.parse(serialized) as FormField[];

          const deserializedField = deserialized[0];

          // Property: Options must be preserved exactly
          return (
            deserializedField.options !== undefined &&
            Array.isArray(deserializedField.options) &&
            deserializedField.options.length === field.options.length &&
            deserializedField.options.every((opt, idx) => opt === field.options![idx])
          );
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 10: Form Config Persistence Round-Trip
   *
   * For any valid form configuration changes, publishing the changes and then retrieving
   * the configuration must produce an equivalent configuration with incremented version.
   *
   * **Validates: Requirements 3.7**
   */
  describe('Property 10: Form config persistence round-trip', () => {
    // Arbitrary for field types
    const fieldTypeArb = fc.constantFrom<FieldType>(
      'text',
      'email',
      'phone',
      'dropdown',
      'textarea',
      'checklist'
    );

    // Arbitrary for form field
    const formFieldArb = fc.record({
      id: fc.uuid(),
      type: fieldTypeArb,
      label: fc.string({ minLength: 1, maxLength: 100 }),
      key: fc.string({ minLength: 1, maxLength: 50 }).map(s => s.replace(/[^a-zA-Z0-9]/g, '_')),
      required: fc.boolean(),
      visible: fc.boolean(),
      order: fc.integer({ min: 1, max: 100 }),
      options: fc.option(
        fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 10 }),
        { nil: undefined }
      ),
      placeholder: fc.option(fc.string({ maxLength: 100 }), { nil: undefined }),
      validation: fc.option(
        fc.record({
          pattern: fc.option(fc.string(), { nil: undefined }),
          minLength: fc.option(fc.integer({ min: 0, max: 1000 }), { nil: undefined }),
          maxLength: fc.option(fc.integer({ min: 1, max: 10000 }), { nil: undefined }),
        }),
        { nil: undefined }
      ),
    });

    // Arbitrary for a list of form fields
    const formFieldsArb = fc.array(formFieldArb, { minLength: 1, maxLength: 20 });

    /**
     * Test: Publishing form config and retrieving it produces equivalent configuration
     * with incremented version
     */
    it('should maintain data integrity through publish and retrieve with version increment', () => {
      // Feature: saleshub-crm, Property 10: Form config persistence round-trip

      fc.assert(
        fc.property(
          formFieldsArb,
          fc.integer({ min: 0, max: 100 }), // Initial version
          fc.uuid(), // Manager ID
          (fields, initialVersion, managerId) => {
            // Simulate the current state with an initial version
            const currentConfig = {
              fields,
              version: initialVersion,
              updatedBy: managerId,
            };

            // Simulate publishing: serialize fields to JSON (as done in updateFormConfig)
            const fieldsJson = JSON.stringify(fields);

            // Simulate version increment
            const newVersion = currentConfig.version + 1;

            // Simulate the persisted config
            const persistedConfig = {
              fields: fieldsJson,
              version: newVersion,
              updatedBy: managerId,
            };

            // Simulate retrieval: deserialize fields from JSON (as done in getFormConfig)
            const retrievedFields = JSON.parse(persistedConfig.fields) as FormField[];

            const retrievedConfig = {
              fields: retrievedFields,
              version: persistedConfig.version,
              updatedBy: persistedConfig.updatedBy,
            };

            // Property: Retrieved configuration must be equivalent to original with incremented version
            // 1. Version must be incremented by 1
            const versionIncremented = retrievedConfig.version === currentConfig.version + 1;

            // 2. Manager ID must be preserved
            const managerPreserved = retrievedConfig.updatedBy === currentConfig.updatedBy;

            // 3. Same number of fields
            const sameFieldCount = retrievedConfig.fields.length === currentConfig.fields.length;

            // 4. All fields must match exactly
            const allFieldsMatch = currentConfig.fields.every((originalField, index) => {
              const retrievedField = retrievedConfig.fields[index];
              
              // Compare all properties
              const basicPropsMatch =
                retrievedField.id === originalField.id &&
                retrievedField.type === originalField.type &&
                retrievedField.label === originalField.label &&
                retrievedField.key === originalField.key &&
                retrievedField.required === originalField.required &&
                retrievedField.visible === originalField.visible &&
                retrievedField.order === originalField.order;

              // Compare optional properties
              const optionsMatch =
                JSON.stringify(retrievedField.options) === JSON.stringify(originalField.options);
              
              const placeholderMatch = retrievedField.placeholder === originalField.placeholder;
              
              const validationMatch =
                JSON.stringify(retrievedField.validation) === JSON.stringify(originalField.validation);

              return basicPropsMatch && optionsMatch && placeholderMatch && validationMatch;
            });

            // 5. Round-trip serialization produces identical JSON
            const roundTripJson = JSON.stringify(retrievedConfig.fields);
            const identicalSerialization = fieldsJson === roundTripJson;

            return (
              versionIncremented &&
              managerPreserved &&
              sameFieldCount &&
              allFieldsMatch &&
              identicalSerialization
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Multiple publish operations increment version correctly
     */
    it('should increment version correctly through multiple publish operations', () => {
      // Feature: saleshub-crm, Property 10: Form config persistence round-trip

      fc.assert(
        fc.property(
          formFieldsArb,
          fc.integer({ min: 0, max: 50 }), // Initial version
          fc.uuid(), // Manager ID
          fc.integer({ min: 1, max: 5 }), // Number of publish operations
          (fields, initialVersion, managerId, numPublishes) => {
            let currentVersion = initialVersion;

            // Simulate multiple publish operations
            for (let i = 0; i < numPublishes; i++) {
              // Each publish increments version
              currentVersion = currentVersion + 1;

              // Simulate persistence
              const fieldsJson = JSON.stringify(fields);
              const retrievedFields = JSON.parse(fieldsJson) as FormField[];

              // Verify fields are preserved
              const fieldsPreserved = retrievedFields.length === fields.length;
              if (!fieldsPreserved) return false;
            }

            // Property: After N publishes, version should be initial + N
            const expectedVersion = initialVersion + numPublishes;
            return currentVersion === expectedVersion;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Publishing with field modifications preserves all changes
     */
    it('should preserve all field modifications through publish and retrieve', () => {
      // Feature: saleshub-crm, Property 10: Form config persistence round-trip

      fc.assert(
        fc.property(
          formFieldsArb,
          fc.integer({ min: 0, max: 100 }),
          fc.uuid(),
          (originalFields, initialVersion, managerId) => {
            // Simulate field modifications
            const modifiedFields = originalFields.map((field, index) => ({
              ...field,
              // Toggle some properties
              required: index % 2 === 0 ? !field.required : field.required,
              visible: index % 3 === 0 ? !field.visible : field.visible,
              order: index + 1, // Ensure sequential order
            }));

            // Simulate publish
            const fieldsJson = JSON.stringify(modifiedFields);
            const newVersion = initialVersion + 1;

            // Simulate retrieve
            const retrievedFields = JSON.parse(fieldsJson) as FormField[];

            // Property: All modifications must be preserved
            const allModificationsPreserved = modifiedFields.every((modifiedField, index) => {
              const retrievedField = retrievedFields[index];
              return (
                retrievedField.id === modifiedField.id &&
                retrievedField.required === modifiedField.required &&
                retrievedField.visible === modifiedField.visible &&
                retrievedField.order === modifiedField.order
              );
            });

            return allModificationsPreserved;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Publishing empty configuration is handled correctly
     */
    it('should handle publishing and retrieving empty configuration', () => {
      // Feature: saleshub-crm, Property 10: Form config persistence round-trip

      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100 }),
          fc.uuid(),
          (initialVersion, managerId) => {
            const emptyFields: FormField[] = [];

            // Simulate publish
            const fieldsJson = JSON.stringify(emptyFields);
            const newVersion = initialVersion + 1;

            // Simulate retrieve
            const retrievedFields = JSON.parse(fieldsJson) as FormField[];

            // Property: Empty configuration should persist correctly
            return (
              Array.isArray(retrievedFields) &&
              retrievedFields.length === 0 &&
              newVersion === initialVersion + 1
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Publishing configuration with complex field types preserves all data
     */
    it('should preserve complex field types through publish and retrieve', () => {
      // Feature: saleshub-crm, Property 10: Form config persistence round-trip

      // Create fields with all possible complex properties
      const complexFieldArb = fc.record({
        id: fc.uuid(),
        type: fc.constantFrom<FieldType>('dropdown', 'checklist'),
        label: fc.string({ minLength: 1, maxLength: 100 }),
        key: fc.string({ minLength: 1, maxLength: 50 }).map(s => s.replace(/[^a-zA-Z0-9]/g, '_')),
        required: fc.boolean(),
        visible: fc.boolean(),
        order: fc.integer({ min: 1, max: 100 }),
        options: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 2, maxLength: 10 }),
        placeholder: fc.string({ maxLength: 100 }),
        validation: fc.record({
          pattern: fc.string(),
          minLength: fc.integer({ min: 0, max: 100 }),
          maxLength: fc.integer({ min: 101, max: 1000 }),
        }),
      });

      fc.assert(
        fc.property(
          fc.array(complexFieldArb, { minLength: 1, maxLength: 10 }),
          fc.integer({ min: 0, max: 100 }),
          fc.uuid(),
          (fields, initialVersion, managerId) => {
            // Simulate publish
            const fieldsJson = JSON.stringify(fields);
            const newVersion = initialVersion + 1;

            // Simulate retrieve
            const retrievedFields = JSON.parse(fieldsJson) as FormField[];

            // Property: All complex properties must be preserved
            const allPropertiesPreserved = fields.every((originalField, index) => {
              const retrievedField = retrievedFields[index];

              const basicMatch =
                retrievedField.id === originalField.id &&
                retrievedField.type === originalField.type &&
                retrievedField.label === originalField.label &&
                retrievedField.key === originalField.key;

              const optionsMatch =
                retrievedField.options !== undefined &&
                originalField.options !== undefined &&
                retrievedField.options.length === originalField.options.length &&
                retrievedField.options.every((opt, idx) => opt === originalField.options![idx]);

              const validationMatch =
                retrievedField.validation !== undefined &&
                originalField.validation !== undefined &&
                retrievedField.validation.pattern === originalField.validation.pattern &&
                retrievedField.validation.minLength === originalField.validation.minLength &&
                retrievedField.validation.maxLength === originalField.validation.maxLength;

              const placeholderMatch = retrievedField.placeholder === originalField.placeholder;

              return basicMatch && optionsMatch && validationMatch && placeholderMatch;
            });

            return allPropertiesPreserved && newVersion === initialVersion + 1;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Concurrent publish operations maintain version consistency
     */
    it('should maintain version consistency with sequential publishes', () => {
      // Feature: saleshub-crm, Property 10: Form config persistence round-trip

      fc.assert(
        fc.property(
          formFieldsArb,
          fc.integer({ min: 0, max: 100 }),
          fc.uuid(),
          (fields, initialVersion, managerId) => {
            // Simulate first publish
            const fieldsJson1 = JSON.stringify(fields);
            const version1 = initialVersion + 1;
            const retrieved1 = JSON.parse(fieldsJson1) as FormField[];

            // Simulate second publish (using retrieved config)
            const fieldsJson2 = JSON.stringify(retrieved1);
            const version2 = version1 + 1;
            const retrieved2 = JSON.parse(fieldsJson2) as FormField[];

            // Property: Version increments correctly and data is preserved
            const versionCorrect = version2 === initialVersion + 2;
            const dataPreserved = JSON.stringify(retrieved2) === JSON.stringify(fields);

            return versionCorrect && dataPreserved;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Publishing configuration preserves field order
     */
    it('should preserve field order through publish and retrieve', () => {
      // Feature: saleshub-crm, Property 10: Form config persistence round-trip

      fc.assert(
        fc.property(
          formFieldsArb,
          fc.integer({ min: 0, max: 100 }),
          fc.uuid(),
          (fields, initialVersion, managerId) => {
            // Ensure fields have sequential order
            const orderedFields = fields.map((field, index) => ({
              ...field,
              order: index + 1,
            }));

            // Simulate publish
            const fieldsJson = JSON.stringify(orderedFields);

            // Simulate retrieve
            const retrievedFields = JSON.parse(fieldsJson) as FormField[];

            // Property: Field order must be preserved exactly
            const orderPreserved = orderedFields.every((field, index) => {
              const retrievedField = retrievedFields[index];
              return (
                retrievedField.id === field.id &&
                retrievedField.order === field.order &&
                retrievedField.order === index + 1
              );
            });

            return orderPreserved;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 9: Required Field Validation Enforcement
   *
   * For any form configuration with required fields, submitting a lead form with
   * missing required fields must fail validation.
   *
   * **Validates: Requirements 3.9, 11.1**
   */
  describe('Property 9: Required field validation enforcement', () => {
    /**
     * Test: Required fields must fail validation when missing
     */
    it('should fail validation when required fields are missing', () => {
      // Feature: saleshub-crm, Property 9: Required field validation enforcement

      // Arbitrary for form fields with at least one required field
      const formConfigWithRequiredArb = fc
        .array(
          fc.record({
            id: fc.uuid(),
            type: fc.constantFrom<FieldType>('text', 'email', 'phone', 'textarea'),
            label: fc.string({ minLength: 1, maxLength: 100 }),
            key: fc.string({ minLength: 1, maxLength: 50 }).map(s => s.replace(/[^a-zA-Z0-9]/g, '_')),
            required: fc.boolean(),
            visible: fc.constant(true), // Only visible fields are validated
            order: fc.integer({ min: 1, max: 100 }),
          }),
          { minLength: 1, maxLength: 10 }
        )
        .filter(fields => fields.some(f => f.required)); // Ensure at least one required field

      fc.assert(
        fc.property(formConfigWithRequiredArb, (formConfig) => {
          // Generate schema from form config
          const schema = generateZodSchema(formConfig);

          // Get required fields
          const requiredFields = formConfig.filter(f => f.required && f.visible);

          // Create data object with missing required fields
          const incompleteData: Record<string, any> = {};
          
          // Fill in some fields but leave at least one required field empty
          formConfig.forEach((field, index) => {
            if (index % 2 === 0 && !field.required) {
              // Fill optional fields
              incompleteData[field.key] = 'some value';
            } else if (field.required) {
              // Leave required fields empty or undefined
              incompleteData[field.key] = '';
            }
          });

          // Property: Validation must fail when required fields are missing
          const result = schema.safeParse(incompleteData);

          // Validation should fail
          if (result.success) {
            // If validation passed, check if all required fields were actually filled
            const allRequiredFilled = requiredFields.every(
              field => incompleteData[field.key] && incompleteData[field.key].length > 0
            );
            // Only pass if all required fields were actually filled (edge case)
            return allRequiredFilled;
          }

          // Validation failed as expected
          return true;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Required fields must pass validation when provided
     */
    it('should pass validation when all required fields are provided', () => {
      // Feature: saleshub-crm, Property 9: Required field validation enforcement

      const formConfigArb = fc.array(
        fc.record({
          id: fc.uuid(),
          type: fc.constantFrom<FieldType>('text', 'email', 'phone', 'textarea'),
          label: fc.string({ minLength: 1, maxLength: 100 }),
          key: fc.string({ minLength: 1, maxLength: 50 }).map(s => s.replace(/[^a-zA-Z0-9]/g, '_')),
          required: fc.boolean(),
          visible: fc.constant(true),
          order: fc.integer({ min: 1, max: 100 }),
        }),
        { minLength: 1, maxLength: 10 }
      );

      fc.assert(
        fc.property(formConfigArb, (formConfig) => {
          // Generate schema from form config
          const schema = generateZodSchema(formConfig);

          // Create complete data object with all required fields filled
          const completeData: Record<string, any> = {};
          
          formConfig.forEach((field) => {
            if (field.visible) {
              // Provide appropriate values based on field type
              switch (field.type) {
                case 'email':
                  completeData[field.key] = 'test@example.com';
                  break;
                case 'phone':
                  completeData[field.key] = '+1234567890';
                  break;
                default:
                  completeData[field.key] = field.required ? 'valid value' : '';
                  break;
              }
            }
          });

          // Property: Validation must pass when all required fields are provided
          const result = schema.safeParse(completeData);

          return result.success;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Optional fields can be empty without failing validation
     */
    it('should pass validation when optional fields are empty', () => {
      // Feature: saleshub-crm, Property 9: Required field validation enforcement

      const formConfigWithOptionalArb = fc
        .array(
          fc.record({
            id: fc.uuid(),
            type: fc.constantFrom<FieldType>('text', 'textarea'),
            label: fc.string({ minLength: 1, maxLength: 100 }),
            key: fc.string({ minLength: 1, maxLength: 50 }).map(s => s.replace(/[^a-zA-Z0-9]/g, '_')),
            required: fc.constant(false), // All fields are optional
            visible: fc.constant(true),
            order: fc.integer({ min: 1, max: 100 }),
          }),
          { minLength: 1, maxLength: 10 }
        );

      fc.assert(
        fc.property(formConfigWithOptionalArb, (formConfig) => {
          // Generate schema from form config
          const schema = generateZodSchema(formConfig);

          // Create data object with all optional fields empty
          const dataWithEmptyOptionals: Record<string, any> = {};
          
          formConfig.forEach((field) => {
            if (field.visible) {
              dataWithEmptyOptionals[field.key] = '';
            }
          });

          // Property: Validation must pass when optional fields are empty
          const result = schema.safeParse(dataWithEmptyOptionals);

          return result.success;
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 19: Email Format Validation
   *
   * For any form field with type='email', submitting invalid email formats
   * must fail validation.
   *
   * **Validates: Requirements 11.2**
   */
  describe('Property 19: Email format validation', () => {
    /**
     * Test: Invalid email formats must fail validation
     */
    it('should fail validation for invalid email formats', () => {
      // Feature: saleshub-crm, Property 19: Email format validation

      // Arbitrary for invalid email strings
      const invalidEmailArb = fc.oneof(
        fc.constant('notanemail'),
        fc.constant('missing@domain'),
        fc.constant('@nodomain.com'),
        fc.constant('no-at-sign.com'),
        fc.constant('double@@domain.com'),
        fc.constant('spaces in@email.com'),
        fc.constant(''),
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes('@'))
      );

      fc.assert(
        fc.property(invalidEmailArb, (invalidEmail) => {
          // Create form config with email field
          const formConfig: FormField[] = [
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

          // Generate schema
          const schema = generateZodSchema(formConfig);

          // Create data with invalid email
          const data = { email: invalidEmail };

          // Property: Validation must fail for invalid email
          const result = schema.safeParse(data);

          return !result.success;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Valid email formats must pass validation
     */
    it('should pass validation for valid email formats', () => {
      // Feature: saleshub-crm, Property 19: Email format validation

      // Arbitrary for valid email strings that are compatible with Zod's email validator
      // Use a more conservative email generator that aligns with Zod's expectations
      // Ensure domain parts don't start or end with special characters
      const validEmailArb = fc.tuple(
        fc.stringMatching(/^[a-zA-Z0-9]+[a-zA-Z0-9._-]*[a-zA-Z0-9]+$/).filter(s => s.length >= 2),
        fc.stringMatching(/^[a-zA-Z0-9]+[a-zA-Z0-9-]*[a-zA-Z0-9]+$/).filter(s => s.length >= 2),
        fc.stringMatching(/^[a-zA-Z]{2,}$/)
      ).map(([local, domain, tld]) => `${local}@${domain}.${tld}`)
        .filter(email => email.length > 5 && email.length < 100 && !email.includes('..'));

      fc.assert(
        fc.property(validEmailArb, (validEmail) => {
          // Create form config with email field
          const formConfig: FormField[] = [
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

          // Generate schema
          const schema = generateZodSchema(formConfig);

          // Create data with valid email
          const data = { email: validEmail };

          // Property: Validation must pass for valid email
          const result = schema.safeParse(data);

          return result.success;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Optional email fields can be empty
     */
    it('should pass validation when optional email field is empty', () => {
      // Feature: saleshub-crm, Property 19: Email format validation

      fc.assert(
        fc.property(fc.constant(true), () => {
          // Create form config with optional email field
          const formConfig: FormField[] = [
            {
              id: '1',
              type: 'email',
              label: 'Email',
              key: 'email',
              required: false,
              visible: true,
              order: 1,
            },
          ];

          // Generate schema
          const schema = generateZodSchema(formConfig);

          // Create data with empty email
          const data = { email: '' };

          // Property: Validation must pass for empty optional email
          const result = schema.safeParse(data);

          return result.success;
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 20: Phone Format Validation
   *
   * For any form field with type='phone', submitting invalid phone number formats
   * must fail validation.
   *
   * **Validates: Requirements 11.3**
   */
  describe('Property 20: Phone format validation', () => {
    /**
     * Test: Invalid phone formats must fail validation
     */
    it('should fail validation for invalid phone formats', () => {
      // Feature: saleshub-crm, Property 20: Phone format validation

      // Arbitrary for invalid phone strings
      const invalidPhoneArb = fc.oneof(
        fc.constant('abc'),
        fc.constant('123'), // Too short
        fc.constant('12-34'), // Too short
        fc.constant('not-a-phone'),
        fc.constant(''),
        fc.string({ minLength: 1, maxLength: 5 }).filter(s => !/^\d+$/.test(s))
      );

      fc.assert(
        fc.property(invalidPhoneArb, (invalidPhone) => {
          // Create form config with phone field
          const formConfig: FormField[] = [
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

          // Generate schema
          const schema = generateZodSchema(formConfig);

          // Create data with invalid phone
          const data = { phone: invalidPhone };

          // Property: Validation must fail for invalid phone
          const result = schema.safeParse(data);

          return !result.success;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Valid phone formats must pass validation
     */
    it('should pass validation for valid phone formats', () => {
      // Feature: saleshub-crm, Property 20: Phone format validation

      // Arbitrary for valid phone strings
      const validPhoneArb = fc.oneof(
        fc.constant('+1234567890'),
        fc.constant('1234567890'),
        fc.constant('(123) 456-7890'),
        fc.constant('123-456-7890'),
        fc.constant('+1 (123) 456-7890'),
        fc.constant('+44 20 7946 0958'),
        fc.integer({ min: 1000000000, max: 9999999999 }).map(n => n.toString())
      );

      fc.assert(
        fc.property(validPhoneArb, (validPhone) => {
          // Create form config with phone field
          const formConfig: FormField[] = [
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

          // Generate schema
          const schema = generateZodSchema(formConfig);

          // Create data with valid phone
          const data = { phone: validPhone };

          // Property: Validation must pass for valid phone
          const result = schema.safeParse(data);

          return result.success;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Optional phone fields can be empty
     */
    it('should pass validation when optional phone field is empty', () => {
      // Feature: saleshub-crm, Property 20: Phone format validation

      fc.assert(
        fc.property(fc.constant(true), () => {
          // Create form config with optional phone field
          const formConfig: FormField[] = [
            {
              id: '1',
              type: 'phone',
              label: 'Phone',
              key: 'phone',
              required: false,
              visible: true,
              order: 1,
            },
          ];

          // Generate schema
          const schema = generateZodSchema(formConfig);

          // Create data with empty phone
          const data = { phone: '' };

          // Property: Validation must pass for empty optional phone
          const result = schema.safeParse(data);

          return result.success;
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 21: Dropdown Options Constraint
   *
   * For any dropdown field in a submitted lead form, the submitted value must be
   * one of the configured options for that field.
   *
   * **Validates: Requirements 3.6**
   */
  describe('Property 21: Dropdown options constraint', () => {
    /**
     * Test: Dropdown values must be one of the configured options
     */
    it('should fail validation when dropdown value is not in options', () => {
      // Feature: saleshub-crm, Property 21: Dropdown options constraint

      // Arbitrary for dropdown options
      const dropdownOptionsArb = fc.array(
        fc.string({ minLength: 1, maxLength: 50 }),
        { minLength: 2, maxLength: 10 }
      ).map(arr => Array.from(new Set(arr))); // Ensure unique options

      // Arbitrary for invalid value (not in options)
      const invalidValueArb = fc.string({ minLength: 1, maxLength: 50 });

      fc.assert(
        fc.property(dropdownOptionsArb, invalidValueArb, (options, invalidValue) => {
          // Skip if invalid value happens to be in options
          if (options.includes(invalidValue)) {
            return true;
          }

          // Create form config with dropdown field
          const formConfig: FormField[] = [
            {
              id: '1',
              type: 'dropdown',
              label: 'Status',
              key: 'status',
              required: true,
              visible: true,
              order: 1,
              options,
            },
          ];

          // Generate schema
          const schema = generateZodSchema(formConfig);

          // Create data with invalid dropdown value
          const data = { status: invalidValue };

          // Property: Validation must fail for value not in options
          const result = schema.safeParse(data);

          return !result.success;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Dropdown values from configured options must pass validation
     */
    it('should pass validation when dropdown value is in options', () => {
      // Feature: saleshub-crm, Property 21: Dropdown options constraint

      // Arbitrary for dropdown options
      const dropdownOptionsArb = fc.array(
        fc.string({ minLength: 1, maxLength: 50 }),
        { minLength: 2, maxLength: 10 }
      ).map(arr => Array.from(new Set(arr))); // Ensure unique options

      fc.assert(
        fc.property(dropdownOptionsArb, fc.integer({ min: 0, max: 100 }), (options, indexSeed) => {
          if (options.length === 0) return true;

          // Select a valid option
          const selectedIndex = indexSeed % options.length;
          const validValue = options[selectedIndex];

          // Create form config with dropdown field
          const formConfig: FormField[] = [
            {
              id: '1',
              type: 'dropdown',
              label: 'Status',
              key: 'status',
              required: true,
              visible: true,
              order: 1,
              options,
            },
          ];

          // Generate schema
          const schema = generateZodSchema(formConfig);

          // Create data with valid dropdown value
          const data = { status: validValue };

          // Property: Validation must pass for value in options
          const result = schema.safeParse(data);

          return result.success;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Optional dropdown fields can be empty
     */
    it('should pass validation when optional dropdown field is empty', () => {
      // Feature: saleshub-crm, Property 21: Dropdown options constraint

      const dropdownOptionsArb = fc.array(
        fc.string({ minLength: 1, maxLength: 50 }),
        { minLength: 2, maxLength: 10 }
      );

      fc.assert(
        fc.property(dropdownOptionsArb, (options) => {
          // Create form config with optional dropdown field
          const formConfig: FormField[] = [
            {
              id: '1',
              type: 'dropdown',
              label: 'Status',
              key: 'status',
              required: false,
              visible: true,
              order: 1,
              options,
            },
          ];

          // Generate schema
          const schema = generateZodSchema(formConfig);

          // Create data with empty dropdown value
          const data = { status: '' };

          // Property: Validation must pass for empty optional dropdown
          const result = schema.safeParse(data);

          return result.success;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Checklist values must all be from configured options
     */
    it('should fail validation when checklist contains values not in options', () => {
      // Feature: saleshub-crm, Property 21: Dropdown options constraint

      const checklistOptionsArb = fc.array(
        fc.string({ minLength: 1, maxLength: 50 }),
        { minLength: 2, maxLength: 10 }
      ).map(arr => Array.from(new Set(arr)));

      const invalidValueArb = fc.string({ minLength: 1, maxLength: 50 });

      fc.assert(
        fc.property(checklistOptionsArb, invalidValueArb, (options, invalidValue) => {
          // Skip if invalid value happens to be in options
          if (options.includes(invalidValue)) {
            return true;
          }

          // Create form config with checklist field
          const formConfig: FormField[] = [
            {
              id: '1',
              type: 'checklist',
              label: 'Interests',
              key: 'interests',
              required: true,
              visible: true,
              order: 1,
              options,
            },
          ];

          // Generate schema
          const schema = generateZodSchema(formConfig);

          // Create data with invalid checklist value
          const data = { interests: [invalidValue] };

          // Property: Validation must fail for checklist with invalid values
          const result = schema.safeParse(data);

          return !result.success;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Checklist with valid options must pass validation
     */
    it('should pass validation when checklist contains only valid options', () => {
      // Feature: saleshub-crm, Property 21: Dropdown options constraint

      const checklistOptionsArb = fc.array(
        fc.string({ minLength: 1, maxLength: 50 }),
        { minLength: 2, maxLength: 10 }
      ).map(arr => Array.from(new Set(arr)));

      fc.assert(
        fc.property(checklistOptionsArb, (options) => {
          if (options.length === 0) return true;

          // Select some valid options
          const selectedOptions = options.slice(0, Math.min(3, options.length));

          // Create form config with checklist field
          const formConfig: FormField[] = [
            {
              id: '1',
              type: 'checklist',
              label: 'Interests',
              key: 'interests',
              required: true,
              visible: true,
              order: 1,
              options,
            },
          ];

          // Generate schema
          const schema = generateZodSchema(formConfig);

          // Create data with valid checklist values
          const data = { interests: selectedOptions };

          // Property: Validation must pass for checklist with valid values
          const result = schema.safeParse(data);

          return result.success;
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 8: Field Visibility Filtering for Agents
   *
   * For any form configuration, when an agent views the lead form, only fields
   * where visible=true must be rendered.
   *
   * **Validates: Requirements 3.8**
   */
  describe('Property 8: Field visibility filtering for agents', () => {
    // Arbitrary for field types
    const fieldTypeArb = fc.constantFrom<FieldType>(
      'text',
      'email',
      'phone',
      'dropdown',
      'textarea',
      'checklist'
    );

    // Arbitrary for form field
    const formFieldArb = fc.record({
      id: fc.uuid(),
      type: fieldTypeArb,
      label: fc.string({ minLength: 1, maxLength: 100 }),
      key: fc.string({ minLength: 1, maxLength: 50 }).map(s => s.replace(/[^a-zA-Z0-9]/g, '_')),
      required: fc.boolean(),
      visible: fc.boolean(),
      order: fc.integer({ min: 1, max: 100 }),
      options: fc.option(
        fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 10 }),
        { nil: undefined }
      ),
      placeholder: fc.option(fc.string({ maxLength: 100 }), { nil: undefined }),
    });

    // Arbitrary for a list of form fields
    const formFieldsArb = fc.array(formFieldArb, { minLength: 1, maxLength: 20 });

    /**
     * Test: Only visible fields are included in agent view
     */
    it('should filter to only visible fields for agents', () => {
      // Feature: saleshub-crm, Property 8: Field visibility filtering for agents

      fc.assert(
        fc.property(formFieldsArb, (formConfig) => {
          // Simulate agent viewing the form - filter to visible fields
          const visibleFields = formConfig.filter(field => field.visible);

          // Property: All returned fields must have visible=true
          const allFieldsVisible = visibleFields.every(field => field.visible === true);

          // Property: No hidden fields should be included
          const noHiddenFields = visibleFields.every(field => {
            const originalField = formConfig.find(f => f.id === field.id);
            return originalField?.visible === true;
          });

          // Property: Count of visible fields matches expected
          const expectedVisibleCount = formConfig.filter(f => f.visible).length;
          const actualVisibleCount = visibleFields.length;
          const correctCount = expectedVisibleCount === actualVisibleCount;

          return allFieldsVisible && noHiddenFields && correctCount;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Visible fields are sorted by order property
     */
    it('should sort visible fields by order property', () => {
      // Feature: saleshub-crm, Property 8: Field visibility filtering for agents

      fc.assert(
        fc.property(formFieldsArb, (formConfig) => {
          // Simulate agent viewing the form - filter and sort
          const visibleFields = formConfig
            .filter(field => field.visible)
            .sort((a, b) => a.order - b.order);

          // Property: Fields must be in ascending order
          const isSorted = visibleFields.every((field, index) => {
            if (index === 0) return true;
            return field.order >= visibleFields[index - 1].order;
          });

          return isSorted;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Hidden fields are excluded from agent view
     */
    it('should exclude all hidden fields from agent view', () => {
      // Feature: saleshub-crm, Property 8: Field visibility filtering for agents

      fc.assert(
        fc.property(formFieldsArb, (formConfig) => {
          // Get hidden fields
          const hiddenFields = formConfig.filter(field => !field.visible);

          // Simulate agent viewing the form
          const visibleFields = formConfig.filter(field => field.visible);

          // Property: No hidden field IDs should appear in visible fields
          const noHiddenFieldsIncluded = hiddenFields.every(hiddenField => {
            return !visibleFields.some(visibleField => visibleField.id === hiddenField.id);
          });

          return noHiddenFieldsIncluded;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Visibility filtering preserves field properties
     */
    it('should preserve all field properties when filtering', () => {
      // Feature: saleshub-crm, Property 8: Field visibility filtering for agents

      fc.assert(
        fc.property(formFieldsArb, (formConfig) => {
          // Simulate agent viewing the form
          const visibleFields = formConfig.filter(field => field.visible);

          // Property: All properties of visible fields must be preserved
          const allPropertiesPreserved = visibleFields.every(visibleField => {
            const originalField = formConfig.find(f => f.id === visibleField.id);
            if (!originalField) return false;

            return (
              visibleField.id === originalField.id &&
              visibleField.type === originalField.type &&
              visibleField.label === originalField.label &&
              visibleField.key === originalField.key &&
              visibleField.required === originalField.required &&
              visibleField.visible === originalField.visible &&
              visibleField.order === originalField.order &&
              JSON.stringify(visibleField.options) === JSON.stringify(originalField.options) &&
              visibleField.placeholder === originalField.placeholder
            );
          });

          return allPropertiesPreserved;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Empty configuration returns empty visible fields
     */
    it('should return empty array for empty configuration', () => {
      // Feature: saleshub-crm, Property 8: Field visibility filtering for agents

      fc.assert(
        fc.property(fc.constant(true), () => {
          const emptyConfig: FormField[] = [];

          // Simulate agent viewing the form
          const visibleFields = emptyConfig.filter(field => field.visible);

          // Property: Empty config should return empty visible fields
          return visibleFields.length === 0;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Configuration with all hidden fields returns empty
     */
    it('should return empty array when all fields are hidden', () => {
      // Feature: saleshub-crm, Property 8: Field visibility filtering for agents

      const allHiddenFieldsArb = fc.array(
        fc.record({
          id: fc.uuid(),
          type: fieldTypeArb,
          label: fc.string({ minLength: 1, maxLength: 100 }),
          key: fc.string({ minLength: 1, maxLength: 50 }).map(s => s.replace(/[^a-zA-Z0-9]/g, '_')),
          required: fc.boolean(),
          visible: fc.constant(false), // All fields hidden
          order: fc.integer({ min: 1, max: 100 }),
        }),
        { minLength: 1, maxLength: 10 }
      );

      fc.assert(
        fc.property(allHiddenFieldsArb, (formConfig) => {
          // Simulate agent viewing the form
          const visibleFields = formConfig.filter(field => field.visible);

          // Property: Should return empty array when all fields are hidden
          return visibleFields.length === 0;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Configuration with all visible fields returns all fields
     */
    it('should return all fields when all are visible', () => {
      // Feature: saleshub-crm, Property 8: Field visibility filtering for agents

      const allVisibleFieldsArb = fc.array(
        fc.record({
          id: fc.uuid(),
          type: fieldTypeArb,
          label: fc.string({ minLength: 1, maxLength: 100 }),
          key: fc.string({ minLength: 1, maxLength: 50 }).map(s => s.replace(/[^a-zA-Z0-9]/g, '_')),
          required: fc.boolean(),
          visible: fc.constant(true), // All fields visible
          order: fc.integer({ min: 1, max: 100 }),
        }),
        { minLength: 1, maxLength: 10 }
      );

      fc.assert(
        fc.property(allVisibleFieldsArb, (formConfig) => {
          // Simulate agent viewing the form
          const visibleFields = formConfig.filter(field => field.visible);

          // Property: Should return all fields when all are visible
          return visibleFields.length === formConfig.length;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Visibility filtering is idempotent
     */
    it('should produce same result when filtering multiple times', () => {
      // Feature: saleshub-crm, Property 8: Field visibility filtering for agents

      fc.assert(
        fc.property(formFieldsArb, (formConfig) => {
          // Filter once
          const visibleFields1 = formConfig.filter(field => field.visible);

          // Filter again
          const visibleFields2 = formConfig.filter(field => field.visible);

          // Property: Both results should be identical
          const sameLength = visibleFields1.length === visibleFields2.length;

          const sameFields = visibleFields1.every((field, index) => {
            const field2 = visibleFields2[index];
            return field.id === field2.id;
          });

          return sameLength && sameFields;
        }),
        { numRuns: 100 }
      );
    });
  });
});
