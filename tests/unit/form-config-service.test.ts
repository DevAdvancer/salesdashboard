import { getFormConfig, updateFormConfig, addField, removeField, reorderFields, updateField, toggleFieldVisibility, toggleFieldRequired, DEFAULT_FIELDS } from '@/lib/services/form-config-service';
import { databases } from '@/lib/appwrite';
import { FormField } from '@/lib/types';

// Mock the Appwrite modules
jest.mock('@/lib/appwrite', () => ({
  databases: {
    getDocument: jest.fn(),
    updateDocument: jest.fn(),
    createDocument: jest.fn(),
  },
}));

describe('Form Configuration Service', () => {
  const mockManagerId = 'manager-123';
  const mockFormConfig = {
    $id: 'current',
    fields: JSON.stringify([
      { id: '1', type: 'text', label: 'Name', key: 'name', required: true, visible: true, order: 1 },
      { id: '2', type: 'email', label: 'Email', key: 'email', required: true, visible: true, order: 2 },
    ]),
    version: 1,
    updatedBy: mockManagerId,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getFormConfig', () => {
    it('should fetch and parse form configuration', async () => {
      (databases.getDocument as jest.Mock).mockResolvedValue(mockFormConfig as any);

      const result = await getFormConfig();

      expect(result.fields).toHaveLength(2);
      expect(result.fields[0].label).toBe('Name');
      expect(result.version).toBe(1);
      expect(result.updatedBy).toBe(mockManagerId);
    });

    it('should return default fields when config does not exist', async () => {
      (databases.getDocument as jest.Mock).mockRejectedValue({ code: 404, message: 'Document not found' });

      const result = await getFormConfig();

      expect(result.fields).toEqual(DEFAULT_FIELDS);
      expect(result.version).toBe(0);
      expect(result.updatedBy).toBe('');
    });

    it('should throw error for other database errors', async () => {
      (databases.getDocument as jest.Mock).mockRejectedValue({ message: 'Database connection error' });

      await expect(getFormConfig()).rejects.toThrow('Database connection error');
    });
  });

  describe('updateFormConfig', () => {
    const newFields: FormField[] = [
      { id: '1', type: 'text', label: 'Full Name', key: 'fullName', required: true, visible: true, order: 1 },
    ];

    it('should update existing form configuration and increment version', async () => {
      (databases.getDocument as jest.Mock).mockResolvedValue(mockFormConfig as any);
      (databases.updateDocument as jest.Mock).mockResolvedValue({
        ...mockFormConfig,
        fields: JSON.stringify(newFields),
        version: 2,
      } as any);

      const result = await updateFormConfig(newFields, mockManagerId);

      expect(result.fields).toEqual(newFields);
      expect(result.version).toBe(2);
      expect(databases.updateDocument).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'current',
        {
          fields: JSON.stringify(newFields),
          version: 2,
          updatedBy: mockManagerId,
        }
      );
    });

    it('should create new configuration if document does not exist', async () => {
      (databases.getDocument as jest.Mock).mockRejectedValue({ code: 404 });
      (databases.updateDocument as jest.Mock).mockRejectedValue({ code: 404 });
      (databases.createDocument as jest.Mock).mockResolvedValue({
        ...mockFormConfig,
        fields: JSON.stringify(newFields),
        version: 1,
      } as any);

      const result = await updateFormConfig(newFields, mockManagerId);

      expect(result.fields).toEqual(newFields);
      expect(result.version).toBe(1);
      expect(databases.createDocument).toHaveBeenCalled();
    });
  });

  describe('addField', () => {
    it('should add a new field to the configuration', async () => {
      (databases.getDocument as jest.Mock).mockResolvedValue(mockFormConfig as any);
      (databases.updateDocument as jest.Mock).mockResolvedValue({
        ...mockFormConfig,
        version: 2,
      } as any);

      const newField: FormField = {
        id: '3',
        type: 'phone',
        label: 'Phone',
        key: 'phone',
        required: false,
        visible: true,
        order: 3,
      };

      const result = await addField(newField, mockManagerId);

      expect(result.fields).toHaveLength(3);
      expect(result.fields[2]).toEqual(newField);
      expect(result.version).toBe(2);
    });
  });

  describe('removeField', () => {
    it('should remove a field and reorder remaining fields', async () => {
      const configWithThreeFields = {
        ...mockFormConfig,
        fields: JSON.stringify([
          { id: '1', type: 'text', label: 'Name', key: 'name', required: true, visible: true, order: 1 },
          { id: '2', type: 'email', label: 'Email', key: 'email', required: true, visible: true, order: 2 },
          { id: '3', type: 'phone', label: 'Phone', key: 'phone', required: false, visible: true, order: 3 },
        ]),
      };

      (databases.getDocument as jest.Mock).mockResolvedValue(configWithThreeFields as any);
      (databases.updateDocument as jest.Mock).mockResolvedValue({
        ...configWithThreeFields,
        version: 2,
      } as any);

      const result = await removeField('2', mockManagerId);

      expect(result.fields).toHaveLength(2);
      expect(result.fields.find((f) => f.id === '2')).toBeUndefined();
      // Check that remaining fields are reordered
      expect(result.fields[0].order).toBe(1);
      expect(result.fields[1].order).toBe(2);
    });
  });

  describe('reorderFields', () => {
    it('should reorder fields based on provided IDs', async () => {
      const configWithThreeFields = {
        ...mockFormConfig,
        fields: JSON.stringify([
          { id: '1', type: 'text', label: 'Name', key: 'name', required: true, visible: true, order: 1 },
          { id: '2', type: 'email', label: 'Email', key: 'email', required: true, visible: true, order: 2 },
          { id: '3', type: 'phone', label: 'Phone', key: 'phone', required: false, visible: true, order: 3 },
        ]),
      };

      (databases.getDocument as jest.Mock).mockResolvedValue(configWithThreeFields as any);
      (databases.updateDocument as jest.Mock).mockResolvedValue({
        ...configWithThreeFields,
        version: 2,
      } as any);

      const result = await reorderFields(['3', '1', '2'], mockManagerId);

      expect(result.fields).toHaveLength(3);
      expect(result.fields[0].id).toBe('3');
      expect(result.fields[0].order).toBe(1);
      expect(result.fields[1].id).toBe('1');
      expect(result.fields[1].order).toBe(2);
      expect(result.fields[2].id).toBe('2');
      expect(result.fields[2].order).toBe(3);
    });
  });

  describe('updateField', () => {
    it('should update specific field properties', async () => {
      (databases.getDocument as jest.Mock).mockResolvedValue(mockFormConfig as any);
      (databases.updateDocument as jest.Mock).mockResolvedValue({
        ...mockFormConfig,
        version: 2,
      } as any);

      const result = await updateField('1', { label: 'Full Name', required: false }, mockManagerId);

      const updatedField = result.fields.find((f) => f.id === '1');
      expect(updatedField?.label).toBe('Full Name');
      expect(updatedField?.required).toBe(false);
    });
  });

  describe('toggleFieldVisibility', () => {
    it('should toggle field visibility from true to false', async () => {
      (databases.getDocument as jest.Mock).mockResolvedValue(mockFormConfig as any);
      (databases.updateDocument as jest.Mock).mockResolvedValue({
        ...mockFormConfig,
        version: 2,
      } as any);

      const result = await toggleFieldVisibility('1', mockManagerId);

      const toggledField = result.fields.find((f) => f.id === '1');
      expect(toggledField?.visible).toBe(false);
    });

    it('should throw error if field not found', async () => {
      (databases.getDocument as jest.Mock).mockResolvedValue(mockFormConfig as any);

      await expect(toggleFieldVisibility('999', mockManagerId)).rejects.toThrow('Field not found');
    });
  });

  describe('toggleFieldRequired', () => {
    it('should toggle field required status from true to false', async () => {
      (databases.getDocument as jest.Mock).mockResolvedValue(mockFormConfig as any);
      (databases.updateDocument as jest.Mock).mockResolvedValue({
        ...mockFormConfig,
        version: 2,
      } as any);

      const result = await toggleFieldRequired('1', mockManagerId);

      const toggledField = result.fields.find((f) => f.id === '1');
      expect(toggledField?.required).toBe(false);
    });

    it('should throw error if field not found', async () => {
      (databases.getDocument as jest.Mock).mockResolvedValue(mockFormConfig as any);

      await expect(toggleFieldRequired('999', mockManagerId)).rejects.toThrow('Field not found');
    });
  });

  describe('editing dropdown options', () => {
    it('should update dropdown field options', async () => {
      const configWithDropdown = {
        ...mockFormConfig,
        fields: JSON.stringify([
          { id: '1', type: 'text', label: 'Name', key: 'name', required: true, visible: true, order: 1 },
          { 
            id: '2', 
            type: 'dropdown', 
            label: 'Status', 
            key: 'status', 
            required: true, 
            visible: true, 
            order: 2,
            options: ['New', 'In Progress', 'Completed']
          },
        ]),
      };

      (databases.getDocument as jest.Mock).mockResolvedValue(configWithDropdown as any);
      (databases.updateDocument as jest.Mock).mockResolvedValue({
        ...configWithDropdown,
        version: 2,
      } as any);

      const newOptions = ['New', 'In Progress', 'Completed', 'Cancelled'];
      const result = await updateField('2', { options: newOptions }, mockManagerId);

      const updatedField = result.fields.find((f) => f.id === '2');
      expect(updatedField?.options).toEqual(newOptions);
      expect(updatedField?.options).toHaveLength(4);
    });

    it('should handle empty options array for dropdown', async () => {
      const configWithDropdown = {
        ...mockFormConfig,
        fields: JSON.stringify([
          { 
            id: '1', 
            type: 'dropdown', 
            label: 'Status', 
            key: 'status', 
            required: true, 
            visible: true, 
            order: 1,
            options: ['Option1', 'Option2']
          },
        ]),
      };

      (databases.getDocument as jest.Mock).mockResolvedValue(configWithDropdown as any);
      (databases.updateDocument as jest.Mock).mockResolvedValue({
        ...configWithDropdown,
        version: 2,
      } as any);

      const result = await updateField('1', { options: [] }, mockManagerId);

      const updatedField = result.fields.find((f) => f.id === '1');
      expect(updatedField?.options).toEqual([]);
    });
  });

  describe('version increment', () => {
    it('should increment version on each update', async () => {
      (databases.getDocument as jest.Mock).mockResolvedValue(mockFormConfig as any);
      
      let currentVersion = 1;
      (databases.updateDocument as jest.Mock).mockImplementation(() => {
        currentVersion++;
        return Promise.resolve({
          ...mockFormConfig,
          version: currentVersion,
        } as any);
      });

      const newField: FormField = {
        id: '3',
        type: 'text',
        label: 'Test',
        key: 'test',
        required: false,
        visible: true,
        order: 3,
      };

      const result1 = await addField(newField, mockManagerId);
      expect(result1.version).toBe(2);

      const result2 = await removeField('3', mockManagerId);
      expect(result2.version).toBe(3);
    });

    it('should increment version when publishing form changes', async () => {
      (databases.getDocument as jest.Mock).mockResolvedValue(mockFormConfig as any);
      (databases.updateDocument as jest.Mock).mockResolvedValue({
        ...mockFormConfig,
        version: 2,
      } as any);

      const updatedFields: FormField[] = [
        { id: '1', type: 'text', label: 'Name', key: 'name', required: true, visible: true, order: 1 },
        { id: '2', type: 'email', label: 'Email', key: 'email', required: true, visible: true, order: 2 },
        { id: '3', type: 'phone', label: 'Phone', key: 'phone', required: false, visible: true, order: 3 },
      ];

      const result = await updateFormConfig(updatedFields, mockManagerId);

      expect(result.version).toBe(2);
      expect(result.fields).toEqual(updatedFields);
    });
  });

  describe('form builder integration scenarios', () => {
    it('should handle adding field, toggling visibility, and publishing', async () => {
      // Initial config
      const initialConfig = {
        ...mockFormConfig,
        fields: JSON.stringify([
          { id: '1', type: 'text', label: 'Name', key: 'name', required: true, visible: true, order: 1 },
          { id: '2', type: 'email', label: 'Email', key: 'email', required: true, visible: true, order: 2 },
        ]),
        version: 1,
      };

      // Mock for adding field
      let currentFields = JSON.parse(initialConfig.fields);
      let currentVersion = 1;

      (databases.getDocument as jest.Mock).mockImplementation(() => {
        return Promise.resolve({
          ...initialConfig,
          fields: JSON.stringify(currentFields),
          version: currentVersion,
        });
      });

      (databases.updateDocument as jest.Mock).mockImplementation(() => {
        currentVersion++;
        return Promise.resolve({
          ...initialConfig,
          fields: JSON.stringify(currentFields),
          version: currentVersion,
        });
      });

      // Add a new field
      const newField: FormField = {
        id: '3',
        type: 'phone',
        label: 'Phone',
        key: 'phone',
        required: false,
        visible: true,
        order: 3,
      };

      const result1 = await addField(newField, mockManagerId);
      currentFields = result1.fields; // Update current fields
      expect(result1.version).toBe(2);
      expect(result1.fields).toHaveLength(3);

      // Toggle visibility
      const result2 = await toggleFieldVisibility('3', mockManagerId);
      currentFields = result2.fields; // Update current fields
      expect(result2.version).toBe(3);
      const toggledField = result2.fields.find((f) => f.id === '3');
      expect(toggledField?.visible).toBe(false);
    });

    it('should handle removing field and reordering remaining fields', async () => {
      const configWithThreeFields = {
        ...mockFormConfig,
        fields: JSON.stringify([
          { id: '1', type: 'text', label: 'Name', key: 'name', required: true, visible: true, order: 1 },
          { id: '2', type: 'email', label: 'Email', key: 'email', required: true, visible: true, order: 2 },
          { id: '3', type: 'phone', label: 'Phone', key: 'phone', required: false, visible: true, order: 3 },
        ]),
      };

      (databases.getDocument as jest.Mock).mockResolvedValue(configWithThreeFields as any);
      (databases.updateDocument as jest.Mock).mockResolvedValue({
        ...configWithThreeFields,
        version: 2,
      } as any);

      // Remove middle field
      const result = await removeField('2', mockManagerId);

      expect(result.fields).toHaveLength(2);
      expect(result.fields[0].id).toBe('1');
      expect(result.fields[0].order).toBe(1);
      expect(result.fields[1].id).toBe('3');
      expect(result.fields[1].order).toBe(2); // Reordered from 3 to 2
    });

    it('should handle toggling required status multiple times', async () => {
      const initialConfig = {
        ...mockFormConfig,
        fields: JSON.stringify([
          { id: '1', type: 'text', label: 'Name', key: 'name', required: true, visible: true, order: 1 },
          { id: '2', type: 'email', label: 'Email', key: 'email', required: true, visible: true, order: 2 },
        ]),
        version: 1,
      };

      let currentFields = JSON.parse(initialConfig.fields);
      let currentVersion = 1;

      (databases.getDocument as jest.Mock).mockImplementation(() => {
        return Promise.resolve({
          ...initialConfig,
          fields: JSON.stringify(currentFields),
          version: currentVersion,
        });
      });

      (databases.updateDocument as jest.Mock).mockImplementation(() => {
        currentVersion++;
        return Promise.resolve({
          ...initialConfig,
          fields: JSON.stringify(currentFields),
          version: currentVersion,
        });
      });

      // Toggle from true to false
      const result1 = await toggleFieldRequired('1', mockManagerId);
      currentFields = result1.fields; // Update current fields
      expect(result1.version).toBe(2);
      const field1 = result1.fields.find((f) => f.id === '1');
      expect(field1?.required).toBe(false);

      // Toggle from false to true
      const result2 = await toggleFieldRequired('1', mockManagerId);
      currentFields = result2.fields; // Update current fields
      expect(result2.version).toBe(3);
      const field2 = result2.fields.find((f) => f.id === '1');
      expect(field2?.required).toBe(true);
    });
  });
});
