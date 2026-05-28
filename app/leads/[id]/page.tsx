"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/contexts/auth-context";
import { useRouter, useParams } from "next/navigation";
import { getLead, updateLead, closeLead } from "@/lib/services/lead-service";
import { sendChatMessageAction } from "@/app/actions/chat";
import {
  assignLead,
  backoutLead,
  clearLeadReadCache,
  reopenLead,
} from "@/lib/services/lead-action-service";
import {
  getAgentsByManager,
  getAgentsByTeamLead,
} from "@/lib/services/user-service";
import { getFormConfig } from "@/lib/services/form-config-service";
import { Lead, User, FormField, LeadData, LeadDataValue } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { ProtectedRoute } from "@/components/protected-route";
import { LeadActivityTimeline } from "@/components/leads/lead-activity-timeline";
import { LeadFollowUpCard } from "@/components/leads/lead-follow-up-card";
import { LeadNotesCard } from "@/components/leads/lead-notes-card";
import { storage } from "@/lib/appwrite";
import { BUCKETS } from "@/lib/constants/appwrite";

function isBackoutStatus(value: unknown) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!text) return false;
  return (
    text === "backout" ||
    text === "backedout" ||
    text === "backed out" ||
    text === "back out" ||
    text.replace(/\s+/g, "") === "backedout" ||
    text.replace(/\s+/g, "") === "backout"
  );
}

export default function LeadDetailPage() {
  return (
    <ProtectedRoute componentKey="leads">
      <LeadDetailContent />
    </ProtectedRoute>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function LeadDetailContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const { toast } = useToast();
  const leadId = params.id as string;

  const [lead, setLead] = useState<Lead | null>(null);
  const [leadData, setLeadData] = useState<LeadData>({});
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [agents, setAgents] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [closeStatus, setCloseStatus] = useState("Closed");

  const loadLead = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const fetchedLead = await getLead(leadId);
      setLead(fetchedLead);
      setLeadData(JSON.parse(fetchedLead.data));
    } catch (err: unknown) {
      console.error("Error loading lead:", err);
      setError(getErrorMessage(err, "Failed to load lead"));
    } finally {
      setIsLoading(false);
    }
  }, [leadId]);

  const loadFormConfig = useCallback(async () => {
    try {
      const config = await getFormConfig();
      const fields = config.fields;
      setFormFields(fields.sort((a, b) => a.order - b.order));
    } catch (err: unknown) {
      console.error("Error loading form config:", err);
    }
  }, []);

  const loadAgents = useCallback(async () => {
    if (!user) return;

    try {
      if (user.role !== "manager" && user.role !== "team_lead") return;

      const fetchedAgents =
        user.role === "manager"
          ? await getAgentsByManager(user.$id)
          : await getAgentsByTeamLead(user.$id);
      setAgents(fetchedAgents);
    } catch (err: unknown) {
      console.error("Error loading agents:", err);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
      return;
    }

    if (user && leadId) {
      loadLead();
      loadFormConfig();
      if (user.role === "manager" || user.role === "team_lead") {
        loadAgents();
      }
    }
  }, [user, authLoading, leadId, router, loadLead, loadFormConfig, loadAgents]);

  const handleSave = async () => {
    if (!lead || !user) return;

    try {
      setIsSaving(true);
      await updateLead(leadId, leadData, user.$id, user.name);
      if (isBackoutStatus((leadData as any).status)) {
        await backoutLead(leadId, user.$id, user.name);
        toast({
          title: "Success",
          description: "Lead marked as Backout",
        });
        setIsEditing(false);
        await loadLead();
        router.push("/leads");
        return;
      }
      clearLeadReadCache();
      toast({
        title: "Success",
        description: "Lead updated successfully",
      });
      await loadLead();
    } catch (err: unknown) {
      console.error("Error saving lead:", err);
      toast({
        title: "Error",
        description: getErrorMessage(err, "Failed to save lead"),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCloseLead = async () => {
    if (!lead || !user) return;

    try {
      setIsSaving(true);
      if (isBackoutStatus(closeStatus)) {
        await backoutLead(leadId, user.$id, user.name);
        toast({
          title: "Success",
          description: "Lead marked as Backout",
        });
        setShowCloseDialog(false);
        router.push("/leads");
        return;
      }
      await closeLead(leadId, closeStatus, user.$id, user.name);
      clearLeadReadCache();
      try {
        const firstName =
          typeof leadData.firstName === "string" ? leadData.firstName : "";
        const lastName =
          typeof leadData.lastName === "string" ? leadData.lastName : "";
        const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
        const fallback =
          leadData.legalName ??
          leadData.name ??
          leadData.company ??
          leadData.email ??
          leadData.phone;
        const leadName =
          fullName || (typeof fallback === "string" ? fallback : "");

        await sendChatMessageAction({
          currentUserId: user.$id,
          channel: "general",
          body: leadName
            ? `Congratulations ${user.name} for closing ${leadName}!`
            : `Congratulations ${user.name} for closing a lead!`,
        });
      } catch {}
      toast({
        title: "Success",
        description: "Lead closed successfully",
      });
      setShowCloseDialog(false);
      router.push("/leads");
    } catch (err: unknown) {
      console.error("Error closing lead:", err);
      toast({
        title: "Error",
        description: getErrorMessage(err, "Failed to close lead"),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReopenLead = async () => {
    if (!lead || !user) return;

    try {
      setIsSaving(true);
      await reopenLead(leadId, user.$id, user.name);
      toast({
        title: "Success",
        description: "Lead reopened successfully",
      });
      await loadLead();
    } catch (err: unknown) {
      console.error("Error reopening lead:", err);
      toast({
        title: "Error",
        description: getErrorMessage(err, "Failed to reopen lead"),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAssignAgent = async (agentId: string) => {
    if (!lead || !user) return;

    try {
      await assignLead(leadId, agentId, user.$id, user.name);
      toast({
        title: "Success",
        description: "Lead assigned successfully",
      });
      await loadLead();
    } catch (err: unknown) {
      console.error("Error assigning lead:", err);
      toast({
        title: "Error",
        description: getErrorMessage(err, "Failed to assign lead"),
        variant: "destructive",
      });
    }
  };

  const handleFieldChange = (key: string, value: LeadDataValue) => {
    setLeadData((prev) => ({ ...prev, [key]: value }));
  };

  const renderField = (field: FormField) => {
    const value = String(leadData[field.key] ?? "");
    const isReadOnly = !isEditing || lead?.isClosed;

    switch (field.type) {
      case "textarea":
        return (
          <textarea
            id={field.key}
            className="w-full min-h-[100px] px-3 py-2 rounded-md border border-input bg-background text-foreground"
            value={value}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            disabled={isReadOnly}
            placeholder={field.placeholder}
          />
        );

      case "dropdown":
        return (
          <select
            id={field.key}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={value}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            disabled={isReadOnly}>
            <option value="">Select {field.label}</option>
            {field.options?.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        );

      default:
        return (
          <Input
            id={field.key}
            type={field.type}
            value={value}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            disabled={isReadOnly}
            placeholder={field.placeholder}
          />
        );
    }
  };

  if (authLoading || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg">Loading lead...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (error || !lead) {
    return (
      <div className="container mx-auto">
        <Card className="border-red-500">
          <CardHeader>
            <CardTitle className="text-red-500">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p>{error || "Lead not found"}</p>
            <Button onClick={() => router.push("/leads")} className="mt-4">
              Back to Leads
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const leadGenerationVisibleKeys = new Set([
    "firstName",
    "middleName",
    "lastName",
    "email",
    "phone",
    "visaStatus",
    "linkedinId",
  ]);

  const isLeadGeneration = user.role === "lead_generation";
  const headerFirstName =
    typeof leadData.firstName === "string" ? leadData.firstName : "";
  const headerLastName =
    typeof leadData.lastName === "string" ? leadData.lastName : "";
  const resumeFileId =
    typeof leadData.resumeFileId === "string" ? leadData.resumeFileId : "";
  const resumeFileName =
    typeof leadData.resumeFileName === "string" ? leadData.resumeFileName : "";

  return (
    <div className="container mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div id="tour-lead-header">
          <Button
            variant="outline"
            onClick={() => router.push("/leads")}
            className="mb-2">
            ← Back to Leads
          </Button>
          <h1 className="text-2xl md:text-3xl font-bold">
            {headerFirstName} {headerLastName}
          </h1>
          <p className="text-muted-foreground mt-1">
            {lead.isClosed ? "Closed Lead" : "Active Lead"}
          </p>
        </div>
        <div id="tour-lead-actions" className="flex flex-wrap gap-2">
          {!lead.isClosed && (
            <>
              {!isEditing ? (
                <>
                  <Button onClick={() => setIsEditing(true)}>Edit</Button>
                  {!isLeadGeneration && (
                    <Button
                      variant="destructive"
                      onClick={() => setShowCloseDialog(true)}>
                      Close Lead
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? "Saving..." : "Save"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsEditing(false);
                      setLeadData(JSON.parse(lead.data));
                    }}>
                    Cancel
                  </Button>
                </>
              )}
            </>
          )}
          {lead.isClosed &&
            (user?.role === "manager" ||
              user?.role === "admin" ||
              user?.role === "team_lead") && (
              <>
                {isBackoutStatus(lead.status) && (
                  <Button
                    variant="destructive"
                    onClick={async () => {
                      if (!user) return;
                      try {
                        setIsSaving(true);
                        await backoutLead(leadId, user.$id, user.name);
                        toast({
                          title: "Success",
                          description: "Backout rules applied",
                        });
                        await loadLead();
                      } catch (err: unknown) {
                        toast({
                          title: "Error",
                          description: getErrorMessage(err, "Failed to apply Backout"),
                          variant: "destructive",
                        });
                      } finally {
                        setIsSaving(false);
                      }
                    }}
                    disabled={isSaving}
                  >
                    {isSaving ? "Applying..." : "Apply Backout"}
                  </Button>
                )}
                <Button onClick={handleReopenLead} disabled={isSaving}>
                  {isSaving ? "Reopening..." : "Reopen Lead"}
                </Button>
              </>
            )}
        </div>
      </div>

      <div className="grid gap-6">
        {/* Lead Information */}
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
              {formFields
                .filter((field) => {
                  if (isLeadGeneration) {
                    return leadGenerationVisibleKeys.has(field.key);
                  }
                  return user.role === "manager" || field.visible;
                })
                .map((field) => (
                  <div key={field.id}>
                    <Label htmlFor={field.key}>
                      {field.label}
                      {field.required && (
                        <span className="text-red-500 ml-1">*</span>
                      )}
                    </Label>
                    {renderField(field)}
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>

        {/* Assignment Section (Manager Only) */}
        {(user?.role === "manager" || user?.role === "team_lead") && (
          <Card id="tour-lead-assignment">
            <CardHeader>
              <CardTitle>Assignment</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="assignedTo">Assigned To</Label>
                  <select
                    id="assignedTo"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    value={lead.assignedToId || ""}
                    onChange={(e) => handleAssignAgent(e.target.value)}
                    disabled={lead.isClosed}>
                    <option value="">Unassigned</option>
                    {agents.map((agent) => (
                      <option key={agent.$id} value={agent.$id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Status</Label>
                  <p className="text-sm text-muted-foreground mt-2">
                    <span className="inline-block px-3 py-1 rounded-full bg-primary/10 text-primary">
                      {lead.status}
                    </span>
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {!isLeadGeneration && (
          <div id="tour-lead-followup">
            <LeadFollowUpCard
              lead={lead}
              user={user}
              disabled={lead.isClosed}
              onUpdated={loadLead}
            />
          </div>
        )}

        {user && (
          <div id="tour-lead-notes">
            <LeadNotesCard leadId={lead.$id} user={user} />
          </div>
        )}

        <div id="tour-lead-timeline">
          <LeadActivityTimeline lead={lead} />
        </div>

        {/* Metadata */}
        <Card>
          <CardHeader>
            <CardTitle>Metadata</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <Label>Created</Label>
                <p className="text-muted-foreground">
                  {lead.$createdAt
                    ? new Date(lead.$createdAt).toLocaleString()
                    : "N/A"}
                </p>
              </div>
              <div>
                <Label>Last Updated</Label>
                <p className="text-muted-foreground">
                  {lead.$updatedAt
                    ? new Date(lead.$updatedAt).toLocaleString()
                    : "N/A"}
                </p>
              </div>
              {lead.closedAt && (
                <div>
                  <Label>Closed At</Label>
                  <p className="text-muted-foreground">
                    {new Date(lead.closedAt).toLocaleString()}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Close Lead Dialog */}
      {showCloseDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <Card className="w-full sm:max-w-md sm:mx-4 rounded-b-none sm:rounded-b-lg">
            <CardHeader>
              <CardTitle>Close Lead</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4">Are you sure you want to close this lead?</p>
              <div className="mb-4">
                <Label htmlFor="closeStatus">Final Status</Label>
                <select
                  id="closeStatus"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={closeStatus}
                  onChange={(e) => setCloseStatus(e.target.value)}>
                  <option value="Closed">Closed</option>
                  <option value="Won">Won</option>
                  <option value="Lost">Lost</option>
                  <option value="Rejected">Rejected</option>
                  <option value="Backed Out">Backed Out</option>
                </select>
              </div>
              <div className="flex flex-col-reverse sm:flex-row gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowCloseDialog(false)}
                  className="w-full sm:w-auto">
                  Cancel
                </Button>
                <Button
                  onClick={handleCloseLead}
                  disabled={isSaving}
                  variant="destructive"
                  className="w-full sm:w-auto">
                  {isSaving ? "Closing..." : "Close Lead"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
