"use server";

import { unstable_cache, revalidateTag } from "next/cache";
import { 
  getFormConfig, 
  getClosureFormConfig, 
  getPaymentPlanFormConfig, 
  getClientIntakeFormConfig 
} from "@/lib/services/form-config-service";

export const getCachedFormConfigAction = unstable_cache(
  async () => getFormConfig(),
  ['form-config', 'current'],
  { tags: ['form-config'], revalidate: 3600 }
);

export const getCachedClosureFormConfigAction = unstable_cache(
  async () => getClosureFormConfig(),
  ['form-config', 'closure'],
  { tags: ['form-config'], revalidate: 3600 }
);

export const getCachedPaymentPlanFormConfigAction = unstable_cache(
  async () => getPaymentPlanFormConfig(),
  ['form-config', 'payment_plan'],
  { tags: ['form-config'], revalidate: 3600 }
);

export const getCachedClientIntakeFormConfigAction = unstable_cache(
  async () => getClientIntakeFormConfig(),
  ['form-config', 'client_intake'],
  { tags: ['form-config'], revalidate: 3600 }
);

export async function revalidateFormConfigAction() {
  revalidateTag('form-config', { expire: 0 });
}
