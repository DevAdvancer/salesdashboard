"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { FormField } from "@/lib/types";

interface ClientPaymentCreateCardProps {
  paymentInitPlanValues: Record<string, unknown>;
  handlePaymentInitPlanChange: (key: string, value: unknown) => void;
  paymentInitPersonalValues: Record<string, unknown>;
  handlePaymentInitPersonalChange: (key: string, value: unknown) => void;
  paymentPlanFields: FormField[];
  clientIntakeFields: FormField[];
  paymentInitSaving: boolean;
  handleCreatePaymentRecord: () => void;
}

export function ClientPaymentCreateCard({
  paymentInitPlanValues,
  handlePaymentInitPlanChange,
  paymentInitPersonalValues,
  handlePaymentInitPersonalChange,
  paymentPlanFields,
  clientIntakeFields,
  paymentInitSaving,
  handleCreatePaymentRecord,
}: ClientPaymentCreateCardProps) {
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
      const options = field.key === "paymentPercent"
        ? Array.from(new Set([...(field.options ?? []), "H1B Agreement"]))
        : (field.options ?? []);
      return (
        <select
          id={field.key}
          className="flex h-10 w-full rounded-md border border-input bg-background pl-3 pr-8 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          value={value}
          onChange={(e) => onChange(field.key, e.target.value)}
          disabled={disabled}>
          <option value="" disabled>
            Select...
          </option>
          {options.map((option) => (
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

  const isH1B = paymentInitPlanValues.paymentPercent === "H1B Agreement";

  return (
    <Card className="mt-8 border-primary">
      <CardHeader>
        <CardTitle className="text-primary">Create Payment Record</CardTitle>
        <p className="text-sm text-muted-foreground mt-2">
          Initialize the payment tracking for this closed lead. Please set the
          payment plan details. You can also seed initial client details now or
          fill them later.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          {/* Payment Plan Details */}
          <div className="space-y-4">
            <h3 className="font-semibold text-lg border-b pb-2">
              Payment Plan
            </h3>
            {paymentPlanFields
              .filter((f) => f.visible)
              .map((field) => {
                const disabled =
                  paymentInitSaving ||
                  (isH1B && field.key === "paymentMonths");
                return (
                  <div key={field.id} className="space-y-2">
                    <label
                      htmlFor={field.key}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                      {field.label}
                      {field.required && (
                        <span className="text-destructive ml-1">*</span>
                      )}
                    </label>
                    {renderPaymentInitField(
                      field,
                      paymentInitPlanValues,
                      handlePaymentInitPlanChange,
                      disabled,
                    )}
                  </div>
                );
              })}
          </div>

          {/* Initial Client Details */}
          <div className="space-y-4">
            <h3 className="font-semibold text-lg border-b pb-2">
              Initial Client Details (Optional)
            </h3>
            {clientIntakeFields
              .filter((f) => f.visible && f.key !== "agreement" && f.key !== "upfront")
              .map((field) => (
                <div key={field.id} className="space-y-2">
                  <label
                    htmlFor={field.key}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    {field.label}
                  </label>
                  {renderPaymentInitField(
                    field,
                    paymentInitPersonalValues,
                    handlePaymentInitPersonalChange,
                    paymentInitSaving,
                  )}
                </div>
              ))}
          </div>
        </div>

        <div className="pt-4 border-t flex justify-end">
          <Button
            onClick={handleCreatePaymentRecord}
            disabled={paymentInitSaving}>
            {paymentInitSaving ? "Creating..." : "Create Payment Record"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
