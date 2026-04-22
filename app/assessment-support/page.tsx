"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/contexts/auth-context";
import { listLeads } from "@/lib/services/lead-service";
import { getSupportRequestCcEmails } from "@/lib/services/user-service";
import type { Lead } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { TableSkeleton } from "@/components/ui/skeleton";
import { handleError } from "@/lib/utils/error-handler";
import { useToast } from "@/components/ui/use-toast";
import { ProtectedRoute } from "@/components/protected-route";
import { AlertCircle } from "lucide-react";
import { getAssessmentAttempts, recordAssessmentAttempt, checkDuplicateSubject } from "@/app/actions/assessment";
import { useDebounce } from "@/lib/hooks/use-debounce";

interface AssessmentFormData {
  to: string;
  cc: string;
  assessmentReceived: string; // ISO string from datetime-local input
  candidateName: string;
  technology: string;
  emailId: string;
  contactNumber: string;
  endClient: string;
  jobTitle: string;
  assessmentDuration: string;
  resume: File | null;
  additionalAttachment: File | null;
  jobDescription: string;
  // Signature fields
  yourName: string;
  yourRole: string;
  yourPhone: string;
  company: "Silverspace Inc." | "Vizva Consultancy";
}

const INITIAL_FORM_DATA: AssessmentFormData = {
  to: "tech.leaders@silverspaceinc.com",
  // to: "prateek.narvariya@silverspaceinc.com",
  cc: "",
  assessmentReceived: "",
  candidateName: "",
  technology: "",
  emailId: "",
  contactNumber: "",
  endClient: "",
  jobTitle: "",
  assessmentDuration: "",
  resume: null,
  additionalAttachment: null,
  jobDescription: "",
  yourName: "",
  yourRole: "",
  yourPhone: "",
  company: "Silverspace Inc.",
};

interface AssessmentAttempt {
  $id: string;
  leadId: string;
  userId: string;
  attemptCount: number;
  lastAttemptAt: string;
  sentSubjects: string[];
}

function AssessmentContent() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [filteredLeads, setFilteredLeads] = useState<Lead[]>([]);
  const [filter, setFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 500);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState<AssessmentFormData>(INITIAL_FORM_DATA);
  const [isSending, setIsSending] = useState(false);
  const [isOutlookConnected, setIsOutlookConnected] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  // Assessment Attempts State
  const [assessmentAttempts, setAssessmentAttempts] = useState<Map<string, AssessmentAttempt>>(
    new Map(),
  );
  const [loadingAttempts, setLoadingAttempts] = useState(false);

  const handleConnectOutlook = async () => {
    window.location.href = "/api/auth/login";
  };

  // Check for existing connection status
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const response = await fetch("/api/auth/status");
        const data = await response.json();
        setIsOutlookConnected(data.connected);
      } catch (error) {
        console.error("Failed to check connection status", error);
      }
    };

    checkConnection();

    // Load signature preferences
    const storedSignature = localStorage.getItem("assessmentSignature");
    if (storedSignature) {
      const parsed = JSON.parse(storedSignature);
      setFormData((prev) => ({
        ...prev,
        yourName: parsed.yourName || "",
        yourRole: parsed.yourRole || "",
        yourPhone: parsed.yourPhone || "",
        company: parsed.company || "Silverspace Inc.",
      }));
    } else {
      // Fallback: try to load from mock signature
      const mockSignature = localStorage.getItem("mockSignature");
      if (mockSignature) {
        const parsed = JSON.parse(mockSignature);
        setFormData((prev) => ({
          ...prev,
          yourName: parsed.yourName || "",
          yourRole: parsed.yourRole || "",
          yourPhone: parsed.yourPhone || "",
          company: parsed.company || "Silverspace Inc.",
        }));
      }
    }
  }, []);

  const loadAssessmentAttempts = useCallback(
    async (leadIds: string[]) => {
      if (!leadIds.length || !user) return;

      try {
        setLoadingAttempts(true);
        const attempts = await getAssessmentAttempts(user.$id, leadIds);

        setAssessmentAttempts((prev) => {
          const newMap = new Map(prev);
          let hasChanges = false;

          attempts.forEach((doc: any) => {
            const existing = newMap.get(doc.leadId);
            if (
              !existing ||
              existing.attemptCount !== doc.attemptCount ||
              existing.lastAttemptAt !== doc.lastAttemptAt
            ) {
              newMap.set(doc.leadId, {
                $id: doc.$id,
                leadId: doc.leadId,
                userId: doc.userId,
                attemptCount: doc.attemptCount,
                lastAttemptAt: doc.lastAttemptAt,
                sentSubjects: doc.sentSubjects || [],
              });
              hasChanges = true;
            }
          });

          return hasChanges ? newMap : prev;
        });
      } catch (err) {
        console.error("Error loading assessment attempts:", err);
      } finally {
        setLoadingAttempts(false);
      }
    },
    [user],
  );

  const loadLeads = useCallback(async () => {
    if (!user) return;

    try {
      setIsLoading(true);
      const fetchedLeads = await listLeads(
        {},
        user.$id,
        user.role,
        user.branchIds,
      );
      setLeads(fetchedLeads);
      setFilteredLeads(fetchedLeads);
    } catch (err) {
      handleError(err as Error, {
        title: "Failed to Load Leads",
        showToast: true,
      });
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadLeads();
    }
  }, [user, loadLeads]);

  // Load attempts for current page (always)
  useEffect(() => {
    if (filteredLeads.length > 0) {
      const pageLeads = filteredLeads.slice(
        (currentPage - 1) * ITEMS_PER_PAGE,
        currentPage * ITEMS_PER_PAGE,
      );
      const leadIds = pageLeads.map((l) => l.$id);
      loadAssessmentAttempts(leadIds);
    }
  }, [filteredLeads, currentPage, loadAssessmentAttempts]);

  // When a status filter is active, eagerly load attempts for ALL leads
  useEffect(() => {
    if (filter !== "all" && leads.length > 0 && user) {
      const allLeadIds = leads.map((l) => l.$id);
      loadAssessmentAttempts(allLeadIds);
    }
  }, [filter, leads, user, loadAssessmentAttempts]);

  useEffect(() => {
    let result = leads;

    if (filter === "assessment_created") {
      result = result.filter((lead) => {
        const attempt = assessmentAttempts.get(lead.$id);
        return attempt && attempt.attemptCount > 0;
      });
    } else if (filter === "assessment_not_created") {
      result = result.filter((lead) => {
        const attempt = assessmentAttempts.get(lead.$id);
        return !attempt || attempt.attemptCount === 0;
      });
    }

    if (debouncedSearchQuery) {
      const lowerQuery = debouncedSearchQuery.toLowerCase();
      result = result.filter((lead) => {
        const data = JSON.parse(lead.data);
        return (
          data.firstName?.toLowerCase().includes(lowerQuery) ||
          data.lastName?.toLowerCase().includes(lowerQuery) ||
          data.email?.toLowerCase().includes(lowerQuery) ||
          data.phone?.includes(lowerQuery) ||
          data.company?.toLowerCase().includes(lowerQuery)
        );
      });
    }

    setFilteredLeads(result);
  }, [leads, filter, debouncedSearchQuery, assessmentAttempts]);

  // Reset file input keys to force re-render and clear files
  const [resumeInputKey, setResumeInputKey] = useState(Date.now());
  const [additionalInputKey, setAdditionalInputKey] = useState(Date.now() + 1);

  const [isPreparingAssessment, setIsPreparingAssessment] = useState(false);


  // Multiple assessments are always allowed; duplicates are checked by subject
  const canCreateAssessment = (_leadId: string) => {
    return true;
  };

  const handleCreateAssessment = async (lead: Lead) => {
    if (!canCreateAssessment(lead.$id)) {
      toast({
        title: "Already Sent",
        description: "Assessment support has already been sent for this lead.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsPreparingAssessment(true);
      setSelectedLead(lead);

      const leadData = JSON.parse(lead.data);

      // Reset form data but keep signature preferences
      setFormData((prev) => ({
        ...INITIAL_FORM_DATA,
        yourName: prev.yourName,
        yourRole: prev.yourRole,
        yourPhone: prev.yourPhone,
        company: prev.company,
        // Pre-fill from lead data
        candidateName: `${leadData.firstName || ""} ${leadData.lastName || ""}`.trim(),
        emailId: leadData.email || "",
        contactNumber: leadData.phone || "",
        endClient: leadData.company || "",
      }));
      setResumeInputKey(Date.now());
      setAdditionalInputKey(Date.now() + 1);

      const currentUser = user;
      if (!currentUser) return;

      try {
        const ccEmails = await getSupportRequestCcEmails(currentUser);
        const uniqueCC = Array.from(new Set(ccEmails));

        setFormData((prev) => ({
          ...prev,
          cc: uniqueCC.join(", "),
        }));
      } catch (err) {
        console.error("Failed to fetch CC users:", err);
      }

      setIsModalOpen(true);
    } catch (error) {
      console.error("Error preparing assessment:", error);
      toast({
        title: "Error",
        description: "Failed to prepare assessment support form.",
        variant: "destructive",
      });
    } finally {
      setIsPreparingAssessment(false);
    }
  };

  const handleFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    field: "resume" | "additionalAttachment",
  ) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size > 4 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "File must be less than 4MB.",
          variant: "destructive",
        });
        e.target.value = "";
        return;
      }
      setFormData({ ...formData, [field]: file });
    }
  };

  const formatScheduleEST = (isoString: string) => {
    if (!isoString) return "";
    const date = new Date(isoString);
    const datePart = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
    const timePart = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "numeric",
      hour12: true,
    }).format(date);
    return `${datePart} at ${timePart} EST`;
  };

  // Build the live subject line for real-time preview
  const liveSubject = `Sales Assessment Support - ${formData.candidateName || '...'} - ${formData.jobTitle || '...'} - ${formData.assessmentReceived ? formatScheduleEST(formData.assessmentReceived) : '...'}`;

  const sendEmail = async () => {
    if (!isOutlookConnected) {
      toast({
        title: "Authentication Required",
        description: "Please connect to Outlook first.",
        variant: "destructive",
      });
      return;
    }

    if (!selectedLead) return;

    // Validate required fields
    if (!formData.assessmentReceived) {
      toast({
        title: "Missing Field",
        description: "Please select Assessment Received date/time.",
        variant: "destructive",
      });
      return;
    }

    if (!formData.candidateName.trim()) {
      toast({
        title: "Missing Field",
        description: "Candidate Name is required.",
        variant: "destructive",
      });
      return;
    }

    if (!formData.jobTitle.trim()) {
      toast({
        title: "Missing Field",
        description: "Job Title is required.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsSending(true);

      // Save signature preferences
      localStorage.setItem(
        "assessmentSignature",
        JSON.stringify({
          yourName: formData.yourName,
          yourRole: formData.yourRole,
          yourPhone: formData.yourPhone,
          company: formData.company,
        }),
      );

      // Convert files to base64
      const fileToBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            const base64 = result.split(",")[1];
            resolve(base64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      };

      const attachments: any[] = [];

      if (formData.resume) {
        const base64Content = await fileToBase64(formData.resume);
        attachments.push({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: formData.resume.name,
          contentType: formData.resume.type,
          contentBytes: base64Content,
        });
      }

      if (formData.additionalAttachment) {
        const base64Content = await fileToBase64(formData.additionalAttachment);
        attachments.push({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: formData.additionalAttachment.name,
          contentType: formData.additionalAttachment.type,
          contentBytes: base64Content,
        });
      }

      // Format Assessment Received
      const formattedReceived = formatScheduleEST(formData.assessmentReceived);

      // Subject line
      const subject = `Sales Assessment Support - ${formData.candidateName} - ${formData.jobTitle} - ${formattedReceived}`;

      // Check for duplicate subject before sending
      const isDuplicate = await checkDuplicateSubject(selectedLead.$id, subject);
      if (isDuplicate) {
        toast({
          title: "Duplicate Assessment",
          description: "An assessment with this exact subject has already been sent for this candidate. Please change the candidate name, job title, or received date to avoid a duplicate.",
          variant: "destructive",
        });
        setIsSending(false);
        return;
      }

      // Determine logo URL and website based on company
      let logoUrl =
        "https://egvjgtfjstxgszpzvvbx.supabase.co/storage/v1/object/public/images//20250610_1111_3D%20Gradient%20Logo_remix_01jxd69dc9ex29jbj9r701yjkf%20(2).png";
      let websiteUrl = "www.silverspaceinc.com";
      let websiteLink = "https://www.silverspaceinc.com";

      if (formData.company === "Vizva Consultancy") {
        logoUrl =
          "https://egvjgtfjstxgszpzvvbx.supabase.co/storage/v1/object/public/images//20250611_1634_3D%20Logo%20Design_remix_01jxgb3x1qebfa2hsxw7sdagw1%20(1).png";
        websiteUrl = "vizvaconsultancyservices.com";
        websiteLink = "https://vizvaconsultancyservices.com/";
      }

      // Job Description section
      const jdSection = formData.jobDescription.trim()
        ? `<p style="margin-top: 20px;"><strong style="font-size: 14px;">Job Description</strong></p>
           <p style="white-space: pre-wrap;">${formData.jobDescription.replace(/\n/g, "<br/>")}</p>`
        : `<p style="margin-top: 20px;"><strong style="font-size: 14px;">Job Description</strong></p>
           <p style="color: #888;">JD Not Available</p>`;

      // Construct email body - table format matching the screenshot
      const emailBody = `
        <html>
          <body style="font-family: Arial, sans-serif; color: #333;">
            <p>Requested by <strong>${formData.yourName || "Team"}</strong></p>
            <p>Assessment support request details:</p>

            <table cellpadding="8" cellspacing="0" border="0" style="width: 100%; max-width: 600px; margin-top: 10px; border-collapse: collapse;">
              <tr>
                <td style="font-weight: bold; width: 200px; padding: 8px 12px; background-color: #4a6741; color: #fff; border: 1px solid #555;">Assessment Received (EST)</td>
                <td style="padding: 8px 12px; background-color: #c5a832; color: #000; font-weight: bold; border: 1px solid #555;">${formattedReceived}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; padding: 8px 12px; background-color: #2a2a2a; color: #ccc; border: 1px solid #555;">Candidate Name</td>
                <td style="padding: 8px 12px; background-color: #1a1a1a; color: #ddd; border: 1px solid #555;">${formData.candidateName}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; padding: 8px 12px; background-color: #2a2a2a; color: #ccc; border: 1px solid #555;">Technology</td>
                <td style="padding: 8px 12px; background-color: #1a1a1a; color: #ddd; border: 1px solid #555;">${formData.technology}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; padding: 8px 12px; background-color: #2a2a2a; color: #ccc; border: 1px solid #555;">Email ID</td>
                <td style="padding: 8px 12px; background-color: #1a1a1a; color: #ddd; border: 1px solid #555;">${formData.emailId}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; padding: 8px 12px; background-color: #2a2a2a; color: #ccc; border: 1px solid #555;">Contact Number</td>
                <td style="padding: 8px 12px; background-color: #1a1a1a; color: #ddd; border: 1px solid #555;">${formData.contactNumber}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; padding: 8px 12px; background-color: #2a2a2a; color: #ccc; border: 1px solid #555;">End Client</td>
                <td style="padding: 8px 12px; background-color: #1a1a1a; color: #ddd; border: 1px solid #555;">${formData.endClient}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; padding: 8px 12px; background-color: #2a2a2a; color: #ccc; border: 1px solid #555;">Job Title</td>
                <td style="padding: 8px 12px; background-color: #1a1a1a; color: #ddd; border: 1px solid #555;">${formData.jobTitle}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; padding: 8px 12px; background-color: #2a2a2a; color: #ccc; border: 1px solid #555;">Assessment Duration</td>
                <td style="padding: 8px 12px; background-color: #1a1a1a; color: #ddd; border: 1px solid #555;">${formData.assessmentDuration}</td>
              </tr>
            </table>

            ${jdSection}

            <br/>
            <p>Regards,</p>

            <table cellpadding="0" cellspacing="0" border="0" style="font-family: Arial, sans-serif; font-size: 14px; color: rgb(255, 255, 255); background-color: #1a1a1a; padding: 10px; border-radius: 5px;"><tbody><tr><td style="padding-right: 20px;"><div style="filter: drop-shadow(rgba(255, 255, 255, 0.8) 0px 0px 4px) drop-shadow(rgba(255, 255, 255, 0.4) 0px 0px 20px); padding: 4px;"><img src="${logoUrl}" alt="${formData.company} logo" width="130" style="display: block; max-width: 100%; height: auto;"></div></td><td style="border-left: 2px solid rgb(248, 98, 149); padding-left: 20px;"><strong style="font-size: 18px; color: rgb(255, 255, 255); display: block; margin-bottom: 4px;">${formData.yourName}</strong><span style="display: block; margin-bottom: 2px; color: rgb(255, 255, 255);">${formData.yourRole}</span><span style="color: rgb(204, 204, 204); display: block; margin-bottom: 12px;">${formData.company}</span><a href="mailto:${formData.yourName.toLowerCase().replace(/\s+/g, ".")}@silverspaceinc.com" style="color: rgb(255, 255, 255); text-decoration: none; display: block; margin-bottom: 4px;">📧 ${formData.yourName.toLowerCase().replace(/\s+/g, ".")}@silverspaceinc.com</a><a href="tel:${formData.yourPhone}" style="color: rgb(255, 255, 255); text-decoration: none; display: block; margin-bottom: 4px;">📞 ${formData.yourPhone}</a><a href="${websiteLink}" target="_blank" style="color: rgb(255, 255, 255); text-decoration: none; display: block;">🔗 ${websiteUrl}</a></td></tr></tbody></table>
          </body>
        </html>
      `;

      // Construct payload for our API
      const payload = {
        message: {
          subject,
          body: {
            contentType: "HTML",
            content: emailBody,
          },
          toRecipients: formData.to
            .split(",")
            .map((email) => ({
              emailAddress: { address: email.trim() },
            }))
            .filter((r) => r.emailAddress.address),
          ccRecipients: formData.cc
            .split(",")
            .map((email) => ({
              emailAddress: { address: email.trim() },
            }))
            .filter((r) => r.emailAddress.address),
          attachments,
        },
        saveToSentItems: "true",
      };

      // Send via our server-side API
      const response = await fetch("/api/assessment/send-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to send email");
      }

      // Record assessment attempt with subject for duplicate tracking
      if (user) {
        try {
          const updatedAttempt = await recordAssessmentAttempt(
            user.$id,
            selectedLead.$id,
            subject,
            {
              candidateName: formData.candidateName,
              technology: formData.technology,
              emailId: formData.emailId,
              contactNumber: formData.contactNumber,
              endClient: formData.endClient,
              jobTitle: formData.jobTitle,
              assessmentDuration: formData.assessmentDuration,
              assessmentReceived: formattedReceived,
            },
          );

          setAssessmentAttempts((prev) =>
            new Map(prev).set(selectedLead.$id, {
              $id: updatedAttempt.$id,
              leadId: updatedAttempt.leadId,
              userId: updatedAttempt.userId,
              attemptCount: updatedAttempt.attemptCount,
              lastAttemptAt: updatedAttempt.lastAttemptAt,
              sentSubjects: updatedAttempt.sentSubjects || [],
            }),
          );
        } catch (e: any) {
          console.error("Failed to record assessment attempt:", e);
        }
      }

      toast({
        title: "Success",
        description: "Assessment support email sent successfully.",
      });

      setIsModalOpen(false);

      const storedSignature = localStorage.getItem("assessmentSignature");
      const parsedSignature = storedSignature
        ? JSON.parse(storedSignature)
        : {};

      setFormData({
        ...INITIAL_FORM_DATA,
        yourName: parsedSignature.yourName || "",
        yourRole: parsedSignature.yourRole || "",
        yourPhone: parsedSignature.yourPhone || "",
        company: parsedSignature.company || "Silverspace Inc.",
      });
    } catch (error: unknown) {
      console.error("Error sending email:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to send email";

      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });

      if (errorMessage.includes("Not connected")) {
        setIsOutlookConnected(false);
      }
    } finally {
      setIsSending(false);
    }
  };

  const totalPages = Math.ceil(filteredLeads.length / ITEMS_PER_PAGE);
  const paginatedLeads = filteredLeads.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  );

  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const minDateTime = now.toISOString().slice(0, 16);

  if (loading || isLoading) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">Sales Assessment Support</h1>
        <Card>
          <CardContent className="p-6">
            <TableSkeleton rows={5} />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Sales Assessment Support</h1>
        {!isOutlookConnected ? (
          <Button onClick={handleConnectOutlook} disabled={isAuthLoading}>
            {isAuthLoading ? "Connecting..." : "Connect Outlook"}
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled
            className="text-green-600 border-green-600">
            Outlook Connected
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-4 border-b">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <Label htmlFor="search" className="sr-only">
                Search
              </Label>
              <Input
                id="search"
                placeholder="Search by name, email, phone or company..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="w-full sm:w-[200px]">
              <Label htmlFor="filter" className="sr-only">
                Filter
              </Label>
              <select
                id="filter"
                className="w-full"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}>
                <option value="all">All Leads</option>
                <option value="assessment_created">Assessment Created</option>
                <option value="assessment_not_created">Assessment Not Created</option>
              </select>
            </div>
          </div>
        </CardContent>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead className="border-b bg-muted/50">
                <tr className="text-left">
                  <th className="p-4 font-semibold">Name</th>
                  <th className="p-4 font-semibold">Phone</th>
                  <th className="p-4 font-semibold">Email</th>
                  <th className="p-4 font-semibold">Source</th>
                  <th className="p-4 font-semibold">Company</th>
                  <th className="p-4 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {paginatedLeads.map((lead) => {
                  const leadData = JSON.parse(lead.data);
                  const attempt = assessmentAttempts.get(lead.$id);
                  const attemptsCount = attempt?.attemptCount || 0;
                  const canCreate = canCreateAssessment(lead.$id);

                  return (
                    <tr
                      key={lead.$id}
                      className="border-b hover:bg-muted/50 transition-colors">
                      <td className="p-4">
                        {leadData.firstName} {leadData.lastName}
                        {leadData.legalName && (
                          <div className="text-xs text-muted-foreground">
                            ({leadData.legalName})
                          </div>
                        )}
                      </td>
                      <td className="p-4">{leadData.phone || "N/A"}</td>
                      <td className="p-4">{leadData.email || "N/A"}</td>
                      <td className="p-4">
                        {leadData.sourceName || leadData.source || "-"}
                      </td>
                      <td className="p-4">{leadData.company || "N/A"}</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          {attemptsCount > 0 && (
                            <span style={{ fontSize: '0.6875rem', fontWeight: 500, color: '#4ade80', background: 'rgba(74,222,128,0.12)', padding: '0.125rem 0.5rem', borderRadius: '999px', border: '1px solid rgba(74,222,128,0.25)' }}>
                              {attemptsCount} Sent
                            </span>
                          )}
                          <Button
                            size="sm"
                            onClick={() => handleCreateAssessment(lead)}
                            disabled={!isOutlookConnected || isPreparingAssessment}>
                            {isPreparingAssessment && selectedLead?.$id === lead.$id
                              ? "Preparing..."
                              : "Create Assessment"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {paginatedLeads.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="p-8 text-center text-muted-foreground">
                      No leads found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-end space-x-2 p-4 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}>
                Previous
              </Button>
              <div className="text-sm font-medium">
                Page {currentPage} of {totalPages}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setCurrentPage((prev) => Math.min(prev + 1, totalPages))
                }
                disabled={currentPage === totalPages}>
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Assessment Support</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label htmlFor="to">To (Comma separated)</Label>
                <Input
                  id="to"
                  value={formData.to}
                  readOnly
                  className="bg-muted"
                />
              </div>

              <div className="col-span-2">
                <Label htmlFor="cc">CC (Comma separated)</Label>
                <Input
                  id="cc"
                  value={formData.cc}
                  onChange={(e) =>
                    setFormData({ ...formData, cc: e.target.value })
                  }
                  placeholder="manager@example.com"
                />
              </div>

              <div className="col-span-2">
                <Label>Subject</Label>
                <div className="p-3 border-2 border-primary/30 rounded-md bg-primary/5 text-sm font-medium transition-all duration-200">
                  {liveSubject}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  This subject updates in real-time as you fill in the fields below.
                </p>
              </div>

              {/* Assessment-specific fields in table-like layout */}
              <div className="col-span-2 border rounded-md overflow-hidden">
                <div className="grid grid-cols-[200px_1fr] text-sm">
                  <div className="p-3 bg-muted font-semibold border-b">Assessment Received (EST)</div>
                  <div className="p-2 border-b">
                    <Input
                      id="assessmentReceived"
                      type="datetime-local"
                      min={minDateTime}
                      value={formData.assessmentReceived}
                      onChange={(e) =>
                        setFormData({ ...formData, assessmentReceived: e.target.value })
                      }
                      className="h-8"
                    />
                  </div>

                  <div className="p-3 bg-muted font-semibold border-b">Candidate Name</div>
                  <div className="p-2 border-b">
                    <Input
                      value={formData.candidateName}
                      onChange={(e) =>
                        setFormData({ ...formData, candidateName: e.target.value })
                      }
                      placeholder="Full name"
                      className="h-8"
                    />
                  </div>

                  <div className="p-3 bg-muted font-semibold border-b">Technology</div>
                  <div className="p-2 border-b">
                    <Input
                      value={formData.technology}
                      onChange={(e) =>
                        setFormData({ ...formData, technology: e.target.value })
                      }
                      placeholder="e.g. Full Stack Developer"
                      className="h-8"
                    />
                  </div>

                  <div className="p-3 bg-muted font-semibold border-b">Email ID</div>
                  <div className="p-2 border-b">
                    <Input
                      value={formData.emailId}
                      onChange={(e) =>
                        setFormData({ ...formData, emailId: e.target.value })
                      }
                      placeholder="candidate@email.com"
                      className="h-8"
                    />
                  </div>

                  <div className="p-3 bg-muted font-semibold border-b">Contact Number</div>
                  <div className="p-2 border-b">
                    <Input
                      value={formData.contactNumber}
                      onChange={(e) =>
                        setFormData({ ...formData, contactNumber: e.target.value })
                      }
                      placeholder="+1234567890"
                      className="h-8"
                    />
                  </div>

                  <div className="p-3 bg-muted font-semibold border-b">End Client</div>
                  <div className="p-2 border-b">
                    <Input
                      value={formData.endClient}
                      onChange={(e) =>
                        setFormData({ ...formData, endClient: e.target.value })
                      }
                      placeholder="e.g. Hacker Rank"
                      className="h-8"
                    />
                  </div>

                  <div className="p-3 bg-muted font-semibold border-b">Job Title</div>
                  <div className="p-2 border-b">
                    <Input
                      value={formData.jobTitle}
                      onChange={(e) =>
                        setFormData({ ...formData, jobTitle: e.target.value })
                      }
                      placeholder="e.g. Sde-2 Backend Engineer"
                      className="h-8"
                    />
                  </div>

                  <div className="p-3 bg-muted font-semibold">Assessment Duration</div>
                  <div className="p-2">
                    <Input
                      value={formData.assessmentDuration}
                      onChange={(e) =>
                        setFormData({ ...formData, assessmentDuration: e.target.value })
                      }
                      placeholder="e.g. 60 minutes"
                      className="h-8"
                    />
                  </div>
                </div>
              </div>

              {/* Attachments */}
              <div className="col-span-2 md:col-span-1">
                <Label htmlFor="resume">Resume</Label>
                <Input
                  id="resume"
                  key={resumeInputKey}
                  type="file"
                  onChange={(e) => handleFileChange(e, "resume")}
                  accept=".pdf,.doc,.docx"
                />
              </div>

              <div className="col-span-2 md:col-span-1">
                <Label htmlFor="additionalAttachment">Additional Attachment</Label>
                <Input
                  id="additionalAttachment"
                  key={additionalInputKey}
                  type="file"
                  onChange={(e) => handleFileChange(e, "additionalAttachment")}
                />
              </div>

              {/* Job Description */}
              <div className="col-span-2">
                <Label htmlFor="jobDescription">Job Description</Label>
                <Textarea
                  id="jobDescription"
                  value={formData.jobDescription}
                  onChange={(e) =>
                    setFormData({ ...formData, jobDescription: e.target.value })
                  }
                  rows={4}
                  placeholder="Paste job description here (leave empty for 'JD Not Available')"
                />
              </div>

              {/* Company selector */}
              <div className="col-span-2 md:col-span-1">
                <Label htmlFor="company">Company (Signature)</Label>
                <select
                  id="company"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  value={formData.company}
                  onChange={(e) =>
                    setFormData({ ...formData, company: e.target.value as any })
                  }>
                  <option value="Silverspace Inc.">Silverspace Inc.</option>
                  <option value="Vizva Consultancy">Vizva Consultancy</option>
                </select>
              </div>

              {/* Signature Details */}
              <div className="col-span-2 border-t pt-4 mt-2">
                <h3 className="font-semibold mb-2">Signature Details</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 md:col-span-1">
                    <Label htmlFor="yourName">Your Name</Label>
                    <Input
                      id="yourName"
                      value={formData.yourName}
                      onChange={(e) =>
                        setFormData({ ...formData, yourName: e.target.value })
                      }
                      placeholder="John Doe"
                    />
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    <Label htmlFor="yourRole">Your Role</Label>
                    <Input
                      id="yourRole"
                      value={formData.yourRole}
                      onChange={(e) =>
                        setFormData({ ...formData, yourRole: e.target.value })
                      }
                      placeholder="HR Manager"
                    />
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    <Label htmlFor="yourPhone">Your Phone</Label>
                    <Input
                      id="yourPhone"
                      value={formData.yourPhone}
                      onChange={(e) =>
                        setFormData({ ...formData, yourPhone: e.target.value })
                      }
                      placeholder="+1 (555) 123-4567"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>
              Go Back
            </Button>
            <Button onClick={sendEmail} disabled={isSending}>
              {isSending ? "Sending..." : "Send Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AssessmentSupportPage() {
  return (
    <ProtectedRoute componentKey="assessment-support">
      <AssessmentContent />
    </ProtectedRoute>
  );
}
