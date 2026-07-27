"use client";

import { useCallback, useEffect, useState } from "react";
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
import { User } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { ID, Permission, Role } from "appwrite";
import { storage } from "@/lib/appwrite";
import { BUCKETS } from "@/lib/constants/appwrite";
import {
  buildLeadGenerationLeadData,
  getMissingLeadGenerationFields,
} from "@/lib/utils/lead-generation-form";
import { parseLeadActionError } from "@/lib/utils/lead-action-error";
import { formatUsPhone } from "./phone-utils";

export function LeadGenerationNewLeadContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  const searchParams = useSearchParams();
  const linkedinRequestId = (searchParams.get("linkedinRequestId") ?? "").trim();
  const linkedinTargetUrl = (searchParams.get("linkedinTargetUrl") ?? "").trim();
  const linkedinCompany = (searchParams.get("linkedinCompany") ?? "").trim();
  const coldCallEnabled = (searchParams.get("coldCall") ?? "").trim() === "1";
  const coldCallPhoneParam = (searchParams.get("coldCallPhone") ?? "").trim();
  const isLinkedinRequestLead = Boolean(linkedinRequestId);
  
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState(
    coldCallEnabled && coldCallPhoneParam ? formatUsPhone(coldCallPhoneParam) : ""
  );
  const [visaStatus, setVisaStatus] = useState("");
  const [linkedinProfileUrl, setLinkedinProfileUrl] = useState(linkedinTargetUrl);
  const [resumeFileId, setResumeFileId] = useState<string | null>(null);
  const [resumeFileName, setResumeFileName] = useState<string | null>(null);
  const [isUploadingResume, setIsUploadingResume] = useState(false);
  const [linkedinRequestCompanyResolved, setLinkedinRequestCompanyResolved] = useState<string>("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});

  const clearFieldError = useCallback((key: string) => {
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const buildResumePermissions = (currentUser: User) => {
    const readUserIds = new Set<string>([currentUser.$id]);
    if (currentUser.teamLeadId) readUserIds.add(currentUser.teamLeadId);

    return [
      ...Array.from(readUserIds).map((userId) =>
        Permission.read(Role.user(userId)),
      ),
      Permission.update(Role.user(currentUser.$id)),
      Permission.delete(Role.user(currentUser.$id)),
    ];
  };

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [authLoading, router, user]);

  useEffect(() => {
    if (!user) return;
    if (!linkedinRequestId) return;
    (async () => {
      try {
        const result = await getLinkedinRequestCompanyAction({
          currentUserId: user.$id,
          requestId: linkedinRequestId,
        });
        const company = typeof result.company === "string" ? result.company.trim() : "";
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
            description: "Opening the existing lead instead of creating a new one.",
          });
          router.push(`/leads/${encodeURIComponent(result.leadId)}`);
        }
      } catch {}
    })();
  }, [linkedinCompany, linkedinTargetUrl, router, toast, user]);

  const handleResumeUpload = async (file: File) => {
    if (!user) return;

    try {
      setIsUploadingResume(true);

      if (resumeFileId) {
        try {
          await storage.deleteFile(BUCKETS.RESUMES, resumeFileId);
        } catch {}
      }

      const uploaded = await storage.createFile(
        BUCKETS.RESUMES,
        ID.unique(),
        file,
        buildResumePermissions(user),
      );

      setResumeFileId(uploaded.$id);
      setResumeFileName(file.name);

      toast({
        title: "Resume uploaded",
        description: file.name,
      });
    } catch (err: unknown) {
      console.error("Error uploading resume:", err);
      setResumeFileId(null);
      setResumeFileName(null);
      toast({
        title: "Resume upload failed",
        description:
          err instanceof Error ? err.message : "Failed to upload resume",
        variant: "destructive",
      });
    } finally {
      setIsUploadingResume(false);
    }
  };

  const handleRemoveResume = async () => {
    if (!resumeFileId) return;
    try {
      setIsUploadingResume(true);
      await storage.deleteFile(BUCKETS.RESUMES, resumeFileId);
      setResumeFileId(null);
      setResumeFileName(null);
      toast({ title: "Resume removed" });
    } catch (err: unknown) {
      console.error("Error removing resume:", err);
      toast({
        title: "Failed to remove resume",
        description:
          err instanceof Error ? err.message : "Failed to remove resume",
        variant: "destructive",
      });
    } finally {
      setIsUploadingResume(false);
    }
  };

  const handleSubmit = async () => {
    if (!user) return;

    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName.trim();
    const trimmedPhone = phone.trim();
    const trimmedVisaStatus = visaStatus.trim();
    const trimmedLinkedinProfileUrl = linkedinProfileUrl.trim();

    if (!isLinkedinRequestLead) {
      const missingFields = getMissingLeadGenerationFields({
        firstName: trimmedFirstName,
        lastName: trimmedLastName,
        phone: trimmedPhone,
        visaStatus: trimmedVisaStatus,
        linkedinProfileUrl: trimmedLinkedinProfileUrl,
      });

      if (missingFields.length > 0) {
        toast({
          title: "Missing required fields",
          description: `${missingFields.join(", ")} ${
            missingFields.length === 1 ? "is" : "are"
          } required.`,
          variant: "destructive",
        });
        return;
      }
    } else {
      if (!trimmedLinkedinProfileUrl) {
        toast({
          title: "Missing required fields",
          description: `LinkedIn profile link is required.`,
          variant: "destructive",
        });
        return;
      }
    }

    try {
      setIsSaving(true);
      setDuplicateError(null);

      const baseLeadData = buildLeadGenerationLeadData({
        firstName: trimmedFirstName,
        middleName,
        lastName: trimmedLastName,
        email,
        phone: trimmedPhone,
        visaStatus: trimmedVisaStatus,
        linkedinProfileUrl: trimmedLinkedinProfileUrl,
        resumeFileId,
        resumeFileName,
        userId: user.$id,
        userName: user.name,
      });

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

      const leadData = isLinkedinRequestLead
        ? {
            ...baseLeadData,
            status: "Generated",
            linkedinRequestId,
            ...(effectiveLinkedinCompany ? { company: effectiveLinkedinCompany } : {}),
            sourceName: coldCallEnabled ? "Cold Calls" : "LinkedIN/Lead",
            source: coldCallEnabled ? "Cold Calls" : "LinkedIN/Lead",
          }
        : baseLeadData;

      const validation = await validateLeadUniqueness(leadData);
      if (!validation.isValid) {
        const fieldLabel =
          validation.duplicateField === "email"
            ? "email address"
            : validation.duplicateField === "phone"
              ? "phone number"
              : "LinkedIn URL";
        setDuplicateError(`A lead with this ${fieldLabel} already exists.`);
        setIsSaving(false);
        return;
      }

      const branchId =
        user.branchId ||
        (user.branchIds && user.branchIds.length > 0
          ? user.branchIds[0]
          : undefined);

      const created = await createLead(
        user.$id,
        {
          data: leadData,
          status: "Generated",
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
        description: "Lead generated successfully.",
      });

      queryClient.invalidateQueries({ queryKey: queryKeys.leads.all });
      queryClient.invalidateQueries({ queryKey: ['assigned-report'] });

      router.push("/leads");
    } catch (err: unknown) {
      console.error("Error generating lead:", err);
      const parsed = parseLeadActionError(err);
      if (parsed) {
        if (parsed.code === "MISSING_REQUIRED_FIELD") {
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
        if (parsed.code === "DUPLICATE_FIELD" && parsed.field) {
          setDuplicateError(parsed.message);
          setFieldErrors((prev) => ({ ...prev, [parsed.field!]: parsed.message }));
          return;
        }
        if (parsed.field) {
          setFieldErrors((prev) => ({ ...prev, [parsed.field!]: parsed.message }));
          return;
        }
        toast({
          title: "Error",
          description: parsed.message,
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Error",
        description:
          err instanceof Error ? err.message : "Failed to generate lead",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg">Loading...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl">
      <div className="mb-6">
        <Button
          variant="outline"
          onClick={() => router.push("/leads")}
          className="mb-2">
          ← Back to Leads
        </Button>
        <h1 className="text-2xl md:text-3xl font-bold">Generate Lead</h1>
        <p className="text-muted-foreground">
          Add the basic details. Your Team Lead will assign an agent to complete
          the rest.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Basic Lead Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            <span className="text-red-500 font-semibold">*</span> Required
            Fields
          </p>

          {duplicateError && (
            <div className="p-3 text-sm text-red-500 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-md">
              {duplicateError}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="firstName">
                First Name {!isLinkedinRequestLead && <span className="text-red-500">*</span>}
              </Label>
              <input
                id="firstName"
                aria-invalid={Boolean(fieldErrors.firstName)}
                className={`flex h-10 w-full rounded-md border ${
                  fieldErrors.firstName ? "border-red-500" : "border-input"
                } bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
                value={firstName}
                onChange={(e) => {
                  setFirstName(e.target.value);
                  clearFieldError("firstName");
                }}
              />
              {fieldErrors.firstName && (
                <p className="text-sm text-red-500">{fieldErrors.firstName}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="middleName">Middle Name</Label>
              <input
                id="middleName"
                aria-invalid={Boolean(fieldErrors.middleName)}
                className={`flex h-10 w-full rounded-md border ${
                  fieldErrors.middleName ? "border-red-500" : "border-input"
                } bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
                value={middleName}
                onChange={(e) => {
                  setMiddleName(e.target.value);
                  clearFieldError("middleName");
                }}
              />
              {fieldErrors.middleName && (
                <p className="text-sm text-red-500">{fieldErrors.middleName}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="lastName">
                Last Name {!isLinkedinRequestLead && <span className="text-red-500">*</span>}
              </Label>
              <input
                id="lastName"
                aria-invalid={Boolean(fieldErrors.lastName)}
                className={`flex h-10 w-full rounded-md border ${
                  fieldErrors.lastName ? "border-red-500" : "border-input"
                } bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
                value={lastName}
                onChange={(e) => {
                  setLastName(e.target.value);
                  clearFieldError("lastName");
                }}
              />
              {fieldErrors.lastName && (
                <p className="text-sm text-red-500">{fieldErrors.lastName}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email (Optional)</Label>
              <input
                id="email"
                type="email"
                aria-invalid={Boolean(fieldErrors.email)}
                className={`flex h-10 w-full rounded-md border ${
                  fieldErrors.email ? "border-red-500" : "border-input"
                } bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearFieldError("email");
                }}
              />
              {fieldErrors.email && (
                <p className="text-sm text-red-500">{fieldErrors.email}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">
                Phone No. {!isLinkedinRequestLead && <span className="text-red-500">*</span>}
              </Label>
              <input
                id="phone"
                aria-invalid={Boolean(fieldErrors.phone)}
                className={`flex h-10 w-full rounded-md border ${
                  fieldErrors.phone ? "border-red-500" : "border-input"
                } bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  clearFieldError("phone");
                }}
              />
              {fieldErrors.phone && (
                <p className="text-sm text-red-500">{fieldErrors.phone}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="visaStatus">
              Visa Status {!isLinkedinRequestLead && <span className="text-red-500">*</span>}
            </Label>
            <select
              id="visaStatus"
              aria-invalid={Boolean(fieldErrors.visaStatus)}
              className={`flex h-10 w-full rounded-md border ${
                fieldErrors.visaStatus ? "border-red-500" : "border-input"
              } bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
              value={visaStatus}
              onChange={(e) => {
                setVisaStatus(e.target.value);
                clearFieldError("visaStatus");
              }}>
              <option value="">Select visa status</option>
              <option value="Citizen">Citizen</option>
              <option value="GC">GC</option>
              <option value="H1B">H1B</option>
              <option value="OPT">OPT</option>
              <option value="CPT">CPT</option>
              <option value="Other">Other</option>
            </select>
            {fieldErrors.visaStatus && (
              <p className="text-sm text-red-500">{fieldErrors.visaStatus}</p>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="linkedinProfileUrl">
                LinkedIn profile link <span className="text-red-500">*</span>
              </Label>
              <input
                id="linkedinProfileUrl"
                aria-invalid={Boolean(fieldErrors.linkedinProfileUrl)}
                className={`flex h-10 w-full rounded-md border ${
                  fieldErrors.linkedinProfileUrl ? "border-red-500" : "border-input"
                } bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
                value={linkedinProfileUrl}
                onChange={(e) => {
                  setLinkedinProfileUrl(e.target.value);
                  clearFieldError("linkedinProfileUrl");
                }}
              />
              {fieldErrors.linkedinProfileUrl && (
                <p className="text-sm text-red-500">{fieldErrors.linkedinProfileUrl}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="resumeFile">Resume (Optional)</Label>
              <div className="flex items-center gap-2">
                <input
                  id="resumeFile"
                  type="file"
                  accept=".pdf,.doc,.docx"
                  disabled={isUploadingResume || isSaving}
                  className="flex h-10 w-full rounded-md border border-input bg-background pl-3 pr-8 py-2 text-sm text-foreground ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    void handleResumeUpload(file);
                    e.currentTarget.value = "";
                  }}
                />
                {resumeFileId && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isUploadingResume || isSaving}
                    onClick={() => void handleRemoveResume()}>
                    Remove
                  </Button>
                )}
              </div>
              {resumeFileId && (
                <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                  <span className="truncate">
                    {resumeFileName || "Uploaded"}
                  </span>
                  <a
                    className="text-primary hover:underline"
                    href={storage
                      .getFileView(BUCKETS.RESUMES, resumeFileId)
                      .toString()}
                    target="_blank"
                    rel="noreferrer">
                    View
                  </a>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleSubmit}
              loading={isSaving}
              disabled={isUploadingResume}>
              Generate Lead
            </Button>
            <Button variant="outline" onClick={() => router.push("/settings")}>
              Profile Settings
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
