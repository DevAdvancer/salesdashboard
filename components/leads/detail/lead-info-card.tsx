"use client";

import type { Dispatch, SetStateAction } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { storage } from "@/lib/appwrite";
import { BUCKETS } from "@/lib/constants/appwrite";
import type { FormField, Lead, LeadData, LeadDataValue, User } from "@/lib/types";
import {
  LEAD_STATUS_SIGNED_CLOSURE,
  LEAD_WORKFLOW_STATUSES,
  MONITOR_ONLY_STATUSES,
  getLeadEditAllowedStatusesForRole,
  canonicalizeLeadStatus,
} from "@/lib/utils/lead-status-workflow";
import {
  getLinkedinProfileValue,
  isLinkedinProfileField,
} from "@/lib/utils/lead-linkedin-field";
import {
  getLeadAmountValue,
  isAmountMissing,
} from "@/lib/utils/lead-close-gate";
import { shouldShowRequiredAsterisk } from "@/lib/utils/required-lead-fields";
import {
  formatFollowUpDateTime,
  formatFollowUpStatus,
  normalizeStatusText,
  withAmountField,
  withLastNameField,
  withLegalNameField,
} from "./lead-detail-utils";

interface LeadInfoCardProps {
  lead: Lead;
  user: User;
  leadData: LeadData;
  formFields: FormField[];
  isEditing: boolean;
  fieldErrors: Record<string, string | null>;
  onFieldChange: (key: string, value: LeadDataValue) => void;
  setLeadData: Dispatch<SetStateAction<LeadData>>;
}

export function LeadInfoCard({
  lead,
  user,
  leadData,
  formFields,
  isEditing,
  fieldErrors,
  onFieldChange,
  setLeadData,
}: LeadInfoCardProps) {
  const isLeadGeneration = user.role === "lead_generation";
  const isOperations = user.role === "operations";
  const isMonitor = user.role === "monitor";
  const isLeadOwner = lead.ownerId === user.$id;

  const leadGenerationVisibleKeys = new Set([
    "firstName",
    "middleName",
    "lastName",
    "email",
    "phone",
    "visaStatus",
    "linkedinProfileUrl",
  ]);

  const rawLeadAmount = getLeadAmountValue(leadData as Record<string, unknown>);
  const isLeadAmountMissing = isAmountMissing(rawLeadAmount);

  const resumeFileId =
    typeof leadData.resumeFileId === "string" ? leadData.resumeFileId : "";
  const resumeFileName =
    typeof leadData.resumeFileName === "string" ? leadData.resumeFileName : "";

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
              className={`w-full min-h-[100px] px-4 py-3 rounded-2xl border ${
                fieldError ? "border-red-500" : "border-input"
              } bg-[var(--input)] text-foreground`}
              value={value}
              onChange={(e) => onFieldChange(field.key, e.target.value)}
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
                className={`flex h-10 w-full rounded-2xl border ${
                  fieldError ? "border-red-500" : "border-transparent"
                } bg-[var(--input)] px-4 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ink)] focus-visible:ring-offset-0 focus-visible:border-[var(--ink)]`}
                value={value}
                onChange={(e) => onFieldChange(field.key, e.target.value)}
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
              className={`flex h-10 w-full rounded-2xl border ${
                fieldError ? "border-red-500" : "border-transparent"
              } bg-[var(--input)] px-4 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ink)] focus-visible:ring-offset-0 focus-visible:border-[var(--ink)]`}
              value={value}
              onChange={(e) => onFieldChange(field.key, e.target.value)}
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

      default: {
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
              onChange={(e) => onFieldChange(field.key, e.target.value)}
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
    }
  };

  return (
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
  );
}
