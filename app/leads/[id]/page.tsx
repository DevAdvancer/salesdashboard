"use client";
import { logger } from '@/lib/utils/logger';

import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useAuth } from "@/lib/contexts/auth-context";
import { useRouter, useParams } from "next/navigation";
import { getLead } from "@/lib/services/lead/queries";
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
  getCachedFormConfigAction,
  getCachedClosureFormConfigAction,
  getCachedPaymentPlanFormConfigAction
} from "@/app/actions/form-config";
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
import {
  shouldRequireLeadFollowUpForStatus,
  isAllowedLeadStatusTransition,
} from "@/lib/utils/lead-status-workflow";
import {
  isLinkedinProfileField,
  getLinkedinProfileValue,
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
import { getLeadAction } from "@/app/actions/lead/queries";

// Extracted components
import { LeadInfoCard } from "@/components/leads/detail/lead-info-card";
import { LeadCloseDialog } from "@/components/leads/detail/lead-close-dialog";
import { LeadMetadataCard } from "@/components/leads/detail/lead-metadata-card";
import { LeadAssignmentCard } from "@/components/leads/detail/lead-assignment-card";
import {
  isBackoutStatus,
  isLinkedinRequestLead,
  isNotInterestedStatus,
  normalizeStatusText,
} from "@/components/leads/detail/lead-detail-utils";

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

  // ---------------------------------------------------------------------------
  // Data loading callbacks
  // ---------------------------------------------------------------------------

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
      logger.error("Error loading lead:", err);
      setError(getErrorMessage(err, "Failed to load lead"));
    } finally {
      setIsLoading(false);
    }
  }, [leadId, user, queryClient]);

  const loadFormConfig = useCallback(async () => {
    try {
      // Default to a fallback array if cached action fails.
      const cachedConfig = await getCachedFormConfigAction().catch(() => ({ fields: [] }));
      const config = cachedConfig as { fields: any[] };
      const fields = config.fields;
      setFormFields(fields.sort((a, b) => a.order - b.order));
    } catch (err: unknown) {
      logger.error("Error loading form config:", err);
    }
  }, []);

  const loadCloseConfigs = useCallback(async () => {
    try {
      const [closureRes, paymentRes] = await Promise.all([
        getCachedClosureFormConfigAction().catch(() => ({ fields: [] })),
        getCachedPaymentPlanFormConfigAction().catch(() => ({ fields: [] })),
      ]);
      const closure = closureRes.fields.sort((a, b) => a.order - b.order);
      const payment = paymentRes.fields.sort((a, b) => a.order - b.order);
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
      logger.error("Error loading close configs:", err);
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
      logger.error("Error loading agents:", err);
    }
  }, [lead, user]);

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

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
      logger.error("Error saving lead:", err);
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
    // missing.
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

      // Payment details are always required to close a lead
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
      const missingAll = [...missingClosure, ...missingPayment];
      if (missingAll.length > 0) {
        toast({
          title: "Missing required fields",
          description: `Please fill: ${missingAll.join(", ")}`,
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
      logger.error("Error closing lead:", err);
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
      logger.error("Error reopening lead:", err);
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
    if (user.role === "operations") return;
    if (user.role === "agent") return;
    if (user.role === "lead_generation" && lead.ownerId !== user.$id) return;
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
      logger.error("Error assigning lead:", err);
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

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

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

  const isLeadGeneration = user.role === "lead_generation";
  const isMonitor = user.role === "monitor";
  const isOperations = user.role === "operations";
  const isLeadOwner = lead.ownerId === user.$id;
  const canModifyLead = !isOperations;

  const rawLeadAmount = getLeadAmountValue(leadData as Record<string, unknown>);
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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="container mx-auto">
      {/* Header + Action Buttons */}
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
        <LeadInfoCard
          lead={lead}
          leadData={leadData}
          setLeadData={setLeadData}
          user={user}
          formFields={formFields}
          isEditing={isEditing}
          fieldErrors={fieldErrors}
          onFieldChange={handleFieldChange}
        />

        {/* Assignment Section */}
        {canAssignLead && (
          <LeadAssignmentCard
            lead={lead}
            user={user}
            assignableAgents={assignableAgents}
            isAssigning={isAssigning}
            onAssign={handleAssignAgent}
          />
        )}

        {/* Follow-Up Card */}
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

        {/* Notes Card */}
        {user && (!isMonitor || isLeadOwner) && (
          <div id="tour-lead-notes">
            <LeadNotesCard leadId={lead.$id} user={user} />
          </div>
        )}

        {/* Activity Timeline */}
        <div id="tour-lead-timeline">
          <LeadActivityTimeline lead={lead} />
        </div>

        {/* Metadata */}
        <LeadMetadataCard lead={lead} metaNames={metaNames} />
      </div>

      {/* Close Lead Dialog */}
      {showCloseDialog && (
        <LeadCloseDialog
          leadData={leadData}
          leadId={leadId}
          userId={user.$id}
          userName={user.name}
          userRole={user.role}
          userDepartment={user.department ?? "sales"}
          closeStep={closeStep}
          setCloseStep={setCloseStep}
          closeStatus={closeStatus}
          setCloseStatus={setCloseStatus}
          initialPaymentStatus={initialPaymentStatus}
          setInitialPaymentStatus={setInitialPaymentStatus}
          closureFields={closureFields}
          paymentPlanFields={paymentPlanFields}
          closureValues={closureValues}
          setClosureValues={setClosureValues}
          paymentPlanValues={paymentPlanValues}
          setPaymentPlanValues={setPaymentPlanValues}
          isSaving={isSaving}
          isCloseRequiredFieldsMissingFlag={isCloseRequiredFieldsMissingFlag}
          missingCloseRequiredFields={missingCloseRequiredFields}
          onClose={() => setShowCloseDialog(false)}
          onConfirmClose={handleCloseLead}
          renderCloseField={renderCloseField}
        />
      )}
    </div>
  );
}
