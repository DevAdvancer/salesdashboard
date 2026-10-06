/** Browser-independent contract shared by the CRM endpoint and extension. */
export interface ExtensionUser { id: string; name: string }
export interface ExtensionQuota { used: number; limit: number | null; remaining: number | null }
export interface ExtensionAccount {
  id: string; name: string; company: string; type: "main" | "sudo"; connectionLimit: number | null;
}
export interface ExtensionBootstrap {
  user: ExtensionUser; today: string; accounts: Array<ExtensionAccount & ExtensionQuota>;
}
export type ExtensionState = "new" | "active_request" | "lead_exists" | "resend_available" | "limit_reached" | "missing_limit";
export interface ExtensionHistory {
  requestId: string | null; own: boolean; status: "sent" | "accepted" | "withdrawn";
  dateSent: string; acceptedAt: string | null; withdrawnAt: string | null; isActive: boolean;
}
export interface ExtensionCheck extends ExtensionQuota {
  user: ExtensionUser; today: string; targetUrl: string; account: ExtensionAccount;
  state: ExtensionState; canRecord: boolean; revision: string; history: ExtensionHistory[];
}
export interface ExtensionRecord extends ExtensionCheck { mode: "created" | "resent" | "existing" }
export type ExtensionInput = { operation: "check" | "history"; accountId: string; targetUrl: string } |
  { operation: "record"; accountId: string; targetUrl: string; revision?: string; confirmResend: boolean };
export type ExtensionMessage = { type: "crm-api"; input?: ExtensionInput; fresh?: boolean } | { type: "ensure-crm" | "open-crm" };
export type ExtensionResponse<T = unknown> = { ok: true; data?: T } | { ok: false; error: string; status?: number };
