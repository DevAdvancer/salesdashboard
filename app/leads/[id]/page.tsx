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
import { getLead, closeLead } from "@/lib/services/lead-service";
import { sendChatMessageAction } from "@/app/actions/chat";
import {
  assignLead,
  backoutLead,
  clearLeadReadCache,
  notInterestedLead,
  reopenLead,
  updateLead,
} from "@/lib/services/lead-action-service";
import {
  getAgentsByManager,
  getAgentsByTeamLead,
} from "@/lib/services/user-service";
import {
  getClosureFormConfig,
  getFormConfig,
  getPaymentPlanFormConfig,
} from "@/lib/services/form-config-service";
import { upsertClientPaymentRecord } from "@/lib/services/client-payment-service";
import { Lead, User, FormField, LeadData, LeadDataValue } from "@/lib/types";
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
} from "@/lib/utils/lead-status-workflow";

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

function isNotInterestedStatus(value: unknown) {
  return normalizeStatusText(value) === "notinterested";
}

function isLinkedinRequestLead(data: LeadData) {
  const requestId = (data as any).linkedinRequestId;
  return typeof requestId === "string" && requestId.trim().length > 0;
}

export default function LeadDetailPage() {
  return (
    <ProtectedRoute componentKey="leads">
      <LeadDetailContent />
    </ProtectedRoute>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
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
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [closeStatus, setCloseStatus] = useState("Closed");
  const [closeStep, setCloseStep] = useState(1);
  const [closureFields, setClosureFields] = useState<FormField[]>([]);
  const [paymentPlanFields, setPaymentPlanFields] = useState<FormField[]>([]);
  const [closureValues, setClosureValues] = useState<Record<string, unknown>>(
    {},
  );
  const [paymentPlanValues, setPaymentPlanValues] = useState<
    Record<string, unknown>
  >({});

  const loadLead = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const fetchedLead = await getLead(leadId);
      setLead(fetchedLead);
      setLeadData(JSON.parse(fetchedLead.data));
    } catch (err: unknown) {
      console.error("Error loading lead:", err);
      setError(getErrorMessage(err, "Failed to load lead"));
    } finally {
      setIsLoading(false);
    }
  }, [leadId]);

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
    if (!user) return;

    try {
      if (user.role !== "manager" && user.role !== "team_lead") return;

      const fetchedAgents =
        user.role === "manager"
          ? await getAgentsByManager(user.$id)
          : await getAgentsByTeamLead(user.$id);
      setAgents(fetchedAgents);
    } catch (err: unknown) {
      console.error("Error loading agents:", err);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
      return;
    }

    if (user && leadId) {
      loadLead();
      loadFormConfig();
      if (user.role === "manager" || user.role === "team_lead") {
        loadAgents();
      }
    }
  }, [user, authLoading, leadId, router, loadLead, loadFormConfig, loadAgents]);

  useEffect(() => {
    if (!showCloseDialog) return;
    setCloseStep(1);
    void loadCloseConfigs();
  }, [showCloseDialog, loadCloseConfigs]);

  const handleSave = async () => {
    if (!lead || !user) return;

    try {
      setIsSaving(true);

      if (!isLeadGeneration && !lead.isClosed) {
        const hasNextFollowUpAt = Boolean(lead.nextFollowUpAt);
        const hasNextAction = Boolean(
          lead.nextAction && String(lead.nextAction).trim(),
        );
        if (!hasNextFollowUpAt || !hasNextAction) {
          toast({
            title: "Follow-up required",
            description:
              "Please fill Next Follow-Up and Next Action in Follow-Up Plan and save it before updating the lead.",
            variant: "destructive",
          });
          return;
        }
      }

      const nextStatus = (leadData as any).status;
      const previousStatus = lead.status;
      const statusChanged =
        normalizeStatusText(nextStatus) &&
        normalizeStatusText(previousStatus) !== normalizeStatusText(nextStatus);

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
      toast({
        title: "Error",
        description: getErrorMessage(err, "Failed to save lead"),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCloseLead = async () => {
    if (!lead || !user) return;

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
        initialStatus: upfrontAmount > 0 ? "partially_paid" : "not_paid",
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
    setLeadData((prev) => ({ ...prev, [key]: value }));
  };

  const renderField = (field: FormField) => {
    const value = String(leadData[field.key] ?? "");
    const isReadOnly = !isEditing || lead?.isClosed;

    switch (field.type) {
      case "textarea":
        return (
          <textarea
            id={field.key}
            className="w-full min-h-[100px] px-3 py-2 rounded-md border border-input bg-background text-foreground"
            value={value}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            disabled={isReadOnly}
            placeholder={field.placeholder}
          />
        );

      case "dropdown":
        if (field.key === "status") {
          const savedStatus = lead?.status ?? value;
          const allowed = new Set(
            getLeadEditAllowedStatuses(savedStatus).map(normalizeStatusText),
          );
          const mergedOptions = Array.from(
            new Set([...(field.options ?? []), ...LEAD_WORKFLOW_STATUSES]),
          );
          const options =
            value && !mergedOptions.includes(value)
              ? [value, ...mergedOptions]
              : mergedOptions;

          return (
            <select
              id={field.key}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
          );
        }
        return (
          <select
            id={field.key}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
        );

      default:
        return (
          <Input
            id={field.key}
            type={field.type}
            value={value}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            disabled={isReadOnly}
            placeholder={field.placeholder}
          />
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
    "linkedinId",
  ]);

  const isLeadGeneration = user.role === "lead_generation";
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
          {!lead.isClosed && (
            <>
              {!isEditing ? (
                <>
                  <Button onClick={() => setIsEditing(true)}>Edit</Button>
                  {!isLeadGeneration && (
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
                    }}>
                    Cancel
                  </Button>
                </>
              )}
            </>
          )}
          {lead.isClosed &&
            (user?.role === "manager" ||
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
              {formFields
                .filter((field) => {
                  if (isLeadGeneration) {
                    return leadGenerationVisibleKeys.has(field.key);
                  }
                  return user.role === "manager" || field.visible;
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
          </CardContent>
        </Card>

        {/* Assignment Section (Manager Only) */}
        {(user?.role === "manager" || user?.role === "team_lead") && (
          <Card id="tour-lead-assignment">
            <CardHeader>
              <CardTitle>Assignment</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="assignedTo">Assigned To</Label>
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
              disabled={lead.isClosed}
              onUpdated={loadLead}
            />
          </div>
        )}

        {user && (
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
                      <Label>Initial Payment Status</Label>
                      <p className="text-sm text-muted-foreground">
                        {Number(paymentPlanValues.upfrontAmount) > 0
                          ? "partially_paid"
                          : "not_paid"}
                      </p>
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
