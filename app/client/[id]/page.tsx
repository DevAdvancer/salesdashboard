"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/contexts/auth-context";
import { useRouter, useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queries/keys";
import { getLead } from "@/lib/services/lead/queries";
import { reopenLead } from "@/lib/services/lead-action-service";
import { getUserByIdOrNull } from "@/lib/services/user-service";
import { User } from "@/lib/types";
import {
  getClosureFormConfig,
  getPaymentPlanFormConfig,
  getClientIntakeFormConfig,
} from "@/lib/services/form-config-service";
import { getCachedFormConfigAction } from "@/app/actions/form-config";
import {
  getClientPaymentRecord,
  upsertClientPaymentRecord,
  updateClientPersonalDetails,
} from "@/lib/services/client-payment-service";
import {
  Lead,
  FormField,
  LeadData,
  ClientPaymentRecord,
  PaymentStatus,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { ProtectedRoute } from "@/components/protected-route";
import { LeadActivityTimeline } from "@/components/leads/lead-activity-timeline";
import { LeadNotesCard } from "@/components/leads/lead-notes-card";
import { LeadMetadataCard } from "@/components/leads/detail/lead-metadata-card";
import { isClientExcludedStatus } from "@/lib/utils/client-history";

// Extracted Components
import { withLastNameField, getLeadAmount } from "@/components/client/detail/client-detail-utils";
import { ClientGeneralCard } from "@/components/client/detail/client-general-card";
import { ClientDetailCard } from "@/components/client/detail/client-detail-card";
import { ClientPaymentCreateCard } from "@/components/client/detail/client-payment-create-card";
import { ClientIntakeCard } from "@/components/client/detail/client-intake-card";
import { ClientPaymentTimelineCard } from "@/components/client/detail/client-payment-timeline-card";
import { logger } from '@/lib/utils/logger';

export default function HistoryDetailPage() {
  return (
    <ProtectedRoute componentKey="history">
      <HistoryDetailContent />
    </ProtectedRoute>
  );
}

function HistoryDetailContent() {
  const {
    user,
    loading: authLoading,
    isAdmin,
    isTeamLead,
    isMonitor,
  } = useAuth();
  const router = useRouter();
  const params = useParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const leadId = params.id as string;

  const [lead, setLead] = useState<Lead | null>(null);
  const [leadData, setLeadData] = useState<LeadData>({});
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isReopening, setIsReopening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReopenDialog, setShowReopenDialog] = useState(false);
  const [owner, setOwner] = useState<User | null>(null);
  const [assignedTo, setAssignedTo] = useState<User | null>(null);
  const [closureFields, setClosureFields] = useState<FormField[]>([]);
  const [paymentPlanFields, setPaymentPlanFields] = useState<FormField[]>([]);
  const [clientIntakeFields, setClientIntakeFields] = useState<FormField[]>([]);
  const [paymentRecord, setPaymentRecord] =
    useState<ClientPaymentRecord | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentInitSaving, setPaymentInitSaving] = useState(false);
  const [paymentInitPlanValues, setPaymentInitPlanValues] = useState<
    Record<string, unknown>
  >({});
  const [paymentInitPersonalValues, setPaymentInitPersonalValues] = useState<
    Record<string, unknown>
  >({});
  const [clientIntakeValues, setClientIntakeValues] = useState<
    Record<string, unknown>
  >({});
  const [clientIntakeSaving, setClientIntakeSaving] = useState(false);
  const [
    clientIntakeInitializedForRecord,
    setClientIntakeInitializedForRecord,
  ] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
      return;
    }

    if (user && leadId) {
      loadLead();
      loadFormConfig();
      loadPayment();
      loadCloseConfigs();
      loadClientIntakeConfig();
    }
  }, [user, authLoading, leadId, router]);

  const loadLead = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const fetchedLead = await getLead(leadId);

      // Verify this is a closed lead
      if (!fetchedLead.isClosed) {
        router.push(`/leads/${leadId}`);
        return;
      }
      if (isClientExcludedStatus(fetchedLead.status)) {
        router.push(`/leads/${leadId}`);
        return;
      }

      setLead(fetchedLead);
      setLeadData(JSON.parse(fetchedLead.data));

      try {
        const [ownerUser, assignedUser] = await Promise.all([
          getUserByIdOrNull(fetchedLead.ownerId),
          fetchedLead.assignedToId
            ? getUserByIdOrNull(fetchedLead.assignedToId)
            : Promise.resolve(null),
        ]);

        setOwner(ownerUser);
        setAssignedTo(assignedUser);
      } catch (err: unknown) {
        logger.error("Error loading related users:", err);
      }
    } catch (err: unknown) {
      logger.error("Error loading lead:", err);
      setError(err instanceof Error ? err.message : "Failed to load lead");
    } finally {
      setIsLoading(false);
    }
  };

  const loadFormConfig = async () => {
    try {
      // Default to a fallback array if cached action fails.
      const cachedConfig = await getCachedFormConfigAction().catch(() => ({ fields: [] }));
      const config = cachedConfig as { fields: any[] };
      setFormFields(config.fields.sort((a, b) => a.order - b.order));
    } catch (err: unknown) {
      logger.error("Error loading form config:", err);
    }
  };

  const loadCloseConfigs = async () => {
    try {
      const [closureConfig, paymentConfig] = await Promise.all([
        getClosureFormConfig(),
        getPaymentPlanFormConfig(),
      ]);
      setClosureFields(closureConfig.fields.sort((a, b) => a.order - b.order));
      setPaymentPlanFields(
        paymentConfig.fields.sort((a, b) => a.order - b.order),
      );
    } catch (err: unknown) {
      logger.error("Error loading close configs:", err);
    }
  };

  const loadClientIntakeConfig = async () => {
    try {
      const config = await getClientIntakeFormConfig();
      setClientIntakeFields(config.fields.sort((a, b) => a.order - b.order));
    } catch (err: unknown) {
      logger.error("Error loading client intake config:", err);
    }
  };

  const handlePaymentInitPlanChange = (key: string, value: unknown) => {
    setPaymentInitPlanValues((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "paymentPercent" && value === "H1B Agreement") {
        next.paymentMonths = "0";
      }
      return next;
    });
  };

  const handlePaymentInitPersonalChange = (key: string, value: unknown) => {
    setPaymentInitPersonalValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleCreatePaymentRecord = async () => {
    if (!user) return;
    if (!canEditClientPayments) return;

    const isH1B = paymentInitPlanValues.paymentPercent === "H1B Agreement";
    const percent = isH1B ? 0 : Number(paymentInitPlanValues.paymentPercent);
    const months = isH1B ? 0 : Number(paymentInitPlanValues.paymentMonths);
    const upfrontAmount = Number(paymentInitPlanValues.upfrontAmount);

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

    try {
      setPaymentInitSaving(true);
      const created = await upsertClientPaymentRecord({
        actorId: user.$id,
        leadId,
        personalDetails: paymentInitPersonalValues,
        paymentPlan: { percent, months, upfrontAmount },
        initialStatus: upfrontAmount > 0 ? "partially_paid" : "not_paid",
      });
      setPaymentRecord(created);
      toast({ title: "Success", description: "Payment record created." });
    } catch (err: unknown) {
      logger.error("Error creating payment record:", err);
      toast({
        title: "Error",
        description:
          err instanceof Error
            ? err.message
            : "Failed to create payment record",
        variant: "destructive",
      });
    } finally {
      setPaymentInitSaving(false);
    }
  };

  const loadPayment = async () => {
    if (!user) return;
    try {
      setPaymentLoading(true);
      const record = await getClientPaymentRecord(user.$id, leadId);
      setPaymentRecord(record);
      if (record) {
      }
      setClientIntakeInitializedForRecord(null);
      if (!record) {
        setPaymentInitPlanValues({});
        setPaymentInitPersonalValues({});
      }
    } catch (err: unknown) {
      logger.error("Error loading payment record:", err);
      setPaymentRecord(null);
    } finally {
      setPaymentLoading(false);
    }
  };

  useEffect(() => {
    if (!paymentRecord) return;
    if (clientIntakeInitializedForRecord === paymentRecord.$id) return;

    const firstName =
      typeof leadData.firstName === "string" ? leadData.firstName.trim() : "";
    const lastName =
      typeof leadData.lastName === "string" ? leadData.lastName.trim() : "";
    const fallbackName =
      typeof leadData.legalName === "string" ? leadData.legalName.trim() : "";
    const fullName =
      [firstName, lastName].filter(Boolean).join(" ").trim() || fallbackName;

    const salesperson = assignedTo?.name || owner?.name || "";

    const stored = paymentRecord.personalDetails ?? {};
    const next: Record<string, unknown> = { ...stored };

    if (!next.salesperson) next.salesperson = salesperson;
    if (!next.fullName) next.fullName = fullName;
    if (!next.visaStatus)
      next.visaStatus =
        typeof leadData.visaStatus === "string" ? leadData.visaStatus : "";
    if (!next.email)
      next.email = typeof leadData.email === "string" ? leadData.email : "";
    if (!next.phone)
      next.phone = typeof leadData.phone === "string" ? leadData.phone : "";
    if (!next.linkedinProfileUrl) {
      next.linkedinProfileUrl =
        typeof (leadData as any).linkedinProfileUrl === "string"
          ? (leadData as any).linkedinProfileUrl
          : "";
    }
    // Pre-fill the Upfront field from the lead's quoted amount when the
    // personal-details record doesn't already have a value saved. The
    // agent can override this before saving — the saved value wins on
    // subsequent loads. This is a one-time default, not a live sync:
    // changes to `leadData.amount` after the form has been opened do not
    // overwrite what the agent has already typed.
    if (!next.upfront) {
      const leadAmount = getLeadAmount(leadData);
      if (leadAmount) next.upfront = leadAmount;
    }

    setClientIntakeValues(next);
    setClientIntakeInitializedForRecord(paymentRecord.$id);
  }, [
    paymentRecord,
    leadData,
    assignedTo,
    owner,
    clientIntakeInitializedForRecord,
  ]);

  // Keep `agreement` in sync with the latest payment plan (it's a
  // description of the plan, not a free-text field). `upfront` is
  // user-entered (pre-filled once on first render from the lead's
  // amount; see the init effect above) and intentionally decoupled from
  // `paymentRecord.paymentPlan.upfrontAmount`, so we don't overwrite it
  // when the payment plan changes. Whatever the agent typed in this
  // field on the previous save stays as the starting value.
  useEffect(() => {
    if (!paymentRecord) return;
    const derivedAgreement = paymentRecord.paymentPlan.percent === 0
      ? "H1B Agreement"
      : `${paymentRecord.paymentPlan.percent}% in ${paymentRecord.paymentPlan.months} Months`;
    setClientIntakeValues((prev) => {
      if (prev.agreement === derivedAgreement) {
        return prev;
      }
      return { ...prev, agreement: derivedAgreement };
    });
  }, [paymentRecord]);

  // When there's no payment record yet, pre-fill the plan's upfrontAmount
  // from the lead's quoted amount so the agent doesn't have to retype it.
  // We only seed when the field is currently empty so the agent can clear
  // it back out and we won't fight them. After the first payment record
  // exists, this effect is a no-op (paymentRecord !== null) and the
  // saved `paymentPlan.upfrontAmount` becomes the source of truth.
  useEffect(() => {
    if (paymentRecord) return;
    const leadAmount = getLeadAmount(leadData);
    if (!leadAmount) return;
    setPaymentInitPlanValues((prev) => {
      if (prev.upfrontAmount) return prev;
      return { ...prev, upfrontAmount: leadAmount };
    });
  }, [paymentRecord, leadData]);

  const isLeadOwner = lead?.ownerId === user?.$id;
  const canModifyLead = user?.role !== "operations";
  const canReopen =
    canModifyLead &&
    (user?.role === "admin" ||
      user?.role === "developer" ||
      user?.role === "team_lead");
  // Server actions in `app/actions/client-payments.ts` allow monitor and
  // admin-like roles to mutate client payments. Keeping the UI in sync so
  // monitor can edit status, notes, amounts, and the upfront / plan fields.
  const canEditClientPayments = true;

  const handleReopenLead = async () => {
    if (!lead || !canReopen || !user) return;

    try {
      setIsReopening(true);
      await reopenLead(leadId, user.$id, user.name);
      toast({
        title: "Success",
        description: "Lead reopened successfully",
      });
      setShowReopenDialog(false);
      router.push(`/leads/${leadId}`);
    } catch (err: unknown) {
      logger.error("Error reopening lead:", err);
      toast({
        title: "Error",
        description:
          err instanceof Error ? err.message : "Failed to reopen lead",
        variant: "destructive",
      });
    } finally {
      setIsReopening(false);
    }
  };

  const handleClientIntakeChange = (key: string, value: unknown) => {
    setClientIntakeValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveClientIntake = async () => {
    if (!user) return;
    if (!canEditClientPayments) return;
    if (!paymentRecord) return;

    if (
      paymentRecord.status !== "fully_paid" &&
      paymentRecord.status !== "partially_paid"
    ) {
      toast({
        title: "Payment not completed",
        description:
          "Client details can be completed only after payment status is Partially or Fully Paid.",
        variant: "destructive",
      });
      return;
    }

    const derivedSalesperson = assignedTo?.name || owner?.name || "";
    const derivedAgreement = paymentRecord.paymentPlan.percent === 0
      ? "H1B Agreement"
      : `${paymentRecord.paymentPlan.percent}% in ${paymentRecord.paymentPlan.months} Months`;

    // Admin and TL can override the derived agreement with their edit.
    // For other roles, always re-derive the agreement from the live
    // payment plan. `upfront` is user-entered (pre-filled from the
    // lead's `amount` field on first render; the agent can override
    // before saving) and is no longer auto-derived from the payment
    // plan — we just take whatever the user typed in the form.
    const canOverrideAgreement = isAdmin || isTeamLead;
    const editedAgreement =
      typeof clientIntakeValues.agreement === "string"
        ? clientIntakeValues.agreement.trim()
        : "";
    const editedUpfront =
      typeof clientIntakeValues.upfront === "string"
        ? clientIntakeValues.upfront.trim()
        : "";
    const finalAgreement =
      canOverrideAgreement && editedAgreement
        ? editedAgreement
        : derivedAgreement;

    const merged: Record<string, unknown> = {
      ...(paymentRecord.personalDetails ?? {}),
      ...clientIntakeValues,
      salesperson: derivedSalesperson,
      agreement: finalAgreement,
      // Persist the user-entered value as-is (including empty string when
      // the user cleared the field). The required-field validation below
      // will block the save if it's empty for a new record.
      upfront: editedUpfront,
    };

    const missing: string[] = [];
    for (const field of clientIntakeFields) {
      if (!field.visible || !field.required) continue;
      const raw = merged[field.key];
      if (field.type === "checklist") {
        if (!Array.isArray(raw) || raw.length === 0) missing.push(field.label);
        continue;
      }
      const text =
        typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
      if (!text) missing.push(field.label);
    }

    if (missing.length > 0) {
      toast({
        title: "Missing required fields",
        description: `Please fill: ${missing.join(", ")}`,
        variant: "destructive",
      });
      return;
    }

    try {
      setClientIntakeSaving(true);
      const updated = await updateClientPersonalDetails({
        actorId: user.$id,
        leadId,
        personalDetails: merged,
      });
      setPaymentRecord(updated);
      setClientIntakeValues(updated.personalDetails ?? {});
      toast({ title: "Success", description: "Client details saved." });
      queryClient.invalidateQueries({ queryKey: queryKeys.leads.all });
    } catch (err: unknown) {
      logger.error("Error saving client intake:", err);
      toast({
        title: "Error",
        description:
          err instanceof Error ? err.message : "Failed to save client details",
        variant: "destructive",
      });
    } finally {
      setClientIntakeSaving(false);
    }
  };


  if (authLoading || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg text-muted-foreground">
          Loading client details...
        </p>
      </div>
    );
  }

  if (error || !lead) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <p className="text-lg text-destructive mb-4">
          {error || "Lead not found or not in a client status"}
        </p>
        <Button onClick={() => router.push("/leads")}>Back to Leads</Button>
      </div>
    );
  }

  const enhancedFormFields = withLastNameField(formFields);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Client History</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Closed Lead • {String(leadData.firstName || "")} {String(leadData.lastName || "")}
            {leadData.company ? ` • ${String(leadData.company)}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          {canReopen && (
            <Button
              variant="outline"
              onClick={() => setShowReopenDialog(true)}>
              Reopen Lead
            </Button>
          )}
          <Button variant="outline" onClick={() => router.push("/client")}>
            Back to Clients
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <ClientGeneralCard formFields={enhancedFormFields} leadData={leadData} />
          <ClientDetailCard closureFields={closureFields} leadData={leadData} />

          {paymentLoading ? (
            <div className="flex items-center justify-center p-8 border rounded-lg bg-card">
              <p className="text-muted-foreground">Loading payment details...</p>
            </div>
          ) : !paymentRecord ? (
            <ClientPaymentCreateCard
              paymentInitPlanValues={paymentInitPlanValues}
              handlePaymentInitPlanChange={handlePaymentInitPlanChange}
              paymentInitPersonalValues={paymentInitPersonalValues}
              handlePaymentInitPersonalChange={handlePaymentInitPersonalChange}
              paymentPlanFields={paymentPlanFields}
              clientIntakeFields={clientIntakeFields}
              paymentInitSaving={paymentInitSaving}
              handleCreatePaymentRecord={handleCreatePaymentRecord}
            />
          ) : (
            <ClientIntakeCard
              clientIntakeFields={clientIntakeFields}
              clientIntakeValues={clientIntakeValues}
              handleClientIntakeChange={handleClientIntakeChange}
              canEditClientPayments={canEditClientPayments}
              clientIntakeSaving={clientIntakeSaving}
              paymentRecord={paymentRecord}
              isAdmin={isAdmin}
              isTeamLead={isTeamLead}
              handleSaveClientIntake={handleSaveClientIntake}
            />
          )}

          {paymentRecord && (
            <div className="mt-8">
              <ClientPaymentTimelineCard paymentRecord={paymentRecord} />
            </div>
          )}
        </div>

        <div className="space-y-6">
          <LeadNotesCard leadId={leadId} user={user!} />
          <LeadMetadataCard 
            lead={lead!} 
            metaNames={{
              [lead?.ownerId ?? ""]: owner?.name ?? "",
              ...(lead?.assignedToId ? { [lead.assignedToId]: assignedTo?.name ?? "" } : {})
            }} 
          />
          <LeadActivityTimeline lead={lead!} />
        </div>
      </div>

      <Dialog open={showReopenDialog} onOpenChange={setShowReopenDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reopen Lead</DialogTitle>
            <DialogDescription>
              Are you sure you want to reopen this lead? It will be moved back
              to Active Leads and its status will be reset.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowReopenDialog(false)}
              disabled={isReopening}>
              Cancel
            </Button>
            <Button onClick={handleReopenLead} disabled={isReopening}>
              {isReopening ? "Reopening..." : "Reopen Lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
