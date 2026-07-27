"use client";
import { logger } from '@/lib/utils/logger';

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/contexts/auth-context";
import { getSupportRequestCcEmails } from "@/lib/services/user-service";
import type { Lead } from "@/lib/types";
import { readErrorResponseMessage } from "@/lib/utils/http-error-response";
import {
  getSupportEmailAttachmentLimitError,
  prepareSupportEmailAttachment,
} from "@/lib/utils/support-email-attachments";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  getInterviewAttempts,
  reserveInterviewAttempt,
  rollbackInterviewAttempt,
  completeInterviewAttempt,
} from "@/app/actions/interview";
import { saveTechnicalPayment } from "@/app/actions/technical-payments";
import { listLeads } from "@/lib/services/lead-action-service";
import { useDebounce } from "@/lib/hooks/use-debounce";

// Components
import { InterviewFiltersCard } from "@/components/interview-support/interview-filters-card";
import { InterviewTable } from "@/components/interview-support/interview-table";
import { InterviewDialog } from "@/components/interview-support/interview-dialog";
import {
  type InterviewFormData,
  type InterviewAttempt,
  INITIAL_FORM_DATA,
  INTERVIEW_SUPPORT_CC_EMAILS,
} from "@/components/interview-support/interview-types";

function InterviewContent() {
  const { user, loading } = useAuth();
  const isReadOnly = user?.role === "operations";
  const { toast } = useToast();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [filteredLeads, setFilteredLeads] = useState<Lead[]>([]);
  const [filter, setFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 500);
  const [isLoading, setIsLoading] = useState(true);
  const isAuthLoading = false;
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState<InterviewFormData>(INITIAL_FORM_DATA);
  const [isSending, setIsSending] = useState(false);
  const [isOutlookConnected, setIsOutlookConnected] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  const [interviewAttempts, setInterviewAttempts] = useState<Map<string, InterviewAttempt>>(
    new Map(),
  );

  const handleConnectOutlook = async () => {
    window.location.href = "/api/auth/login";
  };

  useEffect(() => {
    const checkConnection = async () => {
      try {
        const response = await fetch("/api/auth/status");
        const data = await response.json();
        setIsOutlookConnected(data.connected);
      } catch (error) {
        logger.error("Failed to check connection status", error);
      }
    };
    checkConnection();

    const storedSig = localStorage.getItem("interviewSignature");
    if (storedSig) {
      const parsed = JSON.parse(storedSig);
      setFormData((prev) => ({
        ...prev,
        yourName: parsed.yourName || "",
        yourRole: parsed.yourRole || "",
        yourPhone: parsed.yourPhone || "",
        company: parsed.company || "Silverspace Inc.",
      }));
    } else {
      const mockSig = localStorage.getItem("mockSignature");
      if (mockSig) {
        const parsed = JSON.parse(mockSig);
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

  const loadInterviewAttempts = useCallback(
    async (leadIds: string[]) => {
      if (!user) return;
      if (!leadIds.length) {
        setInterviewAttempts(new Map());
        return;
      }
      try {
        const attempts = await getInterviewAttempts(user.$id, leadIds);
        const nextAttempts = new Map<string, InterviewAttempt>();
        attempts.forEach((doc: InterviewAttempt) => {
          nextAttempts.set(doc.leadId, {
            $id: doc.$id,
            leadId: doc.leadId,
            userId: doc.userId,
            attemptCount: doc.attemptCount,
            lastAttemptAt: doc.lastAttemptAt,
            sentSubjects: doc.sentSubjects || [],
          });
        });
        setInterviewAttempts(nextAttempts);
      } catch (err) {
        logger.error("Error loading interview attempts:", err);
        setInterviewAttempts(new Map());
      }
    },
    [user],
  );

  const loadLeads = useCallback(async () => {
    if (!user) return;
    try {
      setIsLoading(true);
      const fetchedLeads = await listLeads({}, user.$id, user.role, user.branchIds);
      setLeads(fetchedLeads);
      setFilteredLeads(fetchedLeads);
      await loadInterviewAttempts(fetchedLeads.map((lead) => lead.$id));
    } catch (err) {
      handleError(err as Error, { title: "Failed to Load Leads", showToast: true });
    } finally {
      setIsLoading(false);
    }
  }, [user, loadInterviewAttempts]);

  useEffect(() => {
    if (user) loadLeads();
  }, [user, loadLeads]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filter, debouncedSearchQuery]);

  useEffect(() => {
    let result = leads;

    if (filter === "interview_created") {
      result = result.filter((lead) => {
        const attempt = interviewAttempts.get(lead.$id);
        return attempt && attempt.attemptCount > 0;
      });
    } else if (filter === "interview_not_created") {
      result = result.filter((lead) => {
        const attempt = interviewAttempts.get(lead.$id);
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
  }, [leads, filter, debouncedSearchQuery, interviewAttempts]);

  const [resumeInputKey, setResumeInputKey] = useState(Date.now());
  const [additionalInputKey, setAdditionalInputKey] = useState(Date.now() + 1);
  const [isPreparingInterview, setIsPreparingInterview] = useState(false);
  const [isUpfrontDialogOpen, setIsUpfrontDialogOpen] = useState(false);
  const [upfrontAmount, setUpfrontAmount] = useState("");
  const [selectedLeadForUpfront, setSelectedLeadForUpfront] = useState<Lead | null>(null);
  const [currentUpfrontAmount, setCurrentUpfrontAmount] = useState(0);

  const handleCreateInterview = async (lead: Lead) => {
    setSelectedLeadForUpfront(lead);
    setUpfrontAmount("");
    setIsUpfrontDialogOpen(true);
  };

  const setUpformDataForInterview = async (lead: Lead) => {
    setIsPreparingInterview(true);
    setSelectedLead(lead);

    const leadData = JSON.parse(lead.data);

    setFormData((prev) => ({
      ...INITIAL_FORM_DATA,
      yourName: prev.yourName,
      yourRole: prev.yourRole,
      yourPhone: prev.yourPhone,
      company: prev.company,
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
      const uniqueCC = Array.from(new Set([...INTERVIEW_SUPPORT_CC_EMAILS, ...ccEmails]));

      setFormData((prev) => ({ ...prev, cc: uniqueCC.join(", ") }));
    } catch (err) {
      logger.error("Failed to fetch CC users:", err);
    }
    setIsModalOpen(true);
    setIsPreparingInterview(false);
  };

  const handleFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
    field: "resume" | "additionalAttachment",
  ) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const existingAttachments = [
        field === "resume" ? null : formData.resume,
        field === "additionalAttachment" ? null : formData.additionalAttachment,
      ].filter((attachment): attachment is File => Boolean(attachment));
      const preparedAttachment = await prepareSupportEmailAttachment(file, existingAttachments);

      if (!preparedAttachment.file) {
        toast({
          title: "File too large",
          description: preparedAttachment.error ?? "File is too large.",
          variant: "destructive",
        });
        e.target.value = "";
        setFormData({ ...formData, [field]: null });
        return;
      }
      setFormData({ ...formData, [field]: preparedAttachment.file });

      if (preparedAttachment.compressed) {
        toast({
          title: "File compressed",
          description: `${file.name} was compressed to ${preparedAttachment.file.name}.`,
        });
      }
    }
  };

  const formatDateEST = (isoString: string) => {
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

    const requiredFields = [
      { label: "Candidate Name", value: formData.candidateName.trim() },
      { label: "Technology", value: formData.technology.trim() },
      { label: "End Client", value: formData.endClient.trim() },
      { label: "Job Title", value: formData.jobTitle.trim() },
      { label: "Interview Round", value: formData.interviewRound.trim() },
      { label: "Date & Time", value: formData.interviewDate },
      { label: "Duration", value: formData.duration.trim() },
      { label: "Contact Number", value: formData.contactNumber.trim() },
      { label: "Resume", value: formData.resume?.name ?? "" },
    ];

    const missingField = requiredFields.find((field) => !field.value);
    if (missingField) {
      toast({
        title: "Missing Field",
        description: `${missingField.label} is required.`,
        variant: "destructive",
      });
      return;
    }

    try {
      setIsSending(true);

      localStorage.setItem(
        "interviewSignature",
        JSON.stringify({
          yourName: formData.yourName,
          yourRole: formData.yourRole,
          yourPhone: formData.yourPhone,
          company: formData.company,
        }),
      );

      const fileToBase64 = (file: File): Promise<string> =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(",")[1]);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

      const attachments = [];
      const attachmentSizeError = getSupportEmailAttachmentLimitError(
        [formData.resume, formData.additionalAttachment].filter((attachment): attachment is File =>
          Boolean(attachment),
        ),
      );

      if (attachmentSizeError) {
        throw new Error(attachmentSizeError);
      }

      if (formData.resume) {
        attachments.push({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: formData.resume.name,
          contentType: formData.resume.type,
          contentBytes: await fileToBase64(formData.resume),
        });
      }
      if (formData.additionalAttachment) {
        attachments.push({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: formData.additionalAttachment.name,
          contentType: formData.additionalAttachment.type,
          contentBytes: await fileToBase64(formData.additionalAttachment),
        });
      }

      const formattedDate = formatDateEST(formData.interviewDate);
      const subject = `[Sales] Interview Support - ${formData.candidateName} - ${formData.technology} - ${formattedDate}`;

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

      const jdSection = formData.jobDescription.trim()
        ? `<p style="margin-top: 20px;"><strong style="font-size: 14px;">Job Description</strong></p>
           <p style="white-space: pre-wrap;">${formData.jobDescription.replace(/\n/g, "<br/>")}</p>`
        : `<p style="margin-top: 20px;"><strong style="font-size: 14px;">Job Description</strong></p>
           <p style="color: #888;">JD Not Available</p>`;

      const emailBody = `
        <html>
          <body style="font-family: Arial, sans-serif; color: #333; margin: 0; padding: 0;">
            <p style="margin: 0 0 18px 0;">Hi <strong>@Ronak Gahlot</strong>,</p>
            <p style="margin: 0 0 18px 0;">We require confirmation from your end regarding this task, in line with the recent compliance update. This will enable us to proceed further with the interview.</p>
            <p style="margin: 0 0 18px 0;">Kindly do the needful at your earliest convenience.</p>

            <p style="margin: 0 0 6px 0;">Interview support request details:</p>

            <table cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 560px; margin-top: 6px; border-collapse: collapse; border: 1px solid #ccc;">
              <tr>
                <td style="font-weight: bold; width: 180px; padding: 5px 10px; background-color: #3b4958; color: #fff; border: 1px solid #4a5a6a; font-size: 13px;">Candidate Name</td>
                <td style="padding: 5px 10px; background-color: #ffffff; color: #222; border: 1px solid #ccc; font-size: 13px;">${formData.candidateName}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; padding: 5px 10px; background-color: #3b4958; color: #fff; border: 1px solid #4a5a6a; font-size: 13px;">Technology</td>
                <td style="padding: 5px 10px; background-color: #f9f9f9; color: #222; border: 1px solid #ccc; font-size: 13px;">${formData.technology}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; padding: 5px 10px; background-color: #3b4958; color: #fff; border: 1px solid #4a5a6a; font-size: 13px;">End Client</td>
                <td style="padding: 5px 10px; background-color: #ffffff; color: #222; border: 1px solid #ccc; font-size: 13px;">${formData.endClient}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; padding: 5px 10px; background-color: #3b4958; color: #fff; border: 1px solid #4a5a6a; font-size: 13px;">Job Title</td>
                <td style="padding: 5px 10px; background-color: #f9f9f9; color: #222; border: 1px solid #ccc; font-size: 13px;">${formData.jobTitle}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; padding: 5px 10px; background-color: #3b4958; color: #fff; border: 1px solid #4a5a6a; font-size: 13px;">Interview Round</td>
                <td style="padding: 5px 10px; background-color: #ffffff; color: #222; border: 1px solid #ccc; font-size: 13px;">${formData.interviewRound}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; padding: 5px 10px; background-color: #3b4958; color: #fff; border: 1px solid #4a5a6a; font-size: 13px;">Date &amp; Time (EST)</td>
                <td style="padding: 5px 10px; background-color: #f9f9f9; color: #222; font-weight: bold; border: 1px solid #ccc; font-size: 13px;">${formattedDate}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; padding: 5px 10px; background-color: #3b4958; color: #fff; border: 1px solid #4a5a6a; font-size: 13px;">Duration</td>
                <td style="padding: 5px 10px; background-color: #ffffff; color: #222; border: 1px solid #ccc; font-size: 13px;">${formData.duration}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; padding: 5px 10px; background-color: #3b4958; color: #fff; border: 1px solid #4a5a6a; font-size: 13px;">Email ID</td>
                <td style="padding: 5px 10px; background-color: #f9f9f9; color: #222; border: 1px solid #ccc; font-size: 13px;">${formData.emailId}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; padding: 5px 10px; background-color: #3b4958; color: #fff; border: 1px solid #4a5a6a; font-size: 13px;">Contact Number</td>
                <td style="padding: 5px 10px; background-color: #ffffff; color: #222; border: 1px solid #ccc; font-size: 13px;">${formData.contactNumber}</td>
              </tr>
            </table>

            ${jdSection}

            <br/>
            <p style="margin: 4px 0;">Regards,</p>

            <table cellpadding="0" cellspacing="0" border="0" style="font-family: Arial, sans-serif; font-size: 14px; color: rgb(255, 255, 255); background-color: #1a1a1a; padding: 10px; border-radius: 5px;"><tbody><tr><td style="padding-right: 20px;"><div style="filter: drop-shadow(rgba(255, 255, 255, 0.8) 0px 0px 4px) drop-shadow(rgba(255, 255, 255, 0.4) 0px 0px 20px); padding: 4px;"><img src="${logoUrl}" alt="${formData.company} logo" width="130" style="display: block; max-width: 100%; height: auto;"></div></td><td style="border-left: 2px solid rgb(248, 98, 149); padding-left: 20px;"><strong style="font-size: 18px; color: rgb(255, 255, 255); display: block; margin-bottom: 4px;">${formData.yourName}</strong><span style="display: block; margin-bottom: 2px; color: rgb(255, 255, 255);">${formData.yourRole}</span><span style="color: rgb(204, 204, 204); display: block; margin-bottom: 12px;">${formData.company}</span><a href="mailto:${formData.yourName.toLowerCase().replace(/\s+/g, ".")}@silverspaceinc.com" style="color: rgb(255, 255, 255); text-decoration: none; display: block; margin-bottom: 4px;">📧 ${formData.yourName.toLowerCase().replace(/\s+/g, ".")}@silverspaceinc.com</a><a href="tel:${formData.yourPhone}" style="color: rgb(255, 255, 255); text-decoration: none; display: block; margin-bottom: 4px;">📞 ${formData.yourPhone}</a><a href="${websiteLink}" target="_blank" style="color: rgb(255, 255, 255); text-decoration: none; display: block;">🔗 ${websiteUrl}</a></td></tr></tbody></table>
          </body>
        </html>
      `;

      const payload = {
        message: {
          subject,
          body: { contentType: "HTML", content: emailBody },
          toRecipients: formData.to
            .split(",")
            .map((email) => ({ emailAddress: { address: email.trim() } }))
            .filter((r) => r.emailAddress.address),
          ccRecipients: formData.cc
            .split(",")
            .map((email) => ({ emailAddress: { address: email.trim() } }))
            .filter((r) => r.emailAddress.address),
          attachments,
        },
        saveToSentItems: "true",
      };

      if (!user) {
        throw new Error("User session not found");
      }

      const reservedAttempt = await reserveInterviewAttempt(user.$id, selectedLead.$id, subject);

      if ("error" in reservedAttempt) {
        throw new Error(reservedAttempt.error as string);
      }

      try {
        const response = await fetch("/api/interview/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(await readErrorResponseMessage(response, "Failed to send email"));
        }
      } catch (sendError) {
        await rollbackInterviewAttempt(user.$id, reservedAttempt.reservation);
        throw sendError;
      }

      await completeInterviewAttempt(
        user.$id,
        selectedLead.$id,
        subject,
        reservedAttempt.attemptCount,
        {
          candidateName: formData.candidateName,
          technology: formData.technology,
          endClient: formData.endClient,
          jobTitle: formData.jobTitle,
          interviewRound: formData.interviewRound,
          interviewDate: formattedDate,
          duration: formData.duration,
          emailId: formData.emailId,
          contactNumber: formData.contactNumber,
        },
      );

      if (currentUpfrontAmount > 0) {
        try {
          await saveTechnicalPayment({
            actorId: user.$id,
            leadId: selectedLead.$id,
            amount: currentUpfrontAmount,
            type: "interview",
          });
        } catch (error) {
          logger.error("Failed to save technical payment:", error);
        }
      }

      setInterviewAttempts((prev) =>
        new Map(prev).set(selectedLead.$id, {
          $id: reservedAttempt.$id,
          leadId: reservedAttempt.leadId,
          userId: reservedAttempt.userId,
          attemptCount: reservedAttempt.attemptCount,
          lastAttemptAt: reservedAttempt.lastAttemptAt,
          sentSubjects: reservedAttempt.sentSubjects || [],
        }),
      );

      toast({ title: "Success", description: "Interview support email sent successfully." });
      setIsModalOpen(false);

      const storedSig = localStorage.getItem("interviewSignature");
      const parsedSig = storedSig ? JSON.parse(storedSig) : {};
      setFormData({
        ...INITIAL_FORM_DATA,
        yourName: parsedSig.yourName || "",
        yourRole: parsedSig.yourRole || "",
        yourPhone: parsedSig.yourPhone || "",
        company: parsedSig.company || "Silverspace Inc.",
      });
    } catch (error: unknown) {
      logger.error("Error sending email:", error);
      const errorMessage = error instanceof Error ? (error instanceof Error ? error.message : String(error)) : "Failed to send email";
      toast({ title: "Error", description: errorMessage, variant: "destructive" });
      if (errorMessage.includes("Not connected")) setIsOutlookConnected(false);
    } finally {
      setIsSending(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(filteredLeads.length / ITEMS_PER_PAGE));
  const paginatedLeads = filteredLeads.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  );

  if (loading || isLoading) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">Sales Interview Support</h1>
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
        <h1 className="text-2xl font-bold">Sales Interview Support</h1>
        {!isReadOnly && !isOutlookConnected ? (
          <Button onClick={handleConnectOutlook} disabled={isAuthLoading}>
            {isAuthLoading ? "Connecting..." : "Connect Outlook"}
          </Button>
        ) : isOutlookConnected ? (
          <Button variant="outline" disabled className="text-green-600 border-green-600">
            Outlook Connected
          </Button>
        ) : null}
      </div>

      <InterviewFiltersCard
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        filter={filter}
        setFilter={setFilter}
      />

      <Card className="mt-4">
        <InterviewTable
          paginatedLeads={paginatedLeads}
          interviewAttempts={interviewAttempts}
          isReadOnly={isReadOnly}
          isOutlookConnected={isOutlookConnected}
          isPreparingInterview={isPreparingInterview}
          selectedLead={selectedLead}
          handleCreateInterview={handleCreateInterview}
          currentPage={currentPage}
          totalPages={totalPages}
          setCurrentPage={setCurrentPage}
        />
      </Card>

      <Dialog
        open={isUpfrontDialogOpen}
        onOpenChange={(open) => {
          if (!open) setSelectedLeadForUpfront(null);
          setIsUpfrontDialogOpen(open);
        }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upfront Payment</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="mb-4">
              Before creating Interview Support, please enter the upfront payment amount for this
              candidate:
            </p>
            <div className="space-y-2">
              <Label htmlFor="upfrontAmount">Amount ($)</Label>
              <Input
                id="upfrontAmount"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={upfrontAmount}
                onChange={(e) => setUpfrontAmount(e.target.value)}
                required
              />
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setIsUpfrontDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!selectedLeadForUpfront) return;

                const amount = Number(upfrontAmount);
                if (isNaN(amount) || amount < 0) {
                  toast({
                    title: "Invalid Amount",
                    description: "Please enter a valid amount",
                    variant: "destructive",
                  });
                  return;
                }

                setIsUpfrontDialogOpen(false);
                setCurrentUpfrontAmount(amount);
                setUpformDataForInterview(selectedLeadForUpfront);
              }}>
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InterviewDialog
        isModalOpen={isModalOpen}
        setIsModalOpen={(open) => {
          setIsModalOpen(open);
          if (!open) setCurrentUpfrontAmount(0);
        }}
        formData={formData}
        setFormData={setFormData}
        resumeInputKey={resumeInputKey}
        additionalInputKey={additionalInputKey}
        handleFileChange={handleFileChange}
        sendEmail={sendEmail}
        isSending={isSending}
        formatDateEST={formatDateEST}
      />
    </div>
  );
}

export default function InterviewSupportPage() {
  return (
    <ProtectedRoute componentKey="interview-support">
      <InterviewContent />
    </ProtectedRoute>
  );
}
