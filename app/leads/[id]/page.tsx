"use client";

import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useAuth } from "@/lib/contexts/auth-context";
import { useRouter, useParams } from "next/navigation";
import { getLead } from "@/lib/services/lead-service";
import { getLeadAction } from "@/app/actions/lead";
import { sendChatMessageAction } from "@/app/actions/chat";
import {
  assignLead,
  backoutLead,
  clearLeadReadCache,
  closeLead,
  listLeadAssignableAgents,
  notInterestedLead,
  reopenLead,
  updateLead,
} from "@/lib/services/lead-action-service";
import { getAssignableUsers } from "@/lib/services/user-service";
import {
  getClosureFormConfig,
  getFormConfig,
  getPaymentPlanFormConfig,
} from "@/lib/services/form-config-service";
import { upsertClientPaymentRecord } from "@/lib/services/client-payment-service";
import {
  Lead,
  User,
  FormField,
  LeadData,
  LeadDataValue,
  PaymentStatus,
} from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { ProtectedRoute } from "@/components/protected-route";
import { LeadActivityTimeline } from "@/components/leads/lead-activity-timeline";
import { LeadFollowUpCard } from "@/components/leads/lead-follow-up-card";
import { LeadNotesCard } from "@/components/leads/lead-notes-card";
import { storage } from "@/lib/appwrite";
import { BUCKETS } from "@/lib/constants/appwrite";
import {
  LEAD_WORKFLOW_STATUSES,
  getLeadEditAllowedStatuses,
  isAllowedLeadStatusTransition,
  normalizeLeadStatus,
  canonicalizeLeadStatus,
  shouldRequireLeadFollowUpForStatus,
} from "@/lib/utils/lead-status-workflow";
import {
  getLinkedinProfileValue,
  isLinkedinProfileField,
} from "@/lib/utils/lead-linkedin-field";
import { getErrorMessage } from "@/lib/utils";
import { parseLeadActionError } from "@/lib/utils/lead-action-error";

function isBackoutStatus(value: unknown) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!text) return false;
  return (
    text === "backout" ||
    text === "backedout" ||
    text === "backed out" ||
    text === "back out" ||
    text.replace(/\s+/g, "") === "backedout" ||
    text.replace(/\s+/g, "") === "backout"
  );
}

function normalizeStatusText(value: unknown) {
  return normalizeLeadStatus(value);
}

function formatFollowUpDateTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatFollowUpStatus(value?: string | null): string {
  if (!value) return "Not set";
  const normalized = value.toLowerCase();
  if (normalized === "pending") return "Pending";
  if (normalized === "completed") return "Completed";
  if (normalized === "overdue") return "Overdue";
  return value;
}

function isNotInterestedStatus(value: unknown) {
  return normalizeStatusText(value) === "notinterested";
}

function isLinkedinRequestLead(data: LeadData) {
  const requestId = (data as any).linkedinRequestId;
  return typeof requestId === "string" && requestId.trim().length > 0;
}

// Ensures a "lastName" text field is always present and rendered just below
// "firstName". Mirrors the fallback used in DynamicLeadForm so the lead edit
// view never silently drops the last name field if it was removed from the
// saved form config.
function withLastNameField(fields: FormField[]): FormField[] {
  if (fields.some((f) => f.key === "lastName")) return fields;

  const firstNameField = fields.find((f) => f.key === "firstName");
  const injected: FormField = {
    id: "static-lastname",
    key: "lastName",
    label: "Last Name",
    type: "text",
    required: false,
    visible: true,
    order: firstNameField ? firstNameField.order + 0.1 : 0,
  };

  const firstNameIndex = fields.findIndex((f) => f.key === "firstName");
  if (firstNameIndex !== -1) {
    return [
      ...fields.slice(0, firstNameIndex + 1),
      injected,
      ...fields.slice(firstNameIndex + 1),
    ];
  }
  return [injected, ...fields];
}

export default function LeadDetailPage() {
  return (
    <ProtectedRoute componentKey="leads">
      <LeadDetailContent />
    </ProtectedRoute>
  );
}

function LeadDetailContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const { toast } = useToast();
  const leadId = params.id as string;

  const [lead, setLead] = useState<Lead | null>(null);
  const [leadData, setLeadData] = useState<LeadData>({});
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [agents, setAgents] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [closeStep, setCloseStep] = useState(1);
  const [closeStatus, setCloseStatus] = useState("Closed");
  const [initialPaymentStatus, setInitialPaymentStatus] = useState<string>("");
  const [closureFields, setClosureFields] = useState<FormField[]>([]);
  const [paymentPlanFields, setPaymentPlanFields] = useState<FormField[]>([]);
  const [closureValues, setClosureValues] = useState<Record<string, unknown>>(
    {},
  );
  const [paymentPlanValues, setPaymentPlanValues] = useState<
    Record<string, unknown>
  >({});

  const loadLead = useCallback(async () => {
    if (!user) return;

    try {
      setIsLoading(true);
      setError(null);
      const fetchedLead =
        user.role === "monitor" || user.role === "operations"
          ? await getLeadAction(leadId, user.$id)
          : await getLead(leadId);
      setLead(fetchedLead);
      setLeadData(JSON.parse(fetchedLead.data));
    } catch (err: unknown) {
      console.error("Error loading lead:", err);
      setError(getErrorMessage(err, "Failed to load lead"));
    } finally {
      setIsLoading(false);
    }
  }, [leadId, user]);

  const loadFormConfig = useCallback(async () => {
    try {
      const config = await getFormConfig();
      const fields = config.fields;
      setFormFields(fields.sort((a, b) => a.order - b.order));
    } catch (err: unknown) {
      console.error("Error loading form config:", err);
    }
  }, []);

  const loadCloseConfigs = useCallback(async () => {
    try {
      const [closureConfig, paymentConfig] = await Promise.all([
        getClosureFormConfig(),
        getPaymentPlanFormConfig(),
      ]);
      const closure = closureConfig.fields.sort((a, b) => a.order - b.order);
      const payment = paymentConfig.fields.sort((a, b) => a.order - b.order);
      setClosureFields(closure);
      setPaymentPlanFields(payment);

      const nextClosureValues: Record<string, unknown> = {};
      for (const field of closure) {
        const rawValue = leadData[field.key];
        if (
          typeof rawValue === "string" ||
          typeof rawValue === "number" ||
          typeof rawValue === "boolean"
        ) {
          nextClosureValues[field.key] = String(rawValue);
        } else if (Array.isArray(rawValue)) {
          nextClosureValues[field.key] = rawValue.map((v) => String(v));
        } else if (rawValue === null || rawValue === undefined) {
          nextClosureValues[field.key] = field.type === "checklist" ? [] : "";
        } else {
          nextClosureValues[field.key] = JSON.stringify(rawValue);
        }
      }

      const nextPaymentValues: Record<string, unknown> = {};
      for (const field of payment) {
        nextPaymentValues[field.key] = field.type === "checklist" ? [] : "";
      }

      setClosureValues(nextClosureValues);
      setPaymentPlanValues(nextPaymentValues);
    } catch (err: unknown) {
      console.error("Error loading close configs:", err);
    }
  }, [leadData]);

  const loadAgents = useCallback(async () => {
    if (!user || !lead) return;

    try {
      if (lead.ownerId === user.$id) {
        const fetchedAgents = await listLeadAssignableAgents(
          lead.$id,
          user.$id,
        );
        setAgents(
          fetchedAgents.filter((candidate) =>
            user.role === "lead_generation"
              ? candidate.role === "team_lead"
              : candidate.role === "agent",
          ),
        );
        return;
      }

      if (
        user.role === "team_lead" ||
        user.role === "admin" ||
        user.role === "developer"
      ) {
        const fetchedAgents = await getAssignableUsers(
          user.role,
          user.branchIds || [],
          user.$id,
        );
        setAgents(
          fetchedAgents.filter((candidate) => candidate.role === "agent"),
        );
      }
    } catch (err: unknown) {
      console.error("Error loading agents:", err);
    }
  }, [lead, user]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
      return;
    }

    if (user && leadId) {
      loadLead();
      loadFormConfig();
    }
  }, [user, authLoading, leadId, router, loadLead, loadFormConfig, loadAgents]);

  useEffect(() => {
    if (!user || !lead) return;
    if (
      lead.ownerId === user.$id ||
      user.role === "team_lead" ||
      user.role === "admin" ||
      user.role === "developer"
    ) {
      void loadAgents();
    }
  }, [lead, loadAgents, user]);

  useEffect(() => {
    if (!showCloseDialog) return;
    setCloseStep(1);
    void loadCloseConfigs();
  }, [showCloseDialog, loadCloseConfigs]);

  const handleSave = async () => {
    if (!lead || !user) return;
    if (user.role === "operations") return;
    if (user.role === "monitor" && lead.ownerId !== user.$id) return;

    try {
      setIsSaving(true);

      const nextStatus = (leadData as any).status;
      const previousStatus = lead.status;
      const statusChanged =
        normalizeStatusText(nextStatus) &&
        normalizeStatusText(previousStatus) !== normalizeStatusText(nextStatus);

      if (
        !isLeadGeneration &&
        !lead.isClosed &&
        shouldRequireLeadFollowUpForStatus(previousStatus, nextStatus)
      ) {
        const hasNextFollowUpAt = Boolean(lead.nextFollowUpAt);
        const hasFollowUpStatus = Boolean(
          lead.followUpStatus && String(lead.followUpStatus).trim(),
        );
        if (!hasNextFollowUpAt || !hasFollowUpStatus) {
          toast({
            title: "Follow-up required",
            description:
              "Please fill Next Follow-Up and Follow-Up Status in Follow-Up Plan and save it before updating the lead.",
            variant: "destructive",
          });
          return;
        }
      }

      if (
        statusChanged &&
        !isAllowedLeadStatusTransition(previousStatus, nextStatus)
      ) {
        toast({
          title: "Error",
          description: "Invalid status transition for this lead.",
          variant: "destructive",
        });
        return;
      }

      await updateLead(leadId, leadData, user.$id, user.name);
      if (statusChanged && isNotInterestedStatus(nextStatus)) {
        await notInterestedLead(leadId, user.$id, user.name);
        toast({
          title: "Success",
          description: "Lead marked as Not Interested",
        });
        setIsEditing(false);
        await loadLead();
        router.push("/leads");
        return;
      }
      if (statusChanged && isBackoutStatus(nextStatus)) {
        await backoutLead(leadId, user.$id, user.name);
        toast({
          title: "Success",
          description: "Lead marked as Backout",
        });
        setIsEditing(false);
        await loadLead();
        router.push("/leads");
        return;
      }
      if (
        statusChanged &&
        normalizeStatusText(nextStatus) === "signedclosure"
      ) {
        await closeLead(leadId, "Signed/Closure", user.$id, user.name);
        clearLeadReadCache();
        toast({
          title: "Success",
          description: "Lead closed successfully",
        });
        setIsEditing(false);
        router.push("/leads");
        return;
      }
      clearLeadReadCache();
      toast({
        title: "Success",
        description: "Lead updated successfully",
      });
      setIsEditing(false);
      await loadLead();
    } catch (err: unknown) {
      console.error("Error saving lead:", err);
      const parsed = parseLeadActionError(err);
      if (parsed && parsed.field) {
        setFieldErrors((prev) => ({ ...prev, [parsed.field!]: parsed.message }));
        return;
      }
      toast({
        title: "Error",
        description: parsed?.message || getErrorMessage(err, "Failed to save lead"),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCloseLead = async () => {
    if (!lead || !user) return;
    if (user.role === "operations") return;
    if (user.role === "monitor" && lead.ownerId !== user.$id) return;

    try {
      setIsSaving(true);
      if (isBackoutStatus(closeStatus)) {
        await backoutLead(leadId, user.$id, user.name);
        toast({
          title: "Success",
          description: "Lead marked as Backout",
        });
        setShowCloseDialog(false);
        router.push("/leads");
        return;
      }

      const missingRequired = (
        fields: FormField[],
        values: Record<string, unknown>,
      ) => {
        const missing: string[] = [];
        for (const field of fields) {
          if (!field.visible || !field.required) continue;
          const raw = values[field.key];
          if (field.type === "checklist") {
            if (!Array.isArray(raw) || raw.length === 0)
              missing.push(field.label);
            continue;
          }
          const text =
            typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
          if (!text) missing.push(field.label);
        }
        return missing;
      };

      const missingClosure = missingRequired(closureFields, closureValues);
      const missingPayment = missingRequired(
        paymentPlanFields,
        paymentPlanValues,
      );
      const missing = [...missingClosure, ...missingPayment];
      if (missing.length > 0) {
        toast({
          title: "Missing required fields",
          description: `Please fill: ${missing.join(", ")}`,
          variant: "destructive",
        });
        return;
      }

      const percent = Number(paymentPlanValues.paymentPercent);
      const months = Number(paymentPlanValues.paymentMonths);
      const upfrontAmount = Number(paymentPlanValues.upfrontAmount);

      if (
        !Number.isFinite(percent) ||
        !Number.isFinite(months) ||
        !Number.isFinite(upfrontAmount)
      ) {
        toast({
          title: "Invalid payment details",
          description:
            "Payment percent, months, and upfront amount must be valid numbers.",
          variant: "destructive",
        });
        return;
      }

      await upsertClientPaymentRecord({
        actorId: user.$id,
        leadId,
        personalDetails: closureValues,
        paymentPlan: { percent, months, upfrontAmount },
        initialStatus: (initialPaymentStatus ||
          (upfrontAmount > 0 ? "partially_paid" : "not_paid")) as PaymentStatus,
      });

      await closeLead(leadId, closeStatus, user.$id, user.name, user.role);
      clearLeadReadCache();
      try {
        const firstName =
          typeof leadData.firstName === "string" ? leadData.firstName : "";
        const lastName =
          typeof leadData.lastName === "string" ? leadData.lastName : "";
        const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
        const fallback =
          leadData.legalName ??
          leadData.name ??
          leadData.company ??
          leadData.email ??
          leadData.phone;
        const leadName =
          fullName || (typeof fallback === "string" ? fallback : "");

        await sendChatMessageAction({
          currentUserId: user.$id,
          channel: "general",
          body: leadName
            ? `Congratulations ${user.name} for closing ${leadName}!`
            : `Congratulations ${user.name} for closing a lead!`,
        });
      } catch {}
      toast({
        title: "Success",
        description: "Lead closed successfully",
      });
      setShowCloseDialog(false);
      router.push("/leads");
    } catch (err: unknown) {
      console.error("Error closing lead:", err);
      toast({
        title: "Error",
        description: getErrorMessage(err, "Failed to close lead"),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReopenLead = async () => {
    if (!lead || !user) return;
    if (user.role === "operations") return;
    if (user.role === "monitor" && lead.ownerId !== user.$id) return;

    try {
      setIsSaving(true);
      await reopenLead(leadId, user.$id, user.name);
      toast({
        title: "Success",
        description: "Lead reopened successfully",
      });
      await loadLead();
    } catch (err: unknown) {
      console.error("Error reopening lead:", err);
      toast({
        title: "Error",
        description: getErrorMessage(err, "Failed to reopen lead"),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAssignAgent = async (agentId: string) => {
    if (!lead || !user) return;
    // Agents cannot assign leads — the assignment workflow is controlled by
    // team leads, lead generation, and admins only.
    if (user.role === "operations") return;
    if (user.role === "agent" || user.role === "lead_generation") return;
    if (user.role === "monitor" && lead.ownerId !== user.$id) return;

    try {
      await assignLead(leadId, agentId, user.$id, user.name);
      toast({
        title: "Success",
        description: "Lead assigned successfully",
      });
      await loadLead();
    } catch (err: unknown) {
      console.error("Error assigning lead:", err);
      toast({
        title: "Error",
        description: getErrorMessage(err, "Failed to assign lead"),
        variant: "destructive",
      });
    }
  };

  const handleFieldChange = (key: string, value: LeadDataValue) => {
    const linkedinField = formFields.find(
      (field) => field.key === key && isLinkedinProfileField(field),
    );

    setLeadData((prev) =>
      linkedinField
        ? {
            ...prev,
            [key]: value,
            linkedinProfileUrl:
              typeof value === "string" ? value : String(value ?? ""),
          }
        : { ...prev, [key]: value },
    );

    // Clear any server-side field error when the user edits the input.
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const renderField = (field: FormField) => {
    const value = isLinkedinProfileField(field)
      ? getLinkedinProfileValue(leadData, [field])
      : String(leadData[field.key] ?? "");
    const isReadOnly =
      !isEditing ||
      lead?.isClosed ||
      user?.role === "operations" ||
      (user?.role === "monitor" && lead?.ownerId !== user.$id);
    const fieldError = fieldErrors[field.key];

    switch (field.type) {
      case "textarea":
        return (
          <>
            <textarea
              id={field.key}
              aria-invalid={Boolean(fieldError)}
              className={`w-full min-h-[100px] px-3 py-2 rounded-md border ${
                fieldError ? "border-red-500" : "border-input"
              } bg-background text-foreground`}
              value={value}
              onChange={(e) => handleFieldChange(field.key, e.target.value)}
              disabled={isReadOnly}
              placeholder={field.placeholder}
            />
            {fieldError && (
              <p className="text-sm text-red-500 mt-1">{fieldError}</p>
            )}
          </>
        );

      case "dropdown":
        if (field.key === "status") {
          const savedStatus = lead?.status ?? value;
          const allowed = new Set(
            getLeadEditAllowedStatuses(savedStatus).map(normalizeStatusText),
          );
          const mergedOptions = Array.from(
            new Set([
              ...(field.options ?? []).map((opt) =>
                canonicalizeLeadStatus(opt),
              ),
              ...LEAD_WORKFLOW_STATUSES,
            ]),
          );
          const options =
            value && !mergedOptions.includes(value)
              ? [value, ...mergedOptions]
              : mergedOptions;

          return (
            <>
              <select
                id={field.key}
                aria-invalid={Boolean(fieldError)}
                className={`flex h-10 w-full rounded-md border ${
                  fieldError ? "border-red-500" : "border-input"
                } bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
                value={value}
                onChange={(e) => handleFieldChange(field.key, e.target.value)}
                disabled={isReadOnly}>
                <option value="">Select {field.label}</option>
                {options.map((option) => (
                  <option
                    key={option}
                    value={option}
                    disabled={
                      isEditing &&
                      !lead?.isClosed &&
                      !allowed.has(normalizeStatusText(option))
                    }>
                    {option}
                  </option>
                ))}
              </select>
              {fieldError && (
                <p className="text-sm text-red-500 mt-1">{fieldError}</p>
              )}
            </>
          );
        }
        return (
          <>
            <select
              id={field.key}
              aria-invalid={Boolean(fieldError)}
              className={`flex h-10 w-full rounded-md border ${
                fieldError ? "border-red-500" : "border-input"
              } bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
              value={value}
              onChange={(e) => handleFieldChange(field.key, e.target.value)}
              disabled={isReadOnly}>
              <option value="">Select {field.label}</option>
              {field.options?.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {fieldError && (
              <p className="text-sm text-red-500 mt-1">{fieldError}</p>
            )}
          </>
        );

      default:
        return (
          <>
            <Input
              id={field.key}
              type={field.type}
              value={value}
              onChange={(e) => handleFieldChange(field.key, e.target.value)}
              disabled={isReadOnly}
              placeholder={field.placeholder}
              aria-invalid={Boolean(fieldError)}
              className={fieldError ? "border-red-500" : undefined}
            />
            {fieldError && (
              <p className="text-sm text-red-500 mt-1">{fieldError}</p>
            )}
          </>
        );
    }
  };

  const renderCloseField = (
    field: FormField,
    values: Record<string, unknown>,
    setValues: Dispatch<SetStateAction<Record<string, unknown>>>,
  ) => {
    const rawValue = values[field.key];
    const value =
      rawValue === null || rawValue === undefined
        ? ""
        : typeof rawValue === "string" ||
            typeof rawValue === "number" ||
            typeof rawValue === "boolean"
          ? String(rawValue)
          : Array.isArray(rawValue)
            ? rawValue.map((v) => String(v)).join(", ")
            : JSON.stringify(rawValue);
    const checkedValues = Array.isArray(rawValue)
      ? rawValue.map((v) => String(v))
      : [];

    switch (field.type) {
      case "textarea":
        return (
          <textarea
            id={field.key}
            className="w-full min-h-[100px] px-3 py-2 rounded-md border border-input bg-background text-foreground"
            value={value}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
            }
            placeholder={field.placeholder}
          />
        );

      case "dropdown":
        return (
          <select
            id={field.key}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={value}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
            }>
            <option value="">Select {field.label}</option>
            {field.options?.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        );

      case "checklist":
        return (
          <div className="space-y-2">
            {field.options?.map((option) => (
              <label key={option} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checkedValues.includes(option)}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setValues((prev) => {
                      const currentRaw = prev[field.key];
                      const current = Array.isArray(currentRaw)
                        ? currentRaw.map((v) => String(v))
                        : [];
                      const next = checked
                        ? Array.from(new Set([...current, option]))
                        : current.filter((v) => v !== option);
                      return { ...prev, [field.key]: next };
                    });
                  }}
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        );

      default:
        return (
          <Input
            id={field.key}
            type={field.type}
            value={value}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
            }
            placeholder={field.placeholder}
          />
        );
    }
  };

  if (authLoading || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg">Loading lead...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (error || !lead) {
    return (
      <div className="container mx-auto">
        <Card className="border-red-500">
          <CardHeader>
            <CardTitle className="text-red-500">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p>{error || "Lead not found"}</p>
            <Button onClick={() => router.push("/leads")} className="mt-4">
              Back to Leads
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const leadGenerationVisibleKeys = new Set([
    "firstName",
    "middleName",
    "lastName",
    "email",
    "phone",
    "visaStatus",
    "linkedinProfileUrl",
  ]);

  const isLeadGeneration = user.role === "lead_generation";
  const isMonitor = user.role === "monitor";
  const isOperations = user.role === "operations";
  const isLeadOwner = lead.ownerId === user.$id;
  const canModifyLead = !isOperations && (!isMonitor || isLeadOwner);
  const canAssignLead =
    canModifyLead &&
    Boolean(lead) &&
    (user.role === "team_lead" ||
      user.role === "admin" ||
      user.role === "developer" ||
      user.role === "lead_generation");
  const headerFirstName =
    typeof leadData.firstName === "string" ? leadData.firstName : "";
  const headerLastName =
    typeof leadData.lastName === "string" ? leadData.lastName : "";
  const resumeFileId =
    typeof leadData.resumeFileId === "string" ? leadData.resumeFileId : "";
  const resumeFileName =
    typeof leadData.resumeFileName === "string" ? leadData.resumeFileName : "";

  return (
    <div className="container mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div id="tour-lead-header">
          <Button
            variant="outline"
            onClick={() => router.push("/leads")}
            className="mb-2">
            ← Back to Leads
          </Button>
          <h1 className="text-2xl md:text-3xl font-bold">
            {headerFirstName} {headerLastName}
          </h1>
          <p className="text-muted-foreground mt-1">
            {lead.isClosed ? "Closed Lead" : "Active Lead"}
          </p>
        </div>
        <div id="tour-lead-actions" className="flex flex-wrap gap-2">
          {canModifyLead && !lead.isClosed && (
            <>
              {!isEditing ? (
                <>
                  <Button onClick={() => setIsEditing(true)}>Edit</Button>
                  {(!isLeadGeneration || isLeadOwner) && (
                    <Button
                      variant="destructive"
                      onClick={() => {
                        setCloseStatus(
                          isLinkedinRequestLead(leadData)
                            ? "Signed/Closure"
                            : "Closed",
                        );
                        setShowCloseDialog(true);
                      }}>
                      Close Lead
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? "Saving..." : "Save"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsEditing(false);
                      setLeadData(JSON.parse(lead.data));
                      setFieldErrors({});
                    }}>
                    Cancel
                  </Button>
                </>
              )}
            </>
          )}
          {lead.isClosed &&
            canModifyLead &&
            (isLeadOwner ||
              user?.role === "admin" ||
              user?.role === "team_lead") && (
              <>
                {isBackoutStatus(lead.status) && (
                  <Button
                    variant="destructive"
                    onClick={async () => {
                      if (!user) return;
                      try {
                        setIsSaving(true);
                        await backoutLead(leadId, user.$id, user.name);
                        toast({
                          title: "Success",
                          description: "Backout rules applied",
                        });
                        await loadLead();
                      } catch (err: unknown) {
                        toast({
                          title: "Error",
                          description: getErrorMessage(
                            err,
                            "Failed to apply Backout",
                          ),
                          variant: "destructive",
                        });
                      } finally {
                        setIsSaving(false);
                      }
                    }}
                    disabled={isSaving}>
                    {isSaving ? "Applying..." : "Apply Backout"}
                  </Button>
                )}
                <Button onClick={handleReopenLead} disabled={isSaving}>
                  {isSaving ? "Reopening..." : "Reopen Lead"}
                </Button>
              </>
            )}
        </div>
      </div>

      <div className="grid gap-6">
        {/* Lead Information */}
        <Card id="tour-lead-info">
          <CardHeader>
            <CardTitle>Lead Information</CardTitle>
          </CardHeader>
          <CardContent>
            {isLeadGeneration && (
              <div className="mb-4 flex flex-col gap-1 rounded-md border border-border bg-muted/20 p-3">
                <Label>Source</Label>
                <p className="text-sm text-muted-foreground">LinkedIN/Lead</p>
              </div>
            )}
            {resumeFileId && (
              <div className="mb-4 flex flex-col gap-1 rounded-md border border-border bg-muted/20 p-3">
                <Label>Resume</Label>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-muted-foreground">
                    {resumeFileName || "Resume"}
                  </span>
                  <div className="flex items-center gap-3">
                    <a
                      className="text-sm text-primary hover:underline"
                      href={storage
                        .getFileView(BUCKETS.RESUMES, resumeFileId)
                        .toString()}
                      target="_blank"
                      rel="noreferrer">
                      View
                    </a>
                    <a
                      className="text-sm text-primary hover:underline"
                      href={storage
                        .getFileDownload(BUCKETS.RESUMES, resumeFileId)
                        .toString()}
                      target="_blank"
                      rel="noreferrer">
                      Download
                    </a>
                  </div>
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {withLastNameField(formFields)
                .filter((field) => {
                  if (isLeadGeneration) {
                    return (
                      leadGenerationVisibleKeys.has(field.key) ||
                      isLinkedinProfileField(field)
                    );
                  }
                  return user.role === "admin" || field.visible;
                })
                .map((field) => (
                  <div key={field.id}>
                    <Label htmlFor={field.key}>
                      {field.label}
                      {field.required && (
                        <span className="text-red-500 ml-1">*</span>
                      )}
                    </Label>
                    {renderField(field)}
                  </div>
                ))}
            </div>

            {/* Follow-Up summary — reflects the latest values saved from the Follow-Up Plan card */}
            {!isLeadGeneration && (
              <div className="mt-6 rounded-md border border-border bg-muted/20 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium">Follow-Up</p>
                  <p className="text-xs text-muted-foreground">
                    Updated from Follow-Up Plan
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Next Follow-Up</Label>
                    <p className="text-sm text-muted-foreground">
                      {formatFollowUpDateTime(lead.nextFollowUpAt)}
                    </p>
                  </div>
                  <div>
                    <Label>Next Action</Label>
                    <p className="text-sm text-muted-foreground">
                      {lead.nextAction?.trim() ? lead.nextAction : "—"}
                    </p>
                  </div>
                  <div>
                    <Label>Follow-Up Status</Label>
                    <p className="text-sm text-muted-foreground">
                      {formatFollowUpStatus(lead.followUpStatus)}
                    </p>
                  </div>
                  <div>
                    <Label>Last Contacted</Label>
                    <p className="text-sm text-muted-foreground">
                      {formatFollowUpDateTime(lead.lastContactedAt)}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Assignment Section */}
        {canAssignLead && (
          <Card id="tour-lead-assignment">
            <CardHeader>
              <CardTitle>Assignment</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="assignedTo">
                    {isLeadGeneration ? "Assigned Team Lead" : "Assigned To"}
                  </Label>
                  <select
                    id="assignedTo"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    value={lead.assignedToId || ""}
                    onChange={(e) => handleAssignAgent(e.target.value)}
                    disabled={lead.isClosed}>
                    <option value="">Unassigned</option>
                    {agents.map((agent) => (
                      <option key={agent.$id} value={agent.$id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Status</Label>
                  <p className="text-sm text-muted-foreground mt-2">
                    <span className="inline-block px-3 py-1 rounded-full bg-primary/10 text-primary">
                      {lead.status}
                    </span>
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {!isLeadGeneration && (
          <div id="tour-lead-followup">
            <LeadFollowUpCard
              lead={lead}
              user={user}
              disabled={lead.isClosed || (isMonitor && !isLeadOwner)}
              onUpdated={(updatedLead) => {
                if (updatedLead) {
                  setLead(updatedLead);
                  setLeadData(JSON.parse(updatedLead.data));
                  return;
                }
                return loadLead();
              }}
            />
          </div>
        )}

        {user && (!isMonitor || isLeadOwner) && (
          <div id="tour-lead-notes">
            <LeadNotesCard leadId={lead.$id} user={user} />
          </div>
        )}

        <div id="tour-lead-timeline">
          <LeadActivityTimeline lead={lead} />
        </div>

        {/* Metadata */}
        <Card>
          <CardHeader>
            <CardTitle>Metadata</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <Label>Created</Label>
                <p className="text-muted-foreground">
                  {lead.$createdAt
                    ? new Date(lead.$createdAt).toLocaleString()
                    : "N/A"}
                </p>
              </div>
              <div>
                <Label>Last Updated</Label>
                <p className="text-muted-foreground">
                  {lead.$updatedAt
                    ? new Date(lead.$updatedAt).toLocaleString()
                    : "N/A"}
                </p>
              </div>
              {lead.closedAt && (
                <div>
                  <Label>Closed At</Label>
                  <p className="text-muted-foreground">
                    {new Date(lead.closedAt).toLocaleString()}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Close Lead Dialog */}
      {showCloseDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <Card className="w-full sm:max-w-2xl sm:mx-4 rounded-b-none sm:rounded-b-lg">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-3">
                <span>Close Lead</span>
                <span className="text-sm text-muted-foreground">
                  Step {closeStep} of 3
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {closeStep === 1 && (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Personal Details
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {closureFields
                      .filter((field) => field.visible)
                      .map((field) => (
                        <div key={field.id} className="space-y-2">
                          <Label htmlFor={field.key}>
                            {field.label}
                            {field.required && (
                              <span className="text-red-500 ml-1">*</span>
                            )}
                          </Label>
                          {renderCloseField(
                            field,
                            closureValues,
                            setClosureValues,
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {closeStep === 2 && (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Payment Plan
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {paymentPlanFields
                      .filter((field) => field.visible)
                      .map((field) => (
                        <div key={field.id} className="space-y-2">
                          <Label htmlFor={field.key}>
                            {field.label}
                            {field.required && (
                              <span className="text-red-500 ml-1">*</span>
                            )}
                          </Label>
                          {renderCloseField(
                            field,
                            paymentPlanValues,
                            setPaymentPlanValues,
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {closeStep === 3 && (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Final Status & Confirmation
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="closeStatus">Final Status</Label>
                      <select
                        id="closeStatus"
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        value={closeStatus}
                        onChange={(e) => setCloseStatus(e.target.value)}>
                        {isLinkedinRequestLead(leadData) ? (
                          <>
                            <option value="Signed/Closure">
                              Signed/Closure
                            </option>
                            <option value="Backed Out">Backed Out</option>
                          </>
                        ) : (
                          <>
                            <option value="Closed">Closed</option>
                            <option value="Won">Won</option>
                            <option value="Lost">Lost</option>
                            <option value="Rejected">Rejected</option>
                            <option value="Backed Out">Backed Out</option>
                          </>
                        )}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="initialPaymentStatus">
                        Initial Payment Status
                      </Label>
                      <select
                        id="initialPaymentStatus"
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        value={
                          initialPaymentStatus ||
                          (Number(paymentPlanValues.upfrontAmount) > 0
                            ? "partially_paid"
                            : "not_paid")
                        }
                        onChange={(e) =>
                          setInitialPaymentStatus(e.target.value)
                        }>
                        <option value="not_paid">Not Paid</option>
                        <option value="partially_paid">Partially Paid</option>
                        <option value="fully_paid">Fully Paid</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-6 flex flex-col-reverse sm:flex-row justify-between gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowCloseDialog(false);
                  }}
                  className="w-full sm:w-auto">
                  Cancel
                </Button>
                <div className="flex flex-col-reverse sm:flex-row gap-2">
                  {closeStep > 1 && (
                    <Button
                      variant="outline"
                      onClick={() => setCloseStep((s) => Math.max(1, s - 1))}
                      className="w-full sm:w-auto">
                      Back
                    </Button>
                  )}
                  {closeStep < 3 ? (
                    <Button
                      onClick={() => setCloseStep((s) => Math.min(3, s + 1))}
                      className="w-full sm:w-auto">
                      Next
                    </Button>
                  ) : (
                    <Button
                      onClick={handleCloseLead}
                      disabled={isSaving}
                      variant="destructive"
                      className="w-full sm:w-auto">
                      {isSaving ? "Closing..." : "Close Lead"}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
