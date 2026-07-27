import {
  getFormConfig,
  updateFormConfig,
  addField,
  removeField,
  reorderFields,
  updateField,
  toggleFieldVisibility,
  toggleFieldRequired,
  DEFAULT_FIELDS,
} from '@/lib/services/form-config-service';
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

/**
 * NOTE ON SCOPE
 *
 * Form field management is intentionally disabled at the service layer:
 * `updateFormConfig()` throws "Field management is disabled" (see
 * lib/services/form-config-service.ts, README "Form field not saving", and
 * docs/DEVELOPER_GUIDE.md sections 18/19). Every mutation helper
 * (addField / removeField / reorderFields / updateField /
 * toggleFieldVisibility / toggleFieldRequired) funnels through it, so none of
 * them can persist anything.
 *
 * These tests therefore assert the behaviour the code actually promises today:
 * reads work and fall back to defaults, and every write path rejects WITHOUT
 * touching the database. If the throw is removed to re-enable field
 * management, these "disabled" tests are the ones to replace with round-trip
 * persistence tests again.
 */
describe('Form Configuration Service', () => {
  const mockManagerId = 'teamLead-123';
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

    it('should dedupe and canonicalize status dropdown options', async () => {
      (databases.getDocument as jest.Mock).mockResolvedValue({
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
            // Legacy data: retired options, casing drift and separator drift.
            options: ['Interested', 'not-interested', 'Not Interested', 'Signed', 'Closure', 'Prospect'],
          },
        ]),
      } as any);

      const result = await getFormConfig();

      // 'Signed' / 'Closure' are retired statuses and are stripped;
      // 'not-interested' is canonicalized and then deduped against 'Not Interested'.
      expect(result.fields[0].options).toEqual(['Interested', 'Not Interested', 'Prospect']);
    });

    it('should dedupe non-status dropdown options case-insensitively and drop blanks', async () => {
      (databases.getDocument as jest.Mock).mockResolvedValue({
        ...mockFormConfig,
        fields: JSON.stringify([
          {
            id: '1',
            type: 'dropdown',
            label: 'Source',
            key: 'source',
            required: false,
            visible: true,
            order: 1,
            options: ['Referral', '  referral  ', '', '   ', 'Website'],
          },
        ]),
      } as any);

      const result = await getFormConfig();

      expect(result.fields[0].options).toEqual(['Referral', 'Website']);
    });
  });

  describe('field management is disabled', () => {
    const newFields: FormField[] = [
      { id: '1', type: 'text', label: 'Full Name', key: 'fullName', required: true, visible: true, order: 1 },
    ];

    const newField: FormField = {
      id: '3',
      type: 'phone',
      label: 'Phone',
      key: 'phone',
      required: false,
      visible: true,
      order: 3,
    };

    const expectNoWrite = () => {
      expect(databases.updateDocument).not.toHaveBeenCalled();
      expect(databases.createDocument).not.toHaveBeenCalled();
    };

    beforeEach(() => {
      (databases.getDocument as jest.Mock).mockResolvedValue(mockFormConfig as any);
    });

    it('should reject updateFormConfig without writing to the database', async () => {
      await expect(updateFormConfig(newFields, mockManagerId)).rejects.toThrow('Field management is disabled');
      expectNoWrite();
    });

    it('should reject addField without writing to the database', async () => {
      await expect(addField(newField, mockManagerId)).rejects.toThrow('Field management is disabled');
      expectNoWrite();
    });

    it('should reject removeField without writing to the database', async () => {
      await expect(removeField('2', mockManagerId)).rejects.toThrow('Field management is disabled');
      expectNoWrite();
    });

    it('should reject reorderFields without writing to the database', async () => {
      await expect(reorderFields(['2', '1'], mockManagerId)).rejects.toThrow('Field management is disabled');
      expectNoWrite();
    });

    it('should reject updateField without writing to the database', async () => {
      await expect(
        updateField('1', { label: 'Full Name', required: false }, mockManagerId)
      ).rejects.toThrow('Field management is disabled');
      expectNoWrite();
    });

    it('should reject updateField for dropdown options without writing to the database', async () => {
      (databases.getDocument as jest.Mock).mockResolvedValue({
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
            options: ['New', 'In Progress', 'Completed'],
          },
        ]),
      } as any);

      await expect(
        updateField('1', { options: ['New', 'In Progress', 'Completed', 'Cancelled'] }, mockManagerId)
      ).rejects.toThrow('Field management is disabled');
      expectNoWrite();
    });

    it('should reject toggleFieldVisibility for an existing field without writing to the database', async () => {
      await expect(toggleFieldVisibility('1', mockManagerId)).rejects.toThrow('Field management is disabled');
      expectNoWrite();
    });

    it('should reject toggleFieldRequired for an existing field without writing to the database', async () => {
      await expect(toggleFieldRequired('1', mockManagerId)).rejects.toThrow('Field management is disabled');
      expectNoWrite();
    });
  });

  describe('field lookup validation', () => {
    beforeEach(() => {
      (databases.getDocument as jest.Mock).mockResolvedValue(mockFormConfig as any);
    });

    it('toggleFieldVisibility should throw error if field not found', async () => {
      await expect(toggleFieldVisibility('999', mockManagerId)).rejects.toThrow('Field not found');
    });

    it('toggleFieldRequired should throw error if field not found', async () => {
      await expect(toggleFieldRequired('999', mockManagerId)).rejects.toThrow('Field not found');
    });
  });
});
