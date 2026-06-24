"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/contexts/auth-context";
import { useRouter, useParams } from "next/navigation";
import { getLead } from "@/lib/services/lead-service";
import { reopenLead } from "@/lib/services/lead-action-service";
import { getUserByIdOrNull } from "@/lib/services/user-service";
import { User } from "@/lib/types";
import {
  getClosureFormConfig,
  getFormConfig,
  getClientIntakeFormConfig,
  getPaymentPlanFormConfig,
} from "@/lib/services/form-config-service";
import {
  addClientPaymentUpdate,
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { ProtectedRoute } from "@/components/protected-route";
import { LeadActivityTimeline } from "@/components/leads/lead-activity-timeline";
import { LeadNotesCard } from "@/components/leads/lead-notes-card";
import { isClientExcludedStatus } from "@/lib/utils/client-history";

// Ensures a "lastName" text field is always present and rendered just below
// "firstName" on the Client Detail page. Mirrors the fallback used in
// app/leads/[id]/page.tsx and DynamicLeadForm so the read-only client view
// never silently drops the last name field if the saved form config was
// edited to remove it (or created before Last Name was a default field).
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

// Returns the lead's quoted amount as a trimmed string, or "" when the
// lead has no amount set. Used to pre-fill both the Create Payment Record
// form's upfrontAmount field and the Client Details intake's upfront
// field so the agent doesn't have to retype it on a fresh payment record.
function getLeadAmount(leadData: LeadData): string {
  const raw = (leadData as { amount?: unknown }).amount;
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number") return String(raw);
  return "";
}

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
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("not_paid");
  const [paymentNote, setPaymentNote] = useState("");
  const [paymentSaving, setPaymentSaving] = useState(false);
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
  const [editUpfrontAmount, setEditUpfrontAmount] = useState<string>("");

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
        console.error("Error loading related users:", err);
      }
    } catch (err: unknown) {
      console.error("Error loading lead:", err);
      setError(err instanceof Error ? err.message : "Failed to load lead");
    } finally {
      setIsLoading(false);
    }
  };

  const loadFormConfig = async () => {
    try {
      const config = await getFormConfig();
      setFormFields(config.fields.sort((a, b) => a.order - b.order));
    } catch (err: unknown) {
      console.error("Error loading form config:", err);
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
      console.error("Error loading close configs:", err);
    }
  };

  const loadClientIntakeConfig = async () => {
    try {
      const config = await getClientIntakeFormConfig();
      setClientIntakeFields(config.fields.sort((a, b) => a.order - b.order));
    } catch (err: unknown) {
      console.error("Error loading client intake config:", err);
    }
  };

  const handlePaymentInitPlanChange = (key: string, value: unknown) => {
    setPaymentInitPlanValues((prev) => ({ ...prev, [key]: value }));
  };

  const handlePaymentInitPersonalChange = (key: string, value: unknown) => {
    setPaymentInitPersonalValues((prev) => ({ ...prev, [key]: value }));
  };

  const renderPaymentInitField = (
    field: FormField,
    values: Record<string, unknown>,
    onChange: (key: string, value: unknown) => void,
    disabled: boolean,
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

    if (field.type === "textarea") {
      return (
        <Textarea
          id={field.key}
          value={value}
          onChange={(e) => onChange(field.key, e.target.value)}
          disabled={disabled}
          placeholder={field.placeholder}
        />
      );
    }

    if (field.type === "dropdown") {
      return (
        <select
          id={field.key}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          value={value}
          onChange={(e) => onChange(field.key, e.target.value)}
          disabled={disabled}>
          <option value="" disabled>
            Select...
          </option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }

    return (
      <Input
        id={field.key}
        type={
          field.type === "email"
            ? "email"
            : field.type === "phone"
              ? "tel"
              : "text"
        }
        value={value}
        onChange={(e) => onChange(field.key, e.target.value)}
        disabled={disabled}
        placeholder={field.placeholder}
      />
    );
  };

  const handleCreatePaymentRecord = async () => {
    if (!user) return;
    if (!canEditClientPayments) return;

    const percent = Number(paymentInitPlanValues.paymentPercent);
    const months = Number(paymentInitPlanValues.paymentMonths);
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
      setPaymentStatus(created.status);
      toast({ title: "Success", description: "Payment record created." });
    } catch (err: unknown) {
      console.error("Error creating payment record:", err);
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
        setPaymentStatus(record.status);
        setEditUpfrontAmount(String(record.paymentPlan.upfrontAmount));
      }
      setClientIntakeInitializedForRecord(null);
      if (!record) {
        setPaymentInitPlanValues({});
        setPaymentInitPersonalValues({});
      }
    } catch (err: unknown) {
      console.error("Error loading payment record:", err);
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
    const derivedAgreement = `${paymentRecord.paymentPlan.percent}% in ${paymentRecord.paymentPlan.months} Months`;
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

  const canReopen = Boolean(isTeamLead);
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
      console.error("Error reopening lead:", err);
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

  const renderField = (field: FormField) => {
    const rawValue = leadData[field.key];
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
            className="w-full min-h-[100px] px-3 py-2 rounded-md border border-input bg-muted text-muted-foreground"
            value={value}
            disabled
            readOnly
          />
        );

      case "dropdown":
        return (
          <Input id={field.key} type="text" value={value} disabled readOnly />
        );

      case "checklist":
        return (
          <div className="space-y-2">
            {field.options?.map((option) => (
              <div key={option} className="flex items-center">
                <input
                  type="checkbox"
                  checked={checkedValues.includes(option)}
                  disabled
                  readOnly
                  className="mr-2"
                />
                <span className="text-muted-foreground">{option}</span>
              </div>
            ))}
          </div>
        );

      default:
        return (
          <Input
            id={field.key}
            type={field.type}
            value={value}
            disabled
            readOnly
          />
        );
    }
  };

  const renderReadOnlyValue = (value: unknown) => {
    if (value === null || value === undefined) return "";
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return String(value);
    }
    if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
    return JSON.stringify(value);
  };

  const formatPaymentStatusLabel = (status: PaymentStatus) => {
    if (status === "fully_paid") return "Fully Paid";
    if (status === "partially_paid") return "Partially Paid";
    return "Not Paid";
  };

  const handleClientIntakeChange = (key: string, value: unknown) => {
    setClientIntakeValues((prev) => ({ ...prev, [key]: value }));
  };

  const renderClientIntakeField = (field: FormField) => {
    const valueRaw = clientIntakeValues[field.key];
    const value =
      valueRaw === null || valueRaw === undefined
        ? ""
        : typeof valueRaw === "string" ||
            typeof valueRaw === "number" ||
            typeof valueRaw === "boolean"
          ? String(valueRaw)
          : JSON.stringify(valueRaw);

    // Admin and TL can edit agreement/upfront in Client Details.
    // Other fields (salesperson) remain always locked.
    const isLockedField =
      field.key === "salesperson" ||
      (field.key !== "agreement" && field.key !== "upfront"
        ? false
        : !isAdmin && !isTeamLead);
    const canEditAgreementUpfront = isAdmin || isTeamLead;
    const isDisabled =
      !canEditClientPayments ||
      clientIntakeSaving ||
      !paymentRecord ||
      (paymentRecord.status !== "fully_paid" &&
        paymentRecord.status !== "partially_paid") ||
      (isLockedField && !canEditAgreementUpfront);

    if (field.type === "textarea") {
      return (
        <Textarea
          id={field.key}
          value={value}
          disabled={isDisabled}
          onChange={(e) => handleClientIntakeChange(field.key, e.target.value)}
          placeholder={field.placeholder}
        />
      );
    }

    if (field.type === "dropdown") {
      return (
        <select
          id={field.key}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          value={value}
          onChange={(e) => handleClientIntakeChange(field.key, e.target.value)}
          disabled={isDisabled}>
          <option value="" disabled>
            Select...
          </option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }

    return (
      <Input
        id={field.key}
        type={
          field.type === "email"
            ? "email"
            : field.type === "phone"
              ? "tel"
              : "text"
        }
        value={value}
        disabled={isDisabled}
        onChange={(e) => handleClientIntakeChange(field.key, e.target.value)}
        placeholder={field.placeholder}
      />
    );
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
    const derivedAgreement = `${paymentRecord.paymentPlan.percent}% in ${paymentRecord.paymentPlan.months} Months`;

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
    } catch (err: unknown) {
      console.error("Error saving client intake:", err);
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

  const handleAddPaymentUpdate = async () => {
    if (!user) return;
    if (!canEditClientPayments) return;
    if (!paymentRecord) return;
    const note = paymentNote.trim();
    if (!note) {
      toast({
        title: "Note required",
        description: "Please add a note while updating the payment.",
        variant: "destructive",
      });
      return;
    }

    try {
      setPaymentSaving(true);
      const newUpfront = Number(editUpfrontAmount);
      let currentRecord = paymentRecord;

      // If the user entered a new upfront value, also store it on the
      // payment update as the "amount paid" — that way the running total
      // of paid amounts (and the Upfront (collected) stat) reflects what
      // they actually entered. The plan's upfrontAmount stays as the
      // planned value when the entered value matches it; otherwise it
      // becomes the new plan value AND the amount paid for this update.
      const enteredAmount =
        !isNaN(newUpfront) && newUpfront > 0 ? newUpfront : null;

      if (
        !isNaN(newUpfront) &&
        newUpfront !== currentRecord.paymentPlan.upfrontAmount
      ) {
        currentRecord = await upsertClientPaymentRecord({
          actorId: user.$id,
          leadId,
          personalDetails: currentRecord.personalDetails,
          paymentPlan: {
            ...currentRecord.paymentPlan,
            upfrontAmount: newUpfront,
          },
        });
      }

      const updated = await addClientPaymentUpdate({
        actorId: user.$id,
        leadId,
        status: paymentStatus,
        note: note,
        amount: enteredAmount,
      });
      setPaymentRecord(updated);
      if (updated) {
        setEditUpfrontAmount(String(updated.paymentPlan.upfrontAmount));
      }
      setPaymentNote("");
      toast({ title: "Success", description: "Payment update saved." });
    } catch (err: unknown) {
      console.error("Error saving payment update:", err);
      toast({
        title: "Error",
        description:
          err instanceof Error ? err.message : "Failed to save payment update",
        variant: "destructive",
      });
    } finally {
      setPaymentSaving(false);
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
      <div className="container mx-auto">
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              {error || "Client record not found"}
            </p>
            <Button onClick={() => router.push("/client")} className="mt-4">
              Back to Clients
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <Button
            variant="outline"
            onClick={() => router.push("/client")}
            className="mb-2">
            ← Back to Clients
          </Button>
          <h1 className="text-2xl md:text-3xl font-bold">Client Detail</h1>
          <p className="text-muted-foreground mt-1">
            Read-only view of client record
          </p>
        </div>
        <div className="flex gap-2">
          {canReopen && (
            <Button onClick={() => setShowReopenDialog(true)} variant="default">
              Reopen Lead
            </Button>
          )}
        </div>
      </div>

      {/* Closure Information Banner */}
      <Card className="mb-6 border-yellow-700 bg-yellow-900/20">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2">
            <svg
              className="w-5 h-5 text-yellow-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div>
              <p className="text-yellow-500 font-semibold">
                This lead is closed
              </p>
              <p className="text-muted-foreground text-sm">
                Closed on{" "}
                {lead.closedAt
                  ? new Date(lead.closedAt).toLocaleString()
                  : "N/A"}{" "}
                with status:{" "}
                <span className="font-semibold text-foreground">
                  {lead.status}
                </span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6">
        {/* Lead Information */}
        <Card>
          <CardHeader>
            <CardTitle>Lead Information</CardTitle>
            <p className="text-sm text-muted-foreground">
              All fields are read-only
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {withLastNameField(formFields).map((field) => (
                <div key={field.id}>
                  <Label htmlFor={field.key}>
                    {field.label}
                    {field.required && (
                      <span className="text-red-500 ml-1">*</span>
                    )}
                    {!field.visible && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        (Hidden field)
                      </span>
                    )}
                  </Label>
                  {renderField(field)}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Closure Metadata */}
        <Card>
          <CardHeader>
            <CardTitle>Closure Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Status</Label>
                <p className="mt-2">
                  <span className="inline-block px-3 py-1 rounded-full bg-secondary text-secondary-foreground">
                    {lead.status}
                  </span>
                </p>
              </div>
              <div>
                <Label>Closed At</Label>
                <p className="text-muted-foreground mt-2">
                  {lead.closedAt
                    ? new Date(lead.closedAt).toLocaleString()
                    : "N/A"}
                </p>
              </div>
              <div>
                <Label>Is Closed</Label>
                <p className="text-muted-foreground mt-2">
                  {lead.isClosed ? "Yes" : "No"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {paymentLoading ? (
              <p className="text-sm text-muted-foreground">
                Loading payments...
              </p>
            ) : !paymentRecord ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {canEditClientPayments
                    ? "No payment record found for this client. Create one to track payment status."
                    : "No payment record found for this client."}
                </p>

                {canEditClientPayments && (
                  <>
                    {paymentPlanFields.length > 0 && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {paymentPlanFields
                          .filter((field) => field.visible)
                          .map((field) => (
                            <div key={field.id}>
                              <Label>{field.label}</Label>
                              {renderPaymentInitField(
                                field,
                                paymentInitPlanValues,
                                handlePaymentInitPlanChange,
                                paymentInitSaving,
                              )}
                            </div>
                          ))}
                      </div>
                    )}

                    {closureFields.length > 0 && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {closureFields
                          .filter((field) => field.visible)
                          .map((field) => (
                            <div
                              key={field.id}
                              className={
                                field.type === "textarea"
                                  ? "md:col-span-2"
                                  : undefined
                              }>
                              <Label>{field.label}</Label>
                              {renderPaymentInitField(
                                field,
                                paymentInitPersonalValues,
                                handlePaymentInitPersonalChange,
                                paymentInitSaving,
                              )}
                            </div>
                          ))}
                      </div>
                    )}

                    <div className="flex justify-end">
                      <Button
                        onClick={handleCreatePaymentRecord}
                        disabled={paymentInitSaving}>
                        {paymentInitSaving
                          ? "Creating..."
                          : "Create Payment Record"}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    {/* The Payments section used to render a "Plan" row
                        that read `percent / months / upfrontAmount` from
                        the stored payment plan. The plan-based row was
                        removed because the actual figure the operator
                        cares about is the lead's quoted amount, captured
                        on the lead form. We pull that from `leadData.amount`
                        here. If the lead has no amount set (legacy data),
                        we show a dash rather than fabricating a value. */}
                    <Label>Amount (from Lead Details)</Label>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {(typeof (leadData as any).amount === "string"
                        ? (leadData as any).amount.trim()
                        : typeof (leadData as any).amount === "number"
                          ? String((leadData as any).amount)
                          : "") || "—"}
                    </p>
                  </div>
                  <div>
                    <Label>Status</Label>
                    <p className="mt-2">
                      <span className="inline-block px-3 py-1 rounded-full bg-secondary text-secondary-foreground text-sm">
                        {formatPaymentStatusLabel(paymentRecord.status)}
                      </span>
                    </p>
                  </div>
                </div>

                {closureFields.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {closureFields
                      .filter((field) => field.visible)
                      .map((field) => (
                        <div key={field.id}>
                          <Label>{field.label}</Label>
                          <Input
                            value={renderReadOnlyValue(
                              paymentRecord.personalDetails[field.key],
                            )}
                            disabled
                            readOnly
                          />
                        </div>
                      ))}
                  </div>
                )}

                {paymentPlanFields.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {paymentPlanFields
                      .filter((field) => field.visible)
                      .map((field) => (
                        <div key={field.id}>
                          <Label>{field.label}</Label>
                          {field.key === "upfrontAmount" ? (
                            <Input
                              type="number"
                              value={editUpfrontAmount}
                              onChange={(e) =>
                                setEditUpfrontAmount(e.target.value)
                              }
                              disabled={!canEditClientPayments || paymentSaving}
                            />
                          ) : (
                            <Input
                              value={renderReadOnlyValue(
                                field.key === "paymentPercent"
                                  ? paymentRecord.paymentPlan.percent
                                  : field.key === "paymentMonths"
                                    ? paymentRecord.paymentPlan.months
                                    : (paymentRecord.paymentPlan as any)[
                                        field.key
                                      ],
                              )}
                              disabled
                              readOnly
                            />
                          )}
                        </div>
                      ))}
                  </div>
                )}

                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                    <div className="space-y-2">
                      <Label htmlFor="paymentStatus">Update Status</Label>
                      <select
                        id="paymentStatus"
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        value={paymentStatus}
                        onChange={(e) =>
                          setPaymentStatus(e.target.value as PaymentStatus)
                        }
                        disabled={!canEditClientPayments || paymentSaving}>
                        <option value="not_paid">Not Paid</option>
                        <option value="partially_paid">Partially Paid</option>
                        <option value="fully_paid">Fully Paid</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="paymentNote">Note</Label>
                      <Textarea
                        id="paymentNote"
                        value={paymentNote}
                        onChange={(e) => setPaymentNote(e.target.value)}
                        placeholder="Add a follow-up update..."
                        disabled={!canEditClientPayments || paymentSaving}
                        className="min-h-[84px]"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-end">
                      <Button
                        onClick={handleAddPaymentUpdate}
                        disabled={!canEditClientPayments || paymentSaving}>
                        {paymentSaving ? "Saving..." : "Add Update"}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <Label>Updates</Label>
                  {paymentRecord.updates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No updates yet.
                    </p>
                  ) : (
                    paymentRecord.updates.map((update) => (
                      <div
                        key={update.id}
                        className="rounded-md border border-border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">
                              {update.actorName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatPaymentStatusLabel(update.status)}
                            </p>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {new Date(update.createdAt).toLocaleString()}
                          </p>
                        </div>
                        {update.note && (
                          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                            {update.note}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Client Details (After Payment)</CardTitle>
            <p className="text-sm text-muted-foreground">
              {paymentRecord?.status === "fully_paid" ||
              paymentRecord?.status === "partially_paid"
                ? "All fields are required."
                : "Complete payment first (set status to Partially or Fully Paid) to fill client details."}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {!paymentRecord ? (
              <p className="text-sm text-muted-foreground">
                No payment record found.
              </p>
            ) : clientIntakeFields.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No client intake configuration found.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {clientIntakeFields
                    .filter((field) => field.visible)
                    .map((field) => (
                      <div
                        key={field.id}
                        className={
                          field.type === "textarea"
                            ? "md:col-span-2"
                            : undefined
                        }>
                        <Label htmlFor={field.key}>
                          {field.label}
                          {field.required && (
                            <span className="text-red-500 ml-1">*</span>
                          )}
                        </Label>
                        {renderClientIntakeField(field)}
                      </div>
                    ))}
                </div>
                <div className="flex justify-end">
                  <Button
                    onClick={handleSaveClientIntake}
                    disabled={
                      clientIntakeSaving ||
                      !canEditClientPayments ||
                      paymentLoading ||
                      (paymentRecord.status !== "fully_paid" &&
                        paymentRecord.status !== "partially_paid")
                    }>
                    {clientIntakeSaving ? "Saving..." : "Save Client Details"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {user && <LeadNotesCard leadId={lead.$id} user={user} />}

        <LeadActivityTimeline lead={lead} />

        {/* General Metadata */}
        <Card>
          <CardHeader>
            <CardTitle>General Metadata</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <Label>Created</Label>
                <p className="text-muted-foreground mt-2">
                  {lead.$createdAt
                    ? new Date(lead.$createdAt).toLocaleString()
                    : "N/A"}
                </p>
              </div>
              <div>
                <Label>Last Updated</Label>
                <p className="text-muted-foreground mt-2">
                  {lead.$updatedAt
                    ? new Date(lead.$updatedAt).toLocaleString()
                    : "N/A"}
                </p>
              </div>
              <div>
                <Label>Owner</Label>
                <p className="text-muted-foreground mt-2">
                  {owner?.name || "Unknown"}
                </p>
              </div>
              <div>
                <Label>Assigned To</Label>
                <p className="text-muted-foreground mt-2">
                  {lead.assignedToId
                    ? assignedTo?.name || "Unknown"
                    : "Unassigned"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Reopen Lead Dialog */}
      {showReopenDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <Card className="w-full sm:max-w-md sm:mx-4 rounded-b-none sm:rounded-b-lg">
            <CardHeader>
              <CardTitle>Reopen Lead</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-muted-foreground">
                Are you sure you want to reopen this lead? It will be moved back
                to active leads and can be edited again.
              </p>
              <p className="mb-4 text-sm text-muted-foreground">
                Note: The closure timestamp will be preserved for audit
                purposes.
              </p>
              <div className="flex flex-col-reverse sm:flex-row gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowReopenDialog(false)}
                  className="w-full sm:w-auto">
                  Cancel
                </Button>
                <Button
                  onClick={handleReopenLead}
                  disabled={isReopening}
                  className="w-full sm:w-auto">
                  {isReopening ? "Reopening..." : "Reopen Lead"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
