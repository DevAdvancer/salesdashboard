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
import { getUsersNamesAction } from "@/app/actions/user";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queries/keys";
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
  LEAD_STATUS_SIGNED_CLOSURE,
  LEAD_WORKFLOW_STATUSES,
  MONITOR_ONLY_STATUSES,
  getLeadEditAllowedStatusesForRole,
  isAllowedLeadStatusTransition,
  normalizeLeadStatus,
  canonicalizeLeadStatus,
  shouldRequireLeadFollowUpForStatus,
} from "@/lib/utils/lead-status-workflow";
import {
  getLinkedinProfileValue,
  isLinkedinProfileField,
} from "@/lib/utils/lead-linkedin-field";
import {
  getLeadAmountValue,
  isCloseRequiredFieldsMissing,
  isAmountMissing,
  getMissingCloseRequiredFields,
  isPaymentDetailsMissing,
  getMissingPaymentFields,
} from "@/lib/utils/lead-close-gate";
import { getErrorMessage } from "@/lib/utils";
import { parseLeadActionError } from "@/lib/utils/lead-action-error";
import { shouldShowRequiredAsterisk } from "@/lib/utils/required-lead-fields";

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

// Ensures a "legalName" text field is always present and rendered near the
// top of the Lead Information card. The Close Lead button requires Legal
// Name to be filled, so we must always show it even if the saved form
// config was created before Legal Name was a default field.
function withLegalNameField(fields: FormField[]): FormField[] {
  if (fields.some((f) => f.key === "legalName")) return fields;

  const firstNameField = fields.find((f) => f.key === "firstName");
  const injected: FormField = {
    id: "static-legalname",
    key: "legalName",
    label: "Legal Name",
    type: "text",
    required: true,
    visible: true,
    order: firstNameField ? firstNameField.order + 0.5 : 1.5,
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

// Ensures an "amount" text field is always present so historical leads
// created under the legacy `field_15` key can be edited and migrated. We
// only inject when neither the uniform key nor any legacy alias is
// present in the form config — the new DEFAULT_FIELDS already has
// `amount`, but older Appwrite form_config documents may not.
function withAmountField(fields: FormField[]): FormField[] {
  if (fields.some((f) => f.key === "amount" || f.key === "field_15")) {
    return fields;
  }
  const firstNameField = fields.find((f) => f.key === "firstName");
  const injected: FormField = {
    id: "static-amount",
    key: "amount",
    label: "Amount ($)",
    type: "text",
    required: true,
    visible: true,
    order: firstNameField ? firstNameField.order + 1.5 : 12.5,
  };
  const firstNameIndex = fields.findIndex((f) => f.key === "firstName");
  if (firstNameIndex !== -1) {
    return [
      ...fields.slice(0, firstNameIndex + 1),
      injected,
      ...fields.slice(firstNameIndex + 1),
    ];
  }
  return [...fields, injected];
}

export default function LeadDetailPage() {
  return (
    <ProtectedRoute componentKey="leads">
      <LeadDetailContent />
    </ProtectedRoute>
  );
}

function LeadDetailContent() {
  const { user, loading: authLoading, activeDashboard } = useAuth();
  const router = useRouter();
  const params = useParams();
  const { toast } = useToast();
  const leadId = params.id as string;
  const queryClient = useQueryClient();

  const [lead, setLead] = useState<Lead | null>(null);
  const [leadData, setLeadData] = useState<LeadData>({});
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [agents, setAgents] = useState<User[]>([]);
  const [metaNames, setMetaNames] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // Tracks when the assignment <select> is mid-flight so rapid changes don't
  // fire multiple assignLead() calls before the lead data has been reloaded.
  const [isAssigning, setIsAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [closeStep, setCloseStep] = useState(1);
  const [closeStatus, setCloseStatus] = useState("Won");
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
      // Invalidate React Query cache so we get fresh data
      queryClient.invalidateQueries({ queryKey: queryKeys.leads.detail(leadId) });
      const fetchedLead =
        user.role === "monitor" || user.role === "operations"
          ? await getLeadAction(leadId, user.$id)
          : await getLead(leadId);
      setLead(fetchedLead);
      setLeadData(JSON.parse(fetchedLead.data));
      const idsToFetch = [fetchedLead.ownerId];
      if (fetchedLead.assignedToId) idsToFetch.push(fetchedLead.assignedToId);
      const names = await getUsersNamesAction(idsToFetch);
      setMetaNames(names);
    } catch (err: unknown) {
      console.error("Error loading lead:", err);
      setError(getErrorMessage(err, "Failed to load lead"));
    } finally {
      setIsLoading(false);
    }
  }, [leadId, user, queryClient]);

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
          "sales",
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
    // Note: `loadAgents` intentionally omitted from deps — it depends on
    // `lead`, and including it here would re-fire `loadLead()` every
    // time `loadAgents` is recreated (i.e. after `setLead`), creating
    // an infinite fetch loop. Agents are loaded in a separate effect
    // below once the lead has actually been resolved.
  }, [user, authLoading, leadId, router, loadLead, loadFormConfig]);

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
        !isAllowedLeadStatusTransition(previousStatus, nextStatus, user?.role)
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
        queryClient.invalidateQueries({ queryKey: queryKeys.leads.all });
        queryClient.invalidateQueries({ queryKey: ['assigned-report'] });
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
        queryClient.invalidateQueries({ queryKey: queryKeys.leads.all });
        queryClient.invalidateQueries({ queryKey: ['assigned-report'] });
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
        queryClient.invalidateQueries({ queryKey: queryKeys.leads.all });
        queryClient.invalidateQueries({ queryKey: ['assigned-report'] });
        await loadLead();
        router.push("/leads");
        return;
      }
      clearLeadReadCache();
      toast({
        title: "Success",
        description: "Lead updated successfully",
      });
      setIsEditing(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.leads.all });
      queryClient.invalidateQueries({ queryKey: ['assigned-report'] });
      await loadLead();
    } catch (err: unknown) {
      console.error("Error saving lead:", err);
      const parsed = parseLeadActionError(err);
      if (parsed && parsed.code === "MISSING_REQUIRED_FIELD") {
        const missingFields = (
          parsed.meta as { missingFields?: Array<{ key: string; label: string }> } | undefined
        )?.missingFields;
        if (missingFields && missingFields.length > 1) {
          const labels = missingFields.map((m) => m.label);
          setFieldErrors((prev) => {
            const next = { ...prev };
            for (const m of missingFields) {
              next[m.key] = `${m.label} is required.`;
            }
            return next;
          });
          toast({
            title: "Missing required fields",
            description: `Please fill: ${labels.join(", ")}.`,
            variant: "destructive",
          });
          return;
        }
        if (parsed.field) {
          setFieldErrors((prev) => ({ ...prev, [parsed.field!]: parsed.message }));
          return;
        }
      }
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

    // Safety net: don't allow closing (except for Backout) when any of
    // the required close-time fields (Amount, LastName, Legal Name) is
    // missing. The Close Lead button is already disabled, but block this
    // path too in case the dialog is opened by another flow.
    if (!isBackoutStatus(closeStatus)) {
      const missing = getMissingCloseRequiredFields(
        leadData as Record<string, unknown>,
      );
      if (missing.length > 0) {
        toast({
          title: "Required fields missing",
          description: `Fill ${missing.join(
            ", ",
          )} before closing the lead. N/A, blank, or whitespace is not accepted.`,
          variant: "destructive",
        });
        return;
      }
    }

    try {
      setIsSaving(true);
      if (isBackoutStatus(closeStatus)) {
        await backoutLead(leadId, user.$id, user.name);
        toast({
          title: "Success",
          description: "Lead marked as Backout",
        });
        setShowCloseDialog(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.leads.all });
        queryClient.invalidateQueries({ queryKey: ['assigned-report'] });
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
          if (field.key === "paymentMonths" && values.paymentPercent === "H1B Agreement") {
            continue;
          }
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

      // Payment details are always required to close a lead, regardless of
      // the field's `required` flag in the form config — even admin/developer/
      // monitor cannot bypass this. Backout is exempt.
      const paymentPlanMissing = getMissingPaymentFields(
        paymentPlanValues,
        closeStatus,
      );
      if (isPaymentDetailsMissing(paymentPlanValues, closeStatus)) {
        toast({
          title: "Payment details required",
          description: "Fill in Payment Percentage and Payment Months before closing the lead.",
          variant: "destructive",
        });
        return;
      }

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

      const isH1B = paymentPlanValues.paymentPercent === "H1B Agreement";
      const percent = isH1B ? 0 : Number(paymentPlanValues.paymentPercent);
      const months = isH1B ? 0 : Number(paymentPlanValues.paymentMonths);
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
          // Lead-closure celebration is a sales-only flow; the closed lead
          // goes to the user's pinned department chat. Defaulting to
          // "sales" covers the very first run before the user doc has a
          // department attribute (backfill script sets it for everyone).
          department: user.department ?? "sales",
          body: leadName
            ? `Congratulations ${user.name} for closing ${leadName}!`
            : `Congratulations ${user.name} for closing a lead!`,
        });
      } catch {}
      clearLeadReadCache();
      toast({
        title: "Success",
        description: "Lead closed successfully",
      });
      setShowCloseDialog(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.leads.all });
      queryClient.invalidateQueries({ queryKey: ['assigned-report'] });
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

    try {
      setIsSaving(true);
      await reopenLead(leadId, user.$id, user.name);
      toast({
        title: "Success",
        description: "Lead reopened successfully",
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.leads.all });
      queryClient.invalidateQueries({ queryKey: ['assigned-report'] });
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
    // team leads, lead generation, and admins only. Lead generation may
    // assign any of their own leads to any team lead.
    if (user.role === "operations") return;
    if (user.role === "agent") return;
    if (user.role === "lead_generation" && lead.ownerId !== user.$id) return;
    // Single-click guard: the assignment <select> fires onChange synchronously
    // and re-fires on every keystroke when the user reopens it; coalesce
    // concurrent calls so only one assignLead() request goes out at a time.
    if (isAssigning) return;
    setIsAssigning(true);
    try {
      await assignLead(leadId, agentId, user.$id, user.name);
      toast({
        title: "Success",
        description: "Lead assigned successfully",
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.leads.all });
      queryClient.invalidateQueries({ queryKey: ['assigned-report'] });
      await loadLead();
    } catch (err: unknown) {
      console.error("Error assigning lead:", err);
      toast({
        title: "Error",
        description: getErrorMessage(err, "Failed to assign lead"),
        variant: "destructive",
      });
    } finally {
      setIsAssigning(false);
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
    // Monitors are leadership-level observers and may edit any lead they
    // can view (mirrors the server-side `assertLeadUpdateAllowed` policy
    // in app/actions/lead.ts). Operations is read-only.
    const isReadOnly =
      !isEditing || lead?.isClosed || user?.role === "operations";
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
          const isMonitor = user?.role === "monitor";
          const allowed = new Set(
            getLeadEditAllowedStatusesForRole(
              savedStatus,
              user?.role,
            ).map(normalizeStatusText),
          );
          // Monitor users get the LinkedIn and Leads statuses in addition
          // to the standard workflow. Other roles must never see them.
          const roleScopedOptions = isMonitor
            ? [...LEAD_WORKFLOW_STATUSES, ...MONITOR_ONLY_STATUSES]
            : LEAD_WORKFLOW_STATUSES;
          const mergedOptions = Array.from(
            new Set([
              ...(field.options ?? []).map((opt) =>
                canonicalizeLeadStatus(opt),
              ),
              ...roleScopedOptions,
            ]),
          );
          const rawOptions =
            value && !mergedOptions.includes(value)
              ? [value, ...mergedOptions]
              : mergedOptions;
          const options = rawOptions.filter((opt) => {
            const clean = opt.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
            return (
              clean !== "signed" &&
              clean !== "closure" &&
              clean !== "signedclosure" &&
              canonicalizeLeadStatus(opt) !== LEAD_STATUS_SIGNED_CLOSURE
            );
          });

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
        // Inline "missing" message for fields that gate the Close button.
        // We only show this when the lead is open and not in backout
        // status — closed leads don't need to be edited, and backout
        // bypasses the close-time gate entirely.
        const isCloseRequiredField =
          field.key === "lastName" || field.key === "legalName";
        const strValue = String(value || "").trim().toLowerCase();
        const isMissingValue = strValue === "" || strValue === "n/a" || strValue === "na";
        const isCloseRequiredFieldMissing =
          isCloseRequiredField && Boolean(lead && !lead.isClosed) && isMissingValue;
        return (
          <>
            <Input
              id={field.key}
              type={field.type}
              value={value}
              onChange={(e) => handleFieldChange(field.key, e.target.value)}
              disabled={isReadOnly}
              placeholder={field.placeholder}
              aria-invalid={Boolean(fieldError) || isCloseRequiredFieldMissing}
              className={
                fieldError || isCloseRequiredFieldMissing
                  ? "border-red-500"
                  : undefined
              }
            />
            {fieldError && (
              <p className="text-sm text-red-500 mt-1">{fieldError}</p>
            )}
            {isCloseRequiredFieldMissing && (
              <p className="text-sm text-red-500 mt-1">
                {field.label} is required before the lead can be closed. N/A,
                blank, or whitespace is not accepted.
              </p>
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
            className="w-full min-h-[100px] pl-3 pr-8 py-2 rounded-md border border-input bg-background text-foreground"
            value={value}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
            }
            placeholder={field.placeholder}
          />
        );

      case "dropdown": {
        const options = field.key === "paymentPercent"
          ? Array.from(new Set([...(field.options ?? []), "H1B Agreement"]))
          : (field.options ?? []);
        return (
          <select
            id={field.key}
            className="flex h-10 w-full rounded-md border border-input bg-background pl-3 pr-8 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={value}
            onChange={(e) => {
              const val = e.target.value;
              setValues((prev) => {
                const next = { ...prev, [field.key]: val };
                if (field.key === "paymentPercent" && val === "H1B Agreement") {
                  next.paymentMonths = "0";
                }
                return next;
              });
            }}
          >
            <option value="">Select {field.label}</option>
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        );
      }

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
  // Per-lead gating for the Edit / Close Lead / Reopen buttons. Operations
  // is read-only and never gets these affordances. Admin, developer, and
  // team_lead can close leads; monitor cannot close but can reopen. The
  // server enforces the per-role permission rules
  // (see `assertLeadUpdateAllowed` / `assertLeadReopenAllowed` /
  // `closeLeadAction` in app/actions/lead.ts and lib/actions/lead-actions.ts).
  const canModifyLead = !isOperations;
  // Read the current lead-amount value from the lead's parsed `data` JSON.
  // The Amount key was previously `leadAmount` (still recognized as a
  // legacy alias by the payments report) and is now the uniform `amount`
  // key. We also accept `field_15` from the older form-config so historical
  // leads count as having a real Amount. Anything blank, whitespace-only,
  // "N/A", or unparseable is treated as missing — closing a lead for $0
  // or with no value is not a real closure.
  const rawLeadAmount = getLeadAmountValue(leadData as Record<string, unknown>);
  const isLeadAmountMissing = isAmountMissing(rawLeadAmount);
  // Close button gate: Amount + LastName + Legal Name all required.
  // Backout is exempt (a backout means the lead is being abandoned, not
  // closed, so those fields are not expected to be filled).
  const isCloseRequiredFieldsMissingFlag = isCloseRequiredFieldsMissing({
    isClosed: lead.isClosed,
    closeStatus,
    leadData: leadData as Record<string, unknown>,
    isBackoutStatus,
  });
  const missingCloseRequiredFields = isCloseRequiredFieldsMissingFlag
    ? getMissingCloseRequiredFields(leadData as Record<string, unknown>)
    : [];
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

  // When admin is viewing leads from the Resume CRM, the assign-leads
  // dropdown should only show people who can actually work this lead —
  // Resume-team agents (and the leadership roles that can switch
  // dashboards). Sales-team agents are filtered out so an admin can't
  // accidentally cross-assign a Resume lead to a Sales agent.
  const isResumeLeadership = (role?: string) =>
    role === "admin" ||
    role === "developer" ||
    role === "monitor" ||
    role === "operations";
  const assignableAgents =
    activeDashboard === "resume"
      ? agents.filter(
          (a) => (a.department ?? "sales") === "resume" || isResumeLeadership(a.role),
        )
      : agents;

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
                            : "Won",
                        );
                        setShowCloseDialog(true);
                      }}
                      disabled={isCloseRequiredFieldsMissingFlag}
                      title={
                        isCloseRequiredFieldsMissingFlag
                          ? `Fill ${missingCloseRequiredFields.join(
                              ", ",
                            )} in the form above before closing the lead. N/A, blank, or whitespace is not accepted.`
                          : undefined
                      }>
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
              user?.role === "developer" ||
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
              {withAmountField(withLegalNameField(withLastNameField(formFields)))
                .filter((field) => {
                  // The static "Total Amount to be Paid" input below is
                  // the canonical editor for Amount. Skip the dynamic
                  // `amount` row (and the legacy `field_15` alias) so we
                  // don't render two Amount inputs on the same page.
                  if (field.key === "amount" || field.key === "field_15") {
                    return false;
                  }
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
                      {shouldShowRequiredAsterisk(field.key, field.required) && (
                        <span className="text-red-500 ml-1">*</span>
                      )}
                    </Label>
                    {renderField(field)}
                  </div>
                ))}
              <div>
                <Label htmlFor="leadAmount">
                  Total Amount to be Paid
                  <span className="text-red-500 ml-1" aria-label="required">
                    *
                  </span>
                </Label>
                <Input
                  id="leadAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    typeof rawLeadAmount === "number" ||
                    typeof rawLeadAmount === "string"
                      ? String(rawLeadAmount)
                      : ""
                  }
                  onChange={(e) =>
                    setLeadData((prev) => {
                      const next: LeadData = {
                        ...prev,
                        amount: e.target.value,
                      };
                      // Mirror to `leadAmount` so the payments report
                      // (which reads `leadAmount` first) keeps working
                      // for any historical reads that haven't migrated.
                      next.leadAmount = e.target.value;
                      return next;
                    })
                  }
                  placeholder="0.00"
                  disabled={
                    !isEditing ||
                    lead?.isClosed ||
                    user?.role === "operations"
                  }
                  aria-required="true"
                  aria-invalid={isLeadAmountMissing}
                  className={isLeadAmountMissing ? "border-red-500" : undefined}
                />
                {isLeadAmountMissing && (
                  <p className="mt-1 text-xs text-red-500">
                    Total Amount to be Paid is required before the lead can be
                    closed. N/A, blank, or whitespace is not accepted. (The
                    upfront value entered under Payments is the portion that
                    has already been collected.)
                  </p>
                )}
                {!isLeadAmountMissing &&
                  typeof rawLeadAmount === "string" &&
                  rawLeadAmount.trim() &&
                  leadData.amount === undefined &&
                  (leadData as Record<string, unknown>).field_15 !==
                    undefined && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Showing a legacy value. Save the lead to migrate it to
                      the new field.
                    </p>
                  )}
              </div>
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
                    className="flex h-10 w-full rounded-md border border-input bg-background pl-3 pr-8 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    value={lead.assignedToId || ""}
                    onChange={(e) => handleAssignAgent(e.target.value)}
                    disabled={lead.isClosed || isAssigning}>
                    {assignableAgents.map((agent) => (
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
              <div>
                <Label>Owner</Label>
                <p className="text-muted-foreground">
                  {metaNames[lead.ownerId] || "Unknown"}
                </p>
              </div>
              <div>
                <Label>Assigned To</Label>
                <p className="text-muted-foreground">
                  {lead.assignedToId ? (metaNames[lead.assignedToId] || "Unknown") : "Unassigned"}
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
                      .filter((field) => {
                        if (!field.visible) return false;
                        if (field.key === "paymentMonths" && paymentPlanValues.paymentPercent === "H1B Agreement") {
                          return false;
                        }
                        return true;
                      })
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
                        className="flex h-10 w-full rounded-md border border-input bg-background pl-3 pr-8 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        value={closeStatus}
                        onChange={(e) => setCloseStatus(e.target.value)}>
                        {isLinkedinRequestLead(leadData) ? (
                          <>
                            <option value="Signed/Closure">
                              Signed/Closure
                            </option>
                          </>
                        ) : (
                          <>
                            <option value="Won">Won</option>
                            <option value="Lost">Lost</option>
                            <option value="Rejected">Rejected</option>
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
                        className="flex h-10 w-full rounded-md border border-input bg-background pl-3 pr-8 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                      disabled={
                        isSaving ||
                        (!isBackoutStatus(closeStatus) &&
                          isCloseRequiredFieldsMissingFlag)
                      }
                      title={
                        !isBackoutStatus(closeStatus) &&
                        isCloseRequiredFieldsMissingFlag
                          ? `Fill ${missingCloseRequiredFields.join(
                              ", ",
                            )} in the lead form before closing. N/A, blank, or whitespace is not accepted.`
                          : undefined
                      }
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
