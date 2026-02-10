import { Query } from 'appwrite';
import { databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { LeadData, LeadValidationResult } from '@/lib/types';

/**
 * Validate lead uniqueness across all branches
 *
 * Checks for duplicate email and phone values globally (no branch filter).
 * The `data` field on leads is a JSON-serialized string containing lead data
 * including email and phone fields.
 *
 * @param data - The lead data to validate
 * @param excludeLeadId - Optional lead ID to exclude (used during updates)
 * @returns Validation result indicating if the lead data is unique
 */
export async function validateLeadUniqueness(
  data: LeadData,
  excludeLeadId?: string
): Promise<LeadValidationResult> {
  try {
    const email = data.email as string | undefined;
    const phone = data.phone as string | undefined;

    // Check email uniqueness if email is provided
    if (email) {
      const result = await checkDuplicateField('email', email, excludeLeadId);
      if (result) {
        return result;
      }
    }

    // Check phone uniqueness if phone is provided
    if (phone) {
      const result = await checkDuplicateField('phone', phone, excludeLeadId);
      if (result) {
        return result;
      }
    }

    return { isValid: true };
  } catch (error: any) {
    console.error('Error validating lead uniqueness:', error);
    throw new Error(error.message || 'Failed to validate lead uniqueness');
  }
}

/**
 * Check for a duplicate value in a specific field across all leads
 *
 * Since lead data is stored as a JSON string in the `data` field,
 * we query all leads and parse their data to check for matches.
 * We use Query.contains on the data field to narrow down candidates first.
 *
 * @param field - The field to check ('email' or 'phone')
 * @param value - The value to check for duplicates
 * @param excludeLeadId - Optional lead ID to exclude from the check
 * @returns LeadValidationResult if duplicate found, null otherwise
 */
async function checkDuplicateField(
  field: 'email' | 'phone',
  value: string,
  excludeLeadId?: string
): Promise<LeadValidationResult | null> {
  // Use Query.contains to narrow down candidates that have the value in their data JSON
  const queries: string[] = [
    Query.contains('data', [value]),
  ];

  const response = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.LEADS,
    queries
  );

  // Parse each candidate's data to verify the exact field match
  for (const doc of response.documents) {
    // Skip the lead being updated
    if (excludeLeadId && doc.$id === excludeLeadId) {
      continue;
    }

    try {
      const leadData = JSON.parse(doc.data as string) as LeadData;
      if (leadData[field] === value) {
        return {
          isValid: false,
          duplicateField: field,
          existingLeadId: doc.$id,
          existingBranchId: (doc.branchId as string) || undefined,
        };
      }
    } catch {
      // Skip leads with invalid JSON data
      continue;
    }
  }

  return null;
}
