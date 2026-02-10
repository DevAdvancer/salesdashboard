import { Permission, Role } from 'appwrite';
import { databases } from '@/lib/appwrite';
import { FormField, FormConfig } from '@/lib/types';

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const FORM_CONFIG_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_FORM_CONFIG_COLLECTION_ID!;

// Singleton document ID for form configuration
const FORM_CONFIG_DOC_ID = 'current';

/**
 * Default form fields configuration
 * These fields are used when no custom configuration exists
 */
export const DEFAULT_FIELDS: FormField[] = [
  { id: '1', type: 'text', label: 'First Name', key: 'firstName', required: true, visible: true, order: 1 },
  { id: '2', type: 'text', label: 'Last Name', key: 'lastName', required: true, visible: true, order: 2 },
  { id: '3', type: 'email', label: 'Email', key: 'email', required: true, visible: true, order: 3 },
  { id: '4', type: 'phone', label: 'Phone', key: 'phone', required: false, visible: true, order: 4 },
  { id: '5', type: 'text', label: 'Company', key: 'company', required: false, visible: true, order: 5 },
  {
    id: '6',
    type: 'dropdown',
    label: 'Source',
    key: 'source',
    required: false,
    visible: true,
    order: 6,
    options: ['Website', 'Referral', 'Cold Call', 'Social Media'],
  },
  {
    id: '7',
    type: 'dropdown',
    label: 'Status',
    key: 'status',
    required: true,
    visible: true,
    order: 7,
    options: ['New', 'Contacted', 'Qualified', 'Proposal', 'Negotiation'],
  },
  { id: '8', type: 'text', label: 'Owner', key: 'ownerId', required: true, visible: false, order: 8 },
  { id: '9', type: 'text', label: 'Assigned To', key: 'assignedToId', required: false, visible: true, order: 9 },
  { id: '10', type: 'text', label: 'Legal Name', key: 'legalName', required: false, visible: true, order: 10 },
  {
    id: '11',
    type: 'text',
    label: 'SSN (Last 4)',
    key: 'ssnLast4',
    required: false,
    visible: true,
    order: 11,
    validation: { pattern: '^\\d{4}$', minLength: 4, maxLength: 4 },
  },
  {
    id: '12',
    type: 'dropdown',
    label: 'Visa Status',
    key: 'visaStatus',
    required: false,
    visible: true,
    order: 12,
    options: ['Citizen', 'Green Card', 'H1B', 'F1', 'Other'],
  },
  { id: '13', type: 'textarea', label: 'Notes', key: 'notes', required: false, visible: true, order: 13 },
];

/**
 * Get the current form configuration
 *
 * This function fetches the form configuration from the database.
 * If no configuration exists, it returns the default fields.
 *
 * @returns The current form configuration with parsed fields
 */
export async function getFormConfig(): Promise<{ fields: FormField[]; version: number; updatedBy: string }> {
  try {
    const config = await databases.getDocument(
      DATABASE_ID,
      FORM_CONFIG_COLLECTION_ID,
      FORM_CONFIG_DOC_ID
    );

    // Parse the JSON string to get the fields array
    const fields = JSON.parse(config.fields as string) as FormField[];

    return {
      fields,
      version: config.version as number,
      updatedBy: config.updatedBy as string,
    };
  } catch (error: any) {
    // If document doesn't exist (404), return default fields
    if (error.code === 404 || error.message?.includes('not found')) {
      return {
        fields: DEFAULT_FIELDS,
        version: 0,
        updatedBy: '',
      };
    }

    console.error('Error fetching form config:', error);
    throw new Error(error.message || 'Failed to fetch form configuration');
  }
}

/**
 * Update the form configuration
 *
 * This function updates the form configuration with new fields.
 * It automatically increments the version number and uses the singleton pattern.
 *
 * @param fields - The new form fields configuration
 * @param managerId - The ID of the manager making the update
 * @returns The updated form configuration
 */
export async function updateFormConfig(
  fields: FormField[],
  managerId: string
): Promise<{ fields: FormField[]; version: number; updatedBy: string }> {
  try {
    // Get current config to increment version
    const currentConfig = await getFormConfig();
    const newVersion = currentConfig.version + 1;

    // Serialize fields to JSON string
    const fieldsJson = JSON.stringify(fields);

    // Try to update existing document
    try {
      const updatedConfig = await databases.updateDocument(
        DATABASE_ID,
        FORM_CONFIG_COLLECTION_ID,
        FORM_CONFIG_DOC_ID,
        {
          fields: fieldsJson,
          version: newVersion,
          updatedBy: managerId,
        }
      );

      return {
        fields,
        version: updatedConfig.version as number,
        updatedBy: updatedConfig.updatedBy as string,
      };
    } catch (updateError: any) {
      // If document doesn't exist, create it
      if (updateError.code === 404 || updateError.message?.includes('not found')) {
        const createdConfig = await databases.createDocument(
          DATABASE_ID,
          FORM_CONFIG_COLLECTION_ID,
          FORM_CONFIG_DOC_ID,
          {
            fields: fieldsJson,
            version: newVersion,
            updatedBy: managerId,
          },
          [
            // All authenticated users can read
            Permission.read(Role.users()),
            // Only managers can update
            Permission.update(Role.label('manager')),
            // Only managers can delete
            Permission.delete(Role.label('manager')),
          ]
        );

        return {
          fields,
          version: createdConfig.version as number,
          updatedBy: createdConfig.updatedBy as string,
        };
      }

      throw updateError;
    }
  } catch (error: any) {
    console.error('Error updating form config:', error);
    throw new Error(error.message || 'Failed to update form configuration');
  }
}

/**
 * Add a new field to the form configuration
 *
 * @param field - The field to add
 * @param managerId - The ID of the manager making the update
 * @returns The updated form configuration
 */
export async function addField(field: FormField, managerId: string): Promise<{ fields: FormField[]; version: number; updatedBy: string }> {
  const currentConfig = await getFormConfig();
  const fields = [...currentConfig.fields, field];
  return updateFormConfig(fields, managerId);
}

/**
 * Remove a field from the form configuration
 *
 * @param fieldId - The ID of the field to remove
 * @param managerId - The ID of the manager making the update
 * @returns The updated form configuration
 */
export async function removeField(fieldId: string, managerId: string): Promise<{ fields: FormField[]; version: number; updatedBy: string }> {
  const currentConfig = await getFormConfig();
  const fields = currentConfig.fields.filter((f) => f.id !== fieldId);
  
  // Reorder remaining fields to maintain sequential order
  const reorderedFields = fields.map((field, index) => ({
    ...field,
    order: index + 1,
  }));
  
  return updateFormConfig(reorderedFields, managerId);
}

/**
 * Reorder fields in the form configuration
 *
 * @param fieldIds - Array of field IDs in the desired order
 * @param managerId - The ID of the manager making the update
 * @returns The updated form configuration
 */
export async function reorderFields(fieldIds: string[], managerId: string): Promise<{ fields: FormField[]; version: number; updatedBy: string }> {
  const currentConfig = await getFormConfig();
  
  // Create a map of field ID to field for quick lookup
  const fieldMap = new Map(currentConfig.fields.map((f) => [f.id, f]));
  
  // Reorder fields based on the provided IDs and update order property
  const reorderedFields = fieldIds
    .map((id) => fieldMap.get(id))
    .filter((field): field is FormField => field !== undefined)
    .map((field, index) => ({
      ...field,
      order: index + 1,
    }));
  
  return updateFormConfig(reorderedFields, managerId);
}

/**
 * Update a specific field in the form configuration
 *
 * @param fieldId - The ID of the field to update
 * @param updates - Partial field updates
 * @param managerId - The ID of the manager making the update
 * @returns The updated form configuration
 */
export async function updateField(
  fieldId: string,
  updates: Partial<FormField>,
  managerId: string
): Promise<{ fields: FormField[]; version: number; updatedBy: string }> {
  const currentConfig = await getFormConfig();
  const fields = currentConfig.fields.map((field) =>
    field.id === fieldId ? { ...field, ...updates } : field
  );
  
  return updateFormConfig(fields, managerId);
}

/**
 * Toggle field visibility
 *
 * @param fieldId - The ID of the field to toggle
 * @param managerId - The ID of the manager making the update
 * @returns The updated form configuration
 */
export async function toggleFieldVisibility(
  fieldId: string,
  managerId: string
): Promise<{ fields: FormField[]; version: number; updatedBy: string }> {
  const currentConfig = await getFormConfig();
  const field = currentConfig.fields.find((f) => f.id === fieldId);
  
  if (!field) {
    throw new Error('Field not found');
  }
  
  return updateField(fieldId, { visible: !field.visible }, managerId);
}

/**
 * Toggle field required status
 *
 * @param fieldId - The ID of the field to toggle
 * @param managerId - The ID of the manager making the update
 * @returns The updated form configuration
 */
export async function toggleFieldRequired(
  fieldId: string,
  managerId: string
): Promise<{ fields: FormField[]; version: number; updatedBy: string }> {
  const currentConfig = await getFormConfig();
  const field = currentConfig.fields.find((f) => f.id === fieldId);
  
  if (!field) {
    throw new Error('Field not found');
  }
  
  return updateField(fieldId, { required: !field.required }, managerId);
}
