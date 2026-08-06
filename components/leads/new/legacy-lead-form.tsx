"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/contexts/auth-context";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queries/keys";
import { createLead } from "@/lib/services/lead-action-service";
import {
  findBackedOutLeadForLinkedinTargetUrlAction,
  getLinkedinRequestCompanyAction,
  linkLeadToLinkedinRequestAction,
} from "@/app/actions/linkedin/requests";
import { validateLeadUniqueness } from "@/lib/services/lead-validator";
import { listBranches } from "@/lib/services/branch-service";
import { getCachedFormConfigAction } from "@/app/actions/form-config";
import { FormField, Branch } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DynamicLeadForm } from "@/components/dynamic-lead-form";
import { useToast } from "@/components/ui/use-toast";
import { isSourceExemptFromLinkedin } from "@/lib/utils/lead-source";
import {
  getLinkedinProfileDefaultValues,
  getLinkedinProfileValue,
  isLinkedinProfileField,
} from "@/lib/utils/lead-linkedin-field";
import { parseLeadActionError } from "@/lib/utils/lead-action-error";
import { formatUsPhone } from "./phone-utils";

export function LegacyNewLeadContent() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const LINKEDIN_INITIAL_STATUS = "Connection Accepted";
  const LINKEDIN_SOURCE = "LinkedIN/Lead";
  const COLD_CALL_SOURCE = "Cold Calls";

  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const duplicateErrorRef = useRef<HTMLDivElement | null>(null);
  const [linkedinRequestCompanyResolved, setLinkedinRequestCompanyResolved] =
    useState<string>("");
  const [externalErrors, setExternalErrors] = useState<
    Record<string, string | null>
  >({});

  const linkedinRequestId = (
    searchParams.get("linkedinRequestId") ?? ""
  ).trim();
  const linkedinTargetUrl = (
    searchParams.get("linkedinTargetUrl") ?? ""
  ).trim();
  const linkedinCompany = (searchParams.get("linkedinCompany") ?? "").trim();
  const coldCallEnabled = (searchParams.get("coldCall") ?? "").trim() === "1";
  const coldCallPhoneParam = (searchParams.get("coldCallPhone") ?? "").trim();
  const coldCallPhone = coldCallPhoneParam
    ? formatUsPhone(coldCallPhoneParam)
    : "";
  const isLinkedinRequestLead = Boolean(linkedinRequestId);
  const isDirectLinkedinLead =
    Boolean(linkedinTargetUrl) && !isLinkedinRequestLead;
  const isColdCallLinkedinRequest = isLinkedinRequestLead && coldCallEnabled;
  const resolvedLinkedinSource = isColdCallLinkedinRequest
    ? COLD_CALL_SOURCE
    : LINKEDIN_SOURCE;

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
      return;
    }

    if (user) {
      loadFormConfig();
      if (user.role === "admin") {
        loadBranches();
      }
    }
  }, [user, authLoading, router, linkedinRequestId, linkedinTargetUrl]);

  useEffect(() => {
    if (!user) return;
    if (!linkedinRequestId) return;
    (async () => {
      try {
        const result = await getLinkedinRequestCompanyAction({
          currentUserId: user.$id,
          requestId: linkedinRequestId,
        });
        const company =
          typeof result.company === "string" ? result.company.trim() : "";
        if (company) setLinkedinRequestCompanyResolved(company);
      } catch {}
    })();
  }, [linkedinRequestId, user]);

  useEffect(() => {
    if (!user) return;
    if (!linkedinTargetUrl) return;
    (async () => {
      try {
        const result = await findBackedOutLeadForLinkedinTargetUrlAction({
          currentUserId: user.$id,
          targetUrl: linkedinTargetUrl,
          company: linkedinCompany || undefined,
        });
        if (result.leadId) {
          toast({
            title: "Backed-out lead found",
            description:
              "Opening the existing lead instead of creating a new one.",
          });
          router.push(`/leads/${encodeURIComponent(result.leadId)}`);
        }
      } catch {}
    })();
  }, [linkedinCompany, linkedinTargetUrl, router, toast, user]);

  useEffect(() => {
    if (!duplicateError) return;
    duplicateErrorRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [duplicateError]);

  const clearExternalError = useCallback((key: string) => {
    setExternalErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const loadFormConfig = async () => {
    try {
      setIsLoading(true);
      setError(null);      // Default to a fallback array if cached action fails.
      const cachedConfig = await getCachedFormConfigAction().catch(() => ({ fields: [] }));
      const config = cachedConfig as { fields: any[] };
      const fields = config.fields;
      const sorted = fields.sort((a, b) => a.order - b.order);
      const adjusted = isLinkedinRequestLead
        ? sorted.map((field) =>
            field.key === "status"
              ? { ...field, options: [LINKEDIN_INITIAL_STATUS] }
              : field.key === "company" ||
                  field.key === "source" ||
                  field.key === "sourceName"
                ? { ...field, visible: false, required: false }
                : field,
          )
        : isDirectLinkedinLead
          ? sorted.map((field) =>
              field,
            )
          : sorted.map((field) =>
              field,
            );
      const withRequiredOverrides = adjusted.map((field) => {
        const normalizedLabel = field.label.trim().toLowerCase();
        const isLegalNameField =
          field.key === "legalName" || normalizedLabel === "legal name";

        if (isLinkedinProfileField(field) || isLegalNameField) {
          return { ...field, required: true };
        }

        return field;
      });

      const hasLinkedinField = withRequiredOverrides.some((field) =>
        isLinkedinProfileField(field),
      );

      setFormFields(
        hasLinkedinField
          ? withRequiredOverrides
          : [
              ...withRequiredOverrides,
              {
                id: "static-linkedin-profile-url",
                type: "text",
                label: "LinkedIn profile link",
                key: "linkedinProfileUrl",
                required: true,
                visible: true,
                order:
                  Math.max(
                    0,
                    ...withRequiredOverrides.map((field) => Number(field.order) || 0),
                  ) + 1,
              },
            ],
      );
    } catch (err: any) {
      console.error("Error loading form config:", err);
      setError(err.message || "Failed to load form configuration");
    } finally {
      setIsLoading(false);
    }
  };

  const loadBranches = async () => {
    try {
      const fetchedBranches = await listBranches();
      setBranches(fetchedBranches.filter((b) => b.isActive));
    } catch (err: any) {
      console.error("Error loading branches:", err);
    }
  };

  const handleSubmit = async (data: Record<string, any>) => {
    if (!user) return;

    try {
      setIsSaving(true);
      setDuplicateError(null);

      const rawLinkedinValue = getLinkedinProfileValue(data, formFields);
      const isExempt = isSourceExemptFromLinkedin(data.source ?? data.sourceName);

      if (!rawLinkedinValue && !isExempt) {
        toast({
          title: "Missing LinkedIn profile link",
          description: "LinkedIn profile link is required.",
          variant: "destructive",
        });
        setIsSaving(false);
        return;
      }

      if (rawLinkedinValue) {
        data.linkedinProfileUrl = rawLinkedinValue;
        if (!data.linkedinProfile) data.linkedinProfile = rawLinkedinValue;
      }

      // Validate lead uniqueness before creating
      const validation = await validateLeadUniqueness(data);
      if (!validation.isValid) {
        const fieldLabel =
          validation.duplicateField === "email"
            ? "email address"
            : validation.duplicateField === "phone"
              ? "phone number"
              : "LinkedIn URL";
        setDuplicateError(
          `A lead with this ${fieldLabel} already exists${validation.existingBranchId ? " in another branch" : ""}.`,
        );
        setIsSaving(false);
        return;
      }

      // Determine branchId: admin can specify, others inherit from their user
      const branchId =
        isAdmin && selectedBranch
          ? selectedBranch
          : user.branchId ||
            (user.branchIds && user.branchIds.length > 0
              ? user.branchIds[0]
              : undefined);

      // Extract assignedToId added by DynamicLeadForm and prevent it from being stored in data JSON
      const { assignedToId, ...sanitizedData } = data as {
        assignedToId?: string;
      } & Record<string, any>;

      const effectiveLinkedinCompany = (
        linkedinRequestCompanyResolved || linkedinCompany
      ).trim();
      if (isLinkedinRequestLead && !effectiveLinkedinCompany) {
        toast({
          title: "Missing company",
          description:
            "Company could not be resolved from the LinkedIn request. Please go back and retry from LinkedIn Requests.",
          variant: "destructive",
        });
        setIsSaving(false);
        return;
      }
      const finalData = isLinkedinRequestLead
        ? (() => {
            const resolvedSource = isColdCallLinkedinRequest
              ? COLD_CALL_SOURCE
              : LINKEDIN_SOURCE;
            return {
              ...sanitizedData,
              ...(isColdCallLinkedinRequest &&
              coldCallPhone &&
              (!("phone" in sanitizedData) ||
                (typeof sanitizedData.phone === "string" &&
                  !sanitizedData.phone.trim()))
                ? { phone: coldCallPhone }
                : {}),
              status: LINKEDIN_INITIAL_STATUS,
              linkedinRequestId,
              ...(effectiveLinkedinCompany
                ? { company: effectiveLinkedinCompany }
                : {}),
              sourceName: resolvedSource,
              source: resolvedSource,
            };
          })()
        : sanitizedData;

      // Auto-assign to creator if no one is selected
      const finalAssignedToId = assignedToId || user.$id;

      // Create lead with auto-set owner and assigned agent (defaults to creator)
      const created = await createLead(
        user.$id,
        {
          data: finalData,
          assignedToId: finalAssignedToId,
          status: isLinkedinRequestLead
            ? LINKEDIN_INITIAL_STATUS
            : finalData.status || "Interested",
          branchId: branchId ?? null,
        },
        user.$id,
        user.name,
      );

      if (linkedinRequestId) {
        try {
          await linkLeadToLinkedinRequestAction({
            currentUserId: user.$id,
            requestId: linkedinRequestId,
            leadId: created.$id,
          });
        } catch {}
      }

      toast({
        title: "Success",
        description: "Lead created successfully",
      });

      queryClient.invalidateQueries({ queryKey: queryKeys.leads.all });
      queryClient.invalidateQueries({ queryKey: ['assigned-report'] });

      router.push("/leads");
    } catch (err: any) {
      console.error("Error creating lead:", err);
      const parsed = parseLeadActionError(err);
      if (parsed) {
        if (parsed.code === "MISSING_REQUIRED_FIELD") {
          const missingFields = (
            parsed.meta as { missingFields?: Array<{ key: string; label: string }> } | undefined
          )?.missingFields;
          if (missingFields && missingFields.length > 1) {
            const labels = missingFields.map((m) => m.label);
            setExternalErrors((prev) => {
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
            setExternalErrors((prev) => ({ ...prev, [parsed.field!]: parsed.message }));
            return;
          }
        }
        if (parsed.code === "DUPLICATE_FIELD" && parsed.field) {
          // Keep the existing duplicate banner (no regression) AND
          // surface the field so the input gets a red border.
          setDuplicateError(parsed.message);
          setExternalErrors((prev) => ({ ...prev, [parsed.field!]: parsed.message }));
          return;
        }
        if (parsed.field) {
          setExternalErrors((prev) => ({ ...prev, [parsed.field!]: parsed.message }));
          return;
        }
        // Non-field error: fall back to toast.
        toast({
          title: "Error",
          description: parsed.message,
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Error",
        description: err?.message || "Failed to create lead",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (authLoading || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg">Loading form...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto">
        <Card className="border-red-500">
          <CardHeader>
            <CardTitle className="text-red-500">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p>{error}</p>
            <Button onClick={loadFormConfig} className="mt-4">
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl">
      <div className="mb-6">
        <Button
          variant="outline"
          onClick={() => router.push("/leads")}
          className="mb-2">
          ← Back to Leads
        </Button>
        <h1 className="text-2xl md:text-3xl font-bold">Create New Lead</h1>
        <p className="text-muted-foreground">
          Fill in the lead information below
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lead Information</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Duplicate Error */}
          {duplicateError && (
            <div
              ref={duplicateErrorRef}
              className="mb-6 p-3 text-sm text-red-500 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-md">
              {duplicateError}
            </div>
          )}

          {/* Branch Selector (Admin Only) */}
          {isAdmin && branches.length > 0 && (
            <div className="mb-6 pb-6 border-b">
              <Label htmlFor="branch">Branch</Label>
              <select
                id="branch"
                className="flex h-10 w-full rounded-md border border-input bg-background pl-3 pr-8 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 mt-2"
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}>
                <option value="">No branch</option>
                {branches.map((branch) => (
                  <option key={branch.$id} value={branch.$id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Dynamic Lead Form */}
          <DynamicLeadForm
            key={`${linkedinRequestId || "manual"}-${linkedinRequestCompanyResolved || ""}`}
            formConfig={formFields}
            onSubmit={handleSubmit}
            submitLabel="Create Lead"
            isLoading={isSaving}
            externalErrors={externalErrors}
            onClearExternalError={clearExternalError}
            defaultValues={
              isLinkedinRequestLead
                ? {
                    status: LINKEDIN_INITIAL_STATUS,
                    company:
                      (
                        linkedinRequestCompanyResolved || linkedinCompany
                      ).trim() || undefined,
                    ...(coldCallPhone ? { phone: coldCallPhone } : {}),
                    ...getLinkedinProfileDefaultValues(
                      formFields,
                      linkedinTargetUrl,
                    ),
                    source: resolvedLinkedinSource,
                    sourceName: resolvedLinkedinSource,
                  }
                : isDirectLinkedinLead
                  ? {
                      status: "Interested",
                      ...getLinkedinProfileDefaultValues(
                        formFields,
                        linkedinTargetUrl,
                      ),
                    }
                  : undefined
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
