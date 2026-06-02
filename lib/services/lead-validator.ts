import { Query } from 'appwrite';
import { databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { LeadData, LeadValidationResult } from '@/lib/types';
import { normalizeLinkedinProfileUrl } from '@/lib/utils/linkedin';

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
    const linkedinProfileUrl = (data as any).linkedinProfileUrl as string | undefined;
    const linkedinProfile = (data as any).linkedinProfile as string | undefined;
    const linkedinValue = (linkedinProfileUrl || linkedinProfile || '').trim();

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

    if (linkedinValue) {
      const result = await checkDuplicateField(
        'linkedinProfileUrl',
        linkedinValue,
        excludeLeadId,
      );
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
  field: 'email' | 'phone' | 'linkedinProfileUrl',
  value: string,
  excludeLeadId?: string
): Promise<LeadValidationResult | null> {
  const documents: any[] = [];
  let cursorAfter: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const queries: string[] = [
      Query.orderAsc('$id'),
      Query.limit(100),
      ...(cursorAfter ? [Query.cursorAfter(cursorAfter)] : []),
    ];

    const response = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.LEADS,
      queries,
    );
    documents.push(...response.documents);

    if (response.documents.length < 100) break;
    const lastDoc = response.documents[response.documents.length - 1] as any;
    if (!lastDoc?.$id) break;
    cursorAfter = lastDoc.$id as string;
  }

  const inputNormalized = normalizeDuplicateFieldValue(field, value);

  // Parse each candidate's data to verify the exact field match
  for (const doc of documents) {
    // Skip the lead being updated
    if (excludeLeadId && doc.$id === excludeLeadId) {
      continue;
    }

    try {
      const leadData = JSON.parse(doc.data as string) as LeadData;
      if (field === 'linkedinProfileUrl') {
        const docNormalized = normalizeLinkedinProfileUrl(
          (leadData as any).linkedinProfileUrl || (leadData as any).linkedinProfile,
        );
        if (inputNormalized && docNormalized && inputNormalized === docNormalized) {
          return {
            isValid: false,
            duplicateField: field,
            existingLeadId: doc.$id,
            existingBranchId: (doc.branchId as string) || undefined,
          };
        }
      } else if (
        inputNormalized &&
        normalizeDuplicateFieldValue(field, leadData[field]) === inputNormalized
      ) {
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

function normalizeDuplicateFieldValue(
  field: 'email' | 'phone' | 'linkedinProfileUrl',
  value: unknown,
) {
  if (typeof value !== 'string') return '';
  if (field === 'email') return value.trim().toLowerCase();
  if (field === 'phone') {
    const digits = value.replace(/\D/g, '');
    return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  }
  return normalizeLinkedinProfileUrl(value) ?? '';
}
