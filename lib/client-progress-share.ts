export type SharedClientCard = {
  candidateName: string; salespersonName: string; marketingTl: string; recruiterName: string;
  progressStatus: string; enteredAt: string; marketingStartedOn: string; finalFeedback: string; finalSavedAt: string;
  email?: string; phone?: string; notes?: string;
};
export type SharedCardFeedback = { text: string; authorName: string; createdAt: string };
export type SharedCardPage = { card: SharedClientCard; feedback: SharedCardFeedback[]; nextCursor: string | null; expiresAt: string };
export type ClientCardShareStatus = { active: boolean; expiresAt: string | null; includeContact: boolean; includeNotes: boolean };
