"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { FormField, LeadData } from "@/lib/types";

interface ClientGeneralCardProps {
  formFields: FormField[];
  leadData: LeadData;
}

export function ClientGeneralCard({
  formFields,
  leadData,
}: ClientGeneralCardProps) {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>General Information</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2">
          {formFields
            .filter((f) => f.visible)
            .map((field) => (
              <div key={field.id} className="space-y-2">
                <label
                  htmlFor={field.key}
                  className="text-sm font-medium leading-none">
                  {field.label}
                </label>
                {renderField(field)}
              </div>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}
