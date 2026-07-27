import { Lead } from "@/lib/types";

export interface MockFormData {
  to: string;
  cc: string;
  candidateName: string;
  endClient: string;
  emailId: string;
  contactNumber: string;
  resume: File | null;
  role: string;
  schedule: string;
  emailBody: string;
  yourName: string;
  yourRole: string;
  yourPhone: string;
  company: "Silverspace Inc." | "Vizva Consultancy";
}

export interface MockAttempt {
  $id: string;
  leadId: string;
  userId: string;
  attemptCount: number;
  lastAttemptAt: string;
}

export const INITIAL_FORM_DATA: MockFormData = {
  to: "tech.leaders@silverspaceinc.com",
  cc: "",
  candidateName: "",
  endClient: "",
  emailId: "",
  contactNumber: "",
  resume: null,
  role: "",
  schedule: "",
  emailBody: "Hi Team,\n\nThe candidate is available for the whole day.",
  yourName: "",
  yourRole: "",
  yourPhone: "",
  company: "Silverspace Inc.",
};
