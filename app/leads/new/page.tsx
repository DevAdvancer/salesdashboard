"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/contexts/auth-context";
import { useRouter } from "next/navigation";
import { createLeadAction } from "@/app/actions/lead";
import { validateLeadUniqueness } from "@/lib/services/lead-validator";
import { listBranches } from "@/lib/services/branch-service";
import { getFormConfig } from "@/lib/services/form-config-service";
import { FormField, Branch } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DynamicLeadForm } from "@/components/dynamic-lead-form";
import { useToast } from "@/components/ui/use-toast";
import { ProtectedRoute } from "@/components/protected-route";
import { ID, Permission, Role } from "appwrite";
import { storage } from "@/lib/appwrite";
import { BUCKETS } from "@/lib/constants/appwrite";

export default function NewLeadPage() {
  return (
    <ProtectedRoute componentKey="leads">
      <NewLeadContent />
    </ProtectedRoute>
  );
}

function NewLeadContent() {
  const { user } = useAuth();

  if (user?.role === "lead_generation") {
    return <LeadGenerationNewLeadContent />;
  }

  return <LegacyNewLeadContent />;
}

function LeadGenerationNewLeadContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState("");
  const [visaStatus, setVisaStatus] = useState("");
  const [linkedinId, setLinkedinId] = useState("");
  const [resumeFileId, setResumeFileId] = useState<string | null>(null);
  const [resumeFileName, setResumeFileName] = useState<string | null>(null);
  const [isUploadingResume, setIsUploadingResume] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [authLoading, router, user]);

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
        [
          Permission.read(Role.users()),
          Permission.update(Role.user(user.$id)),
          Permission.delete(Role.user(user.$id)),
        ],
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

    if (
      !trimmedFirstName ||
      !trimmedLastName ||
      !trimmedPhone ||
      !trimmedVisaStatus
    ) {
      toast({
        title: "Missing required fields",
        description:
          "First Name, Last Name, Phone No., and Visa Status are required.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsSaving(true);
      setDuplicateError(null);

      const leadData = {
        firstName: trimmedFirstName,
        middleName: middleName.trim() || undefined,
        lastName: trimmedLastName,
        email: email.trim() || undefined,
        phone: trimmedPhone,
        visaStatus: trimmedVisaStatus,
        sourceName: "LinkedIN/Lead",
        source: "LinkedIN/Lead",
        generatedById: user.$id,
        generatedByName: user.name,
        linkedinId: linkedinId.trim() || undefined,
        resumeFileId: resumeFileId || undefined,
        resumeFileName: resumeFileName || undefined,
      };

      const validation = await validateLeadUniqueness(leadData);
      if (!validation.isValid) {
        setDuplicateError("A lead with this phone number already exists.");
        setIsSaving(false);
        return;
      }

      const branchId =
        user.branchId ||
        (user.branchIds && user.branchIds.length > 0
          ? user.branchIds[0]
          : undefined);

      await createLeadAction(
        user.$id,
        {
          data: leadData,
          status: "Generated",
          branchId,
        },
        user.$id,
        user.name,
      );

      toast({
        title: "Success",
        description: "Lead generated successfully.",
      });

      router.push("/leads");
    } catch (err: unknown) {
      console.error("Error generating lead:", err);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to generate lead",
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
          {duplicateError && (
            <div className="p-3 text-sm text-red-500 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-md">
              {duplicateError}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name *</Label>
              <input
                id="firstName"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="middleName">Middle Name</Label>
              <input
                id="middleName"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={middleName}
                onChange={(e) => setMiddleName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name *</Label>
              <input
                id="lastName"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email (Optional)</Label>
              <input
                id="email"
                type="email"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone No. *</Label>
              <input
                id="phone"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="visaStatus">Visa Status *</Label>
            <select
              id="visaStatus"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={visaStatus}
              onChange={(e) => setVisaStatus(e.target.value)}>
              <option value="">Select visa status</option>
              <option value="Citizen">Citizen</option>
              <option value="GC">GC</option>
              <option value="H1B">H1B</option>
              <option value="OPT">OPT</option>
              <option value="CPT">CPT</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="linkedinId">LinkedIn ID</Label>
              <input
                id="linkedinId"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={linkedinId}
                onChange={(e) => setLinkedinId(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="resumeFile">Resume (Optional)</Label>
              <div className="flex items-center gap-2">
                <input
                  id="resumeFile"
                  type="file"
                  accept=".pdf,.doc,.docx"
                  disabled={isUploadingResume || isSaving}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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

function LegacyNewLeadContent() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

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
  }, [user, authLoading, router]);

  const loadFormConfig = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const config = await getFormConfig();
      const fields = config.fields;
      setFormFields(fields.sort((a, b) => a.order - b.order));
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

      // Validate lead uniqueness before creating
      const validation = await validateLeadUniqueness(data);
      if (!validation.isValid) {
        const fieldLabel =
          validation.duplicateField === "email"
            ? "email address"
            : "phone number";
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

      // Auto-assign to creator if no one is selected
      const finalAssignedToId = assignedToId || user.$id;

      // Create lead with auto-set owner and assigned agent (defaults to creator)
      await createLeadAction(
        user.$id,
        {
          data: sanitizedData,
          assignedToId: finalAssignedToId,
          status: sanitizedData.status || "Interested",
          branchId,
        },
        user.$id,
        user.name,
      );

      toast({
        title: "Success",
        description: "Lead created successfully",
      });

      router.push("/leads");
    } catch (err: any) {
      console.error("Error creating lead:", err);
      toast({
        title: "Error",
        description: err.message || "Failed to create lead",
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
            <div className="mb-6 p-3 text-sm text-red-500 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-md">
              {duplicateError}
            </div>
          )}

          {/* Branch Selector (Admin Only) */}
          {isAdmin && branches.length > 0 && (
            <div className="mb-6 pb-6 border-b">
              <Label htmlFor="branch">Branch</Label>
              <select
                id="branch"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 mt-2"
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
            formConfig={formFields}
            onSubmit={handleSubmit}
            submitLabel="Create Lead"
            isLoading={isSaving}
          />
        </CardContent>
      </Card>
    </div>
  );
}
