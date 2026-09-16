"use server";

import { unstable_cache, revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/server/appwrite";
import { COLLECTIONS } from "@/lib/constants/appwrite";
import { FormField } from "@/lib/types";
import {
  DEFAULT_FIELDS,
  DEFAULT_CLOSURE_FIELDS,
  DEFAULT_PAYMENT_PLAN_FIELDS,
  DEFAULT_CLIENT_INTAKE_FIELDS,
  normalizeFormFields
} from "@/lib/services/form-config-service";

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const FORM_CONFIG_COLLECTION_ID = COLLECTIONS.FORM_CONFIG || process.env.NEXT_PUBLIC_APPWRITE_FORM_CONFIG_COLLECTION_ID!;

async function getFormConfigDocumentServer(
  docId: string,
  defaultFields: FormField[]
): Promise<{ fields: FormField[]; version: number; updatedBy: string }> {
  try {
    const { databases } = await createAdminClient();
    const config = await databases.getDocument(DATABASE_ID, FORM_CONFIG_COLLECTION_ID, docId);
    const fields = normalizeFormFields(JSON.parse(config.fields as string) as FormField[]);

    return {
      fields,
      version: config.version as number,
      updatedBy: config.updatedBy as string,
    };
  } catch (error: any) {
    if (error.code === 404 || error.message?.includes('not found')) {
      return {
        fields: normalizeFormFields(defaultFields),
        version: 0,
        updatedBy: '',
      };
    }
    throw error;
  }
}

export const getCachedFormConfigAction = unstable_cache(
  async () => getFormConfigDocumentServer('current', DEFAULT_FIELDS),
  ['form-config', 'current'],
  { tags: ['form-config'], revalidate: 3600 }
);

export const getCachedClosureFormConfigAction = unstable_cache(
  async () => getFormConfigDocumentServer('closure', DEFAULT_CLOSURE_FIELDS),
  ['form-config', 'closure'],
  { tags: ['form-config'], revalidate: 3600 }
);

export const getCachedPaymentPlanFormConfigAction = unstable_cache(
  async () => getFormConfigDocumentServer('payment_plan', DEFAULT_PAYMENT_PLAN_FIELDS),
  ['form-config', 'payment_plan'],
  { tags: ['form-config'], revalidate: 3600 }
);

export const getCachedClientIntakeFormConfigAction = unstable_cache(
  async () => getFormConfigDocumentServer('client_intake', DEFAULT_CLIENT_INTAKE_FIELDS),
  ['form-config', 'client_intake'],
  { tags: ['form-config'], revalidate: 3600 }
);

export async function revalidateFormConfigAction() {
  revalidateTag('form-config', { expire: 0 });
}
