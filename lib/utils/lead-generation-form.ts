import { LeadData } from "@/lib/types";

export const LEAD_GENERATION_SOURCE = "LinkedIN/Lead";

export interface LeadGenerationFormValues {
  firstName: string;
  middleName?: string;
  lastName: string;
  email?: string;
  phone: string;
  visaStatus: string;
  linkedinProfileUrl: string;
  resumeFileId?: string | null;
  resumeFileName?: string | null;
  userId: string;
  userName: string;
}

const REQUIRED_FIELDS: Array<{
  key: keyof Pick<
    LeadGenerationFormValues,
    "firstName" | "lastName" | "phone" | "visaStatus" | "linkedinProfileUrl"
  >;
  label: string;
}> = [
  { key: "firstName", label: "First Name" },
  { key: "lastName", label: "Last Name" },
  { key: "phone", label: "Phone No." },
  { key: "visaStatus", label: "Visa Status" },
  { key: "linkedinProfileUrl", label: "LinkedIn profile link" },
];

export function getMissingLeadGenerationFields(
  values: Pick<
    LeadGenerationFormValues,
    "firstName" | "lastName" | "phone" | "visaStatus" | "linkedinProfileUrl"
  >,
) {
  return REQUIRED_FIELDS.filter(({ key }) => !values[key].trim()).map(
    ({ label }) => label,
  );
}

export function buildLeadGenerationLeadData(
  values: LeadGenerationFormValues,
): LeadData {
  return {
    firstName: values.firstName.trim(),
    middleName: values.middleName?.trim() || undefined,
    lastName: values.lastName.trim(),
    email: values.email?.trim() || undefined,
    phone: values.phone.trim(),
    visaStatus: values.visaStatus.trim(),
    sourceName: LEAD_GENERATION_SOURCE,
    source: LEAD_GENERATION_SOURCE,
    generatedById: values.userId,
    generatedByName: values.userName,
    linkedinProfileUrl: values.linkedinProfileUrl.trim(),
    resumeFileId: values.resumeFileId || undefined,
    resumeFileName: values.resumeFileName || undefined,
  };
}
