"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { FormField, ClientPaymentRecord } from "@/lib/types";

interface ClientIntakeCardProps {
  clientIntakeFields: FormField[];
  clientIntakeValues: Record<string, unknown>;
  handleClientIntakeChange: (key: string, value: unknown) => void;
  canEditClientPayments: boolean;
  clientIntakeSaving: boolean;
  paymentRecord: ClientPaymentRecord | null;
  isAdmin: boolean;
  isTeamLead: boolean;
  handleSaveClientIntake: () => void;
}

export function ClientIntakeCard({
  clientIntakeFields,
  clientIntakeValues,
  handleClientIntakeChange,
  canEditClientPayments,
  clientIntakeSaving,
  paymentRecord,
  isAdmin,
  isTeamLead,
  handleSaveClientIntake,
}: ClientIntakeCardProps) {
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
          className="flex h-10 w-full rounded-md border border-input bg-background pl-3 pr-8 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle>Client Details</CardTitle>
        <p className="text-sm text-muted-foreground mt-2">
          Complete the client details. This section remains locked until the
          payment status is marked as Partially or Fully Paid.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2">
          {clientIntakeFields
            .filter((f) => f.visible)
            .map((field) => (
              <div key={field.id} className="space-y-2">
                <label
                  htmlFor={field.key}
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  {field.label}
                  {field.required && (
                    <span className="text-destructive ml-1">*</span>
                  )}
                </label>
                {renderClientIntakeField(field)}
              </div>
            ))}
        </div>
        <div className="mt-6 flex justify-end">
          <Button
            onClick={handleSaveClientIntake}
            disabled={
              !canEditClientPayments ||
              clientIntakeSaving ||
              !paymentRecord ||
              (paymentRecord.status !== "fully_paid" &&
                paymentRecord.status !== "partially_paid")
            }>
            {clientIntakeSaving ? "Saving..." : "Save Details"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
