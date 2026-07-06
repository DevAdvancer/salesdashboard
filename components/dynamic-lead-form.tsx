"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField } from "@/lib/types";
import {
  generateSourceAwareZodSchema,
  getVisibleFields,
} from "@/lib/utils/form-schema-generator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/contexts/auth-context";
import { LeadAssignmentDropdown } from "@/components/lead-assignment-dropdown";
import { shouldShowRequiredAsterisk } from "@/lib/utils/required-lead-fields";

const REFERRAL_SOURCE_NORMALIZED = "referral";

function normalizeSource(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isReferralSource(value: unknown): boolean {
  return normalizeSource(value) === REFERRAL_SOURCE_NORMALIZED;
}

interface DynamicLeadFormProps {
  formConfig: FormField[];
  onSubmit: (data: Record<string, unknown>) => void | Promise<void>;
  defaultValues?: Record<string, unknown>;
  submitLabel?: string;
  isLoading?: boolean;
  /**
   * Server-side validation errors, keyed by `FormField.key`. A non-null
   * value drives the red border + inline error message; a `null` (or
   * missing) entry clears any prior server error for that field.
   */
  externalErrors?: Record<string, string | null>;
  /** Notify the parent when the user starts editing a field, so the parent can clear its entry. */
  onClearExternalError?: (key: string) => void;
}

function filterReservedLeadSources(
  options: string[] | undefined,
  fieldKey: string,
  includeReservedSources: boolean,
) {
  if (!options) return options;
  if (fieldKey !== "source" && fieldKey !== "sourceName") return options;

  const reserved = new Set([
    "linkedin",
    "linkedin/lead",
    "cold call",
    "cold calls",
  ]);

  const filteredOptions = options.filter((option) => {
    const normalized = option.trim().toLowerCase();
    return normalized && !reserved.has(normalized);
  });

  if (!includeReservedSources) {
    return filteredOptions;
  }

  return [...filteredOptions, "LinkedIN/Lead", "Cold Calls"];
}

/**
 * DynamicLeadForm Component
 *
 * Renders a dynamic form based on form configuration with the following features:
 * - Filters fields by visible=true for agents (admins see all fields in builder)
 * - Sorts fields by order property
 * - Renders fields based on type (text, email, phone, dropdown, textarea, checklist)
 * - Applies generated zod schema for validation
 * - Displays field-level error messages
 *
 * Requirements: 3.8, 3.9, 10.4, 10.5, 11.4, 11.5
 */
export function DynamicLeadForm({
  formConfig,
  onSubmit,
  defaultValues = {},
  submitLabel = "Submit",
  isLoading = false,
  externalErrors,
  onClearExternalError,
}: DynamicLeadFormProps) {
  const { user, isAgent, isMonitor } = useAuth();
  const isAgentLike = isAgent || isMonitor;

  // State for the lead assignment dropdown (Requirement 4.2, 4.3, 4.4)
  // Agents auto-assign to themselves; team leads default to creator
  const [assignedToId, setAssignedToId] = useState<string | null>(
    isAgentLike && user ? user.$id : user ? user.$id : null,
  );

  // Track source value to conditionally show referralName field
  const [selectedSource, setSelectedSource] = useState<string>(
    typeof defaultValues?.source === "string" ? defaultValues.source : "",
  );

  // Show referralName field when source is "Referral"
  const showReferralName = isReferralSource(selectedSource);

  // Filter out ownerId and assignedToId from configurable form fields (Requirement 4.5)
  // These are handled automatically: ownerId by createLead, assignedToId by the dropdown
  // Also filter out referral name fields — the showReferralName block below renders
  // it only when source is "Referral", avoiding duplication and default rendering.
  const filteredConfig = formConfig.filter((f) => {
    if (f.key === "ownerId" || f.key === "assignedToId") return false;
    // Match by key OR by label (form-config may store the field with a generated key)
    const isReferralField =
      f.key === "referralName" ||
      f.key === "referral" ||
      f.label.toLowerCase().replace(/[^a-z]/g, "") === "referralname";
    if (isReferralField) return false;
    return true;
  });

  // If lastName is not in the config (removed by user), inject it manually just under firstName (or at start if firstName missing)
  const hasLastName = filteredConfig.some((f) => f.key === "lastName");
  const effectiveConfig = [...filteredConfig];

  if (!hasLastName) {
    const firstNameIndex = effectiveConfig.findIndex(
      (f) => f.key === "firstName",
    );
    const lastNameField: FormField = {
      id: "static-lastname",
      key: "lastName",
      label: "Last Name",
      type: "text",
      required: false, // Updated to not required as requested
      visible: true,
      order: 0, // Will be ignored by splice logic below, or handled by visible fields sort
    };

    if (firstNameIndex !== -1) {
      // Insert after firstName
      effectiveConfig.splice(firstNameIndex + 1, 0, lastNameField);
    } else {
      // If no firstName, add to start (or end?) - let's add to start to be safe
      effectiveConfig.unshift(lastNameField);
    }
  }

  // Filter visible fields for agents (Requirement 3.8)
  // Managers see all fields in form builder, but in lead forms, we filter for agents
  const visibleFields = isAgentLike
    ? getVisibleFields(effectiveConfig)
    : effectiveConfig
        .filter((f) => f.visible)
        .sort((a, b) => {
          // If we injected a field, its order might be 0.
          // If we spliced it, the array order is already correct-ish, but sort might mess it up if we don't adjust 'order' property.
          // If we injected it, let's assume we want to keep the spliced order relative to neighbors.
          // Actually, 'sort' relies on 'order' property.
          // If I injected it with order 0, it might jump to top.
          // I should set its order to be firstName.order + 0.1?
          return a.order - b.order;
        });

  // Correction for injected field order:
  // If we injected lastName, we want it visually after firstName.
  // The 'visibleFields' sort might reorder it based on 'order'.
  // Let's fix the order property of the injected field if it exists.
  if (!hasLastName) {
    const firstNameField = effectiveConfig.find((f) => f.key === "firstName");
    const lastNameField = effectiveConfig.find((f) => f.key === "lastName");
    if (firstNameField && lastNameField) {
      lastNameField.order = firstNameField.order + 0.1;
    }
    // Re-sort visibleFields if we modified order
    visibleFields.sort((a, b) => a.order - b.order);
  }

  // Generate zod schema from form config (Requirements 10.5, 11.1, 11.2, 11.3)
  // LinkedIn is optional when source is "Referral"
  const schema = generateSourceAwareZodSchema(effectiveConfig, selectedSource);

  // Initialize react-hook-form (Requirement 10.4)
  // Key forces reinit when source changes so the schema (and LinkedIn requirement) updates
  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues,
    resetOptions: { keepValues: true, keepDirty: true },
  });

  // Force re-initialize when source changes (so schema/LinkedIn requirement updates)
  useEffect(() => {
    reset(defaultValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSource]);

  // Sync server-side field errors into react-hook-form so the existing
  // per-field render (errors[field.key]?.message + border-red-500) picks
  // them up automatically.
  useEffect(() => {
    if (!externalErrors) return;
    for (const [key, message] of Object.entries(externalErrors)) {
      if (message) {
        setError(key, { type: "server", message });
      } else {
        clearErrors(key);
      }
    }
  }, [externalErrors, setError, clearErrors]);

  const handleFormSubmit = async (data: Record<string, unknown>) => {
    // Inject assignedToId into the submitted data (Requirement 4.2, 4.3, 4.4)
    const submissionData = {
      ...data,
      ...(assignedToId ? { assignedToId } : {}),
    };
    await onSubmit(submissionData);
  };

  /**
   * Render field based on type
   */
  const renderField = (field: FormField) => {
    const error = errors[field.key];
    const errorMessage = error?.message as string | undefined;

    switch (field.type) {
      case "text":
      case "email":
      case "phone":
        return (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={field.key}>
              {field.label}
              {shouldShowRequiredAsterisk(field.key, field.required, selectedSource, field) && (
                <span className="text-red-500 ml-1">*</span>
              )}
            </Label>
            <Input
              id={field.key}
              type={
                field.type === "email"
                  ? "email"
                  : field.type === "phone"
                    ? "tel"
                    : "text"
              }
              placeholder={field.placeholder}
              {...register(field.key, {
              onChange: () => onClearExternalError?.(field.key),
            })}
              className={error ? "border-red-500" : ""}
            />
            {errorMessage && (
              <p className="text-sm text-red-500">{errorMessage}</p>
            )}
          </div>
        );

      case "textarea":
        return (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={field.key}>
              {field.label}
              {shouldShowRequiredAsterisk(field.key, field.required, selectedSource, field) && (
                <span className="text-red-500 ml-1">*</span>
              )}
            </Label>
            <textarea
              id={field.key}
              placeholder={field.placeholder}
              {...register(field.key, {
              onChange: () => onClearExternalError?.(field.key),
            })}
              className={`flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                error ? "border-red-500" : ""
              }`}
              rows={4}
            />
            {errorMessage && (
              <p className="text-sm text-red-500">{errorMessage}</p>
            )}
          </div>
        );

      case "dropdown":
        const dropdownOptions = filterReservedLeadSources(
          field.options,
          field.key,
          isMonitor,
        );
        const isSourceField = field.key === "source" || field.key === "sourceName";
        return (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={field.key}>
              {field.label}
              {shouldShowRequiredAsterisk(field.key, field.required, selectedSource, field) && (
                <span className="text-red-500 ml-1">*</span>
              )}
            </Label>
            <select
              id={field.key}
              {...register(field.key, {
                onChange: (e) => {
                  onClearExternalError?.(field.key);
                  if (isSourceField) {
                    setSelectedSource(e.target.value);
                  }
                },
              })}
              className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                error ? "border-red-500" : ""
              }`}>
              <option value="">Select {field.label}</option>
              {dropdownOptions?.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {errorMessage && (
              <p className="text-sm text-red-500">{errorMessage}</p>
            )}
          </div>
        );

      case "checklist":
        const checklistOptions = filterReservedLeadSources(
          field.options,
          field.key,
          isMonitor,
        );
        return (
          <div key={field.id} className="space-y-2">
            <Label>
              {field.label}
              {shouldShowRequiredAsterisk(field.key, field.required, selectedSource, field) && (
                <span className="text-red-500 ml-1">*</span>
              )}
            </Label>
            <div className="space-y-2">
              {checklistOptions?.map((option, index) => (
                <div key={option} className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id={`${field.key}-${index}`}
                    value={option}
                    {...register(field.key, {
              onChange: () => onClearExternalError?.(field.key),
            })}
                    className="h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
                  />
                  <Label
                    htmlFor={`${field.key}-${index}`}
                    className="text-sm font-normal cursor-pointer">
                    {option}
                  </Label>
                </div>
              ))}
            </div>
            {errorMessage && (
              <p className="text-sm text-red-500">{errorMessage}</p>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
      {/* Lead Assignment Dropdown - role-aware (Requirements 4.2, 4.3, 4.4) */}
      {user && (
        <LeadAssignmentDropdown
          creatorRole={user.role}
          creatorBranchIds={user.branchIds ?? []}
          creatorId={user.$id}
          value={assignedToId}
          onChange={setAssignedToId}
        />
      )}

      {/* Render fields in order (Requirement 3.8) */}
      {visibleFields.map((field) => renderField(field))}

      {/* Conditionally show Referral Name field when source is "Referral" */}
      {showReferralName && (
        <div className="space-y-2">
          <Label htmlFor="referralName">
            Referral Name
            <span className="text-red-500 ml-1">*</span>
          </Label>
          <Input
            id="referralName"
            type="text"
            placeholder="Enter referral name"
            {...register("referralName", {
              onChange: () => onClearExternalError?.("referralName"),
            })}
            className={errors.referralName ? "border-red-500" : ""}
          />
          {errors.referralName && (
            <p className="text-sm text-red-500">
              {errors.referralName.message as string}
            </p>
          )}
        </div>
      )}

      {/* Submit button - disabled when invalid (Requirement 11.5) */}
      <div className="flex justify-end space-x-4">
        <Button
          type="submit"
          disabled={isLoading || isSubmitting}
          className="min-w-[120px]">
          {isLoading || isSubmitting ? "Submitting..." : submitLabel}
        </Button>
      </div>
    </form>
  );
}
