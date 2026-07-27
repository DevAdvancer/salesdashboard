export interface AssessmentFormData {
  to: string;
  cc: string;
  assessmentReceived: string; // ISO string from datetime-local input
  assessmentDeadline: string; // ISO string from datetime-local input
  candidateName: string;
  technology: string;
  emailId: string;
  contactNumber: string;
  endClient: string;
  jobTitle: string;
  interviewRound: string;
  assessmentDuration: string;
  resume: File | null;
  additionalAttachment: File | null;
  jobDescription: string;
  // Signature fields
  yourName: string;
  yourRole: string;
  yourPhone: string;
  company: "Silverspace Inc." | "Vizva Consultancy";
}

export const INITIAL_FORM_DATA: AssessmentFormData = {
  to: "rgahlot@silverspaceinc.com",
  // to: "prateek.narvariya@silverspaceinc.com",
  cc: "",
  assessmentReceived: "",
  assessmentDeadline: "",
  candidateName: "",
  technology: "",
  emailId: "",
  contactNumber: "",
  endClient: "",
  jobTitle: "",
  interviewRound: "",
  assessmentDuration: "",
  resume: null,
  additionalAttachment: null,
  jobDescription: "",
  yourName: "",
  yourRole: "",
  yourPhone: "",
  company: "Silverspace Inc.",
};

export const ASSESSMENT_SUPPORT_CC_EMAILS = ["tech.leaders@silverspaceinc.com"];

export interface AssessmentAttempt {
  $id: string;
  leadId: string;
  userId: string;
  attemptCount: number;
  lastAttemptAt: string;
  sentSubjects: string[];
}

export interface GraphAttachment {
  "@odata.type": "#microsoft.graph.fileAttachment";
  name: string;
  contentType: string;
  contentBytes: string;
}
