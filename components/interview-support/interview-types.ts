export interface InterviewFormData {
  to: string;
  cc: string;
  interviewDate: string;
  candidateName: string;
  technology: string;
  endClient: string;
  jobTitle: string;
  interviewRound: string;
  duration: string;
  emailId: string;
  contactNumber: string;
  resume: File | null;
  additionalAttachment: File | null;
  jobDescription: string;
  yourName: string;
  yourRole: string;
  yourPhone: string;
  company: "Silverspace Inc." | "Vizva Consultancy";
}

export const INITIAL_FORM_DATA: InterviewFormData = {
  to: "rgahlot@silverspaceinc.com",
  cc: "",
  interviewDate: "",
  candidateName: "",
  technology: "",
  endClient: "",
  jobTitle: "",
  interviewRound: "",
  duration: "",
  emailId: "",
  contactNumber: "",
  resume: null,
  additionalAttachment: null,
  jobDescription: "",
  yourName: "",
  yourRole: "",
  yourPhone: "",
  company: "Silverspace Inc.",
};

export const INTERVIEW_SUPPORT_CC_EMAILS = ["tech.leaders@silverspaceinc.com"];

export interface InterviewAttempt {
  $id: string;
  leadId: string;
  userId: string;
  attemptCount: number;
  lastAttemptAt: string;
  sentSubjects: string[];
}
