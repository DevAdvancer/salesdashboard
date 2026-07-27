"use client";

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
import { TableSkeleton } from "@/components/ui/skeleton";
import { handleError } from "@/lib/utils/error-handler";
import { useToast } from "@/components/ui/use-toast";
import { ProtectedRoute } from "@/components/protected-route";
import {
  getMockAttempts,
  reserveMockAttempt,
  rollbackMockAttempt,
  completeMockAttempt,
} from "@/app/actions/mock";
import { listLeads } from "@/lib/services/lead-action-service";
import { useDebounce } from "@/lib/hooks/use-debounce";

// Components
import { MockFiltersCard } from "@/components/mock/mock-filters-card";
import { MockTable } from "@/components/mock/mock-table";
import { MockDialog } from "@/components/mock/mock-dialog";
import { type MockFormData, type MockAttempt, INITIAL_FORM_DATA } from "@/components/mock/mock-types";
import { logger } from '@/lib/utils/logger';

function MockContent() {
  const { user, loading } = useAuth();
  const isMonitor = user?.role === "monitor";
  const isReadOnly = isMonitor || user?.role === "operations";
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
  const [formData, setFormData] = useState<MockFormData>(INITIAL_FORM_DATA);
  const [isSending, setIsSending] = useState(false);
  const [isOutlookConnected, setIsOutlookConnected] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  const [mockAttempts, setMockAttempts] = useState<Map<string, MockAttempt>>(new Map());

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

    const storedSignature = localStorage.getItem("mockSignature");
    if (storedSignature) {
      const parsed = JSON.parse(storedSignature);
      setFormData((prev) => ({
        ...prev,
        yourName: parsed.yourName || "",
        yourRole: parsed.yourRole || "",
        yourPhone: parsed.yourPhone || "",
        company: parsed.company || "Silverspace Inc.",
      }));
    }
  }, []);

  const loadMockAttempts = useCallback(
    async (leadIds: string[]) => {
      if (!user) return;
      if (!leadIds.length) {
        setMockAttempts(new Map());
        return;
      }
      try {
        const attempts = await getMockAttempts(user.$id, leadIds);
        const nextAttempts = new Map<string, MockAttempt>();
        attempts.forEach((doc: MockAttempt) => {
          nextAttempts.set(doc.leadId, {
            $id: doc.$id,
            leadId: doc.leadId,
            userId: doc.userId,
            attemptCount: doc.attemptCount,
            lastAttemptAt: doc.lastAttemptAt,
          });
        });
        setMockAttempts(nextAttempts);
      } catch (err) {
        logger.error("Error loading mock attempts:", err);
        setMockAttempts(new Map());
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
      await loadMockAttempts(fetchedLeads.map((lead) => lead.$id));
    } catch (err) {
      handleError(err as Error, {
        title: "Failed to Load Leads",
        showToast: true,
      });
    } finally {
      setIsLoading(false);
    }
  }, [user, loadMockAttempts]);

  useEffect(() => {
    if (user) {
      loadLeads();
    }
  }, [user, loadLeads]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filter, debouncedSearchQuery]);

  useEffect(() => {
    let result = leads;

    if (filter === "mock_created") {
      result = result.filter((lead) => {
        const attempt = mockAttempts.get(lead.$id);
        return attempt && attempt.attemptCount > 0;
      });
    } else if (filter === "mock_not_created") {
      result = result.filter((lead) => {
        const attempt = mockAttempts.get(lead.$id);
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
  }, [leads, filter, debouncedSearchQuery, mockAttempts]);

  const [fileInputKey, setFileInputKey] = useState(Date.now());
  const [isPreparingMock, setIsPreparingMock] = useState(false);

  const getCooldownStatus = (leadId: string) => {
    if (user?.role === "admin") {
      return { canCreate: true, remainingTime: 0, count: 0 };
    }

    const attempt = mockAttempts.get(leadId);
    if (!attempt) return { canCreate: true, remainingTime: 0, count: 0 };

    const MAX_ATTEMPTS = 2;
    const COOLDOWN_MINUTES = 30;

    if (attempt.attemptCount >= MAX_ATTEMPTS) {
      return {
        canCreate: false,
        remainingTime: 0,
        count: attempt.attemptCount,
        isMaxed: true,
      };
    }

    const lastAttempt = new Date(attempt.lastAttemptAt);
    const now = new Date();
    const diffMs = now.getTime() - lastAttempt.getTime();
    const diffMinutes = diffMs / (1000 * 60);

    if (diffMinutes < COOLDOWN_MINUTES) {
      return {
        canCreate: false,
        remainingTime: Math.ceil(COOLDOWN_MINUTES - diffMinutes),
        count: attempt.attemptCount,
      };
    }

    return { canCreate: true, remainingTime: 0, count: attempt.attemptCount };
  };

  const handleCreateMock = async (lead: Lead) => {
    const status = getCooldownStatus(lead.$id);
    if (!status.canCreate) {
      if (status.isMaxed) {
        toast({
          title: "Limit Reached",
          description: "Maximum of 2 mock attempts allowed.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Cooldown Active",
          description: `Please wait ${status.remainingTime} minutes before retrying.`,
          variant: "destructive",
        });
      }
      return;
    }

    try {
      setIsPreparingMock(true);
      setSelectedLead(lead);
      const leadData = JSON.parse(lead.data);

      setFormData((prev) => ({
        ...INITIAL_FORM_DATA,
        yourName: prev.yourName,
        yourRole: prev.yourRole,
        yourPhone: prev.yourPhone,
        company: prev.company,
        candidateName: `${leadData.firstName || ""} ${leadData.lastName || ""}`.trim(),
        endClient: leadData.company || "",
        emailId: leadData.email || "",
        contactNumber: leadData.phone || "",
      }));
      setFileInputKey(Date.now());

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
        logger.error("Failed to fetch CC users:", err);
      }

      setIsModalOpen(true);
    } catch (error) {
      logger.error("Error preparing mock:", error);
      toast({
        title: "Error",
        description: "Failed to prepare mock interview form.",
        variant: "destructive",
      });
    } finally {
      setIsPreparingMock(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const preparedAttachment = await prepareSupportEmailAttachment(file, []);

      if (!preparedAttachment.file) {
        toast({
          title: "File too large",
          description: preparedAttachment.error ?? "File is too large.",
          variant: "destructive",
        });
        e.target.value = "";
        setFormData({ ...formData, resume: null });
        return;
      }
      setFormData({ ...formData, resume: preparedAttachment.file });

      if (preparedAttachment.compressed) {
        toast({
          title: "File compressed",
          description: `${file.name} was compressed to ${preparedAttachment.file.name}.`,
        });
      }
    }
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

    try {
      setIsSending(true);
      localStorage.setItem(
        "mockSignature",
        JSON.stringify({
          yourName: formData.yourName,
          yourRole: formData.yourRole,
          yourPhone: formData.yourPhone,
          company: formData.company,
        }),
      );

      let attachment = null;
      if (formData.resume) {
        const attachmentSizeError = getSupportEmailAttachmentLimitError([formData.resume]);
        if (attachmentSizeError) {
          throw new Error(attachmentSizeError);
        }

        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const result = reader.result as string;
            const base64 = result.split(",")[1];
            resolve(base64);
          };
          reader.onerror = reject;
        });
        reader.readAsDataURL(formData.resume);
        const base64Content = await base64Promise;

        attachment = {
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: formData.resume.name,
          contentType: formData.resume.type,
          contentBytes: base64Content,
        };
      }

      let formattedSchedule = "";
      if (formData.schedule) {
        const date = new Date(formData.schedule);
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
        formattedSchedule = `${datePart} at ${timePart}`;
      }

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

      const emailBody = `
        <html>
          <body style="font-family: Arial, sans-serif; color: #333;">
            <p>${formData.emailBody.replace(/\n/g, "<br/>")}</p>

            <table cellpadding="5" cellspacing="0" border="0" style="width: 100%; max-width: 600px; margin-top: 20px; border-collapse: collapse;">
              <tr><td style="font-weight: bold; width: 150px; padding: 5px;">Candidate Name</td><td style="padding: 5px;">${formData.candidateName}</td></tr>
              <tr><td style="font-weight: bold; padding: 5px;">End Client</td><td style="padding: 5px;">${formData.endClient}</td></tr>
              <tr><td style="font-weight: bold; padding: 5px;">Role</td><td style="padding: 5px;">${formData.role}</td></tr>
              <tr><td style="font-weight: bold; padding: 5px;">Schedule</td><td style="padding: 5px;">${formattedSchedule}</td></tr>
              <tr><td style="font-weight: bold; padding: 5px;">Email ID</td><td style="padding: 5px;">${formData.emailId}</td></tr>
              <tr><td style="font-weight: bold; padding: 5px;">Contact Number</td><td style="padding: 5px;">${formData.contactNumber}</td></tr>
            </table>

            <br/>
            <p>Regards,</p>

            <table cellpadding="0" cellspacing="0" border="0" style="font-family: Arial, sans-serif; font-size: 14px; color: rgb(255, 255, 255); background-color: #1a1a1a; padding: 10px; border-radius: 5px;"><tbody><tr><td style="padding-right: 20px;"><div style="filter: drop-shadow(rgba(255, 255, 255, 0.8) 0px 0px 4px) drop-shadow(rgba(255, 255, 255, 0.4) 0px 0px 20px); padding: 4px;"><img src="${logoUrl}" alt="${formData.company} logo" width="130" style="display: block; max-width: 100%; height: auto;"></div></td><td style="border-left: 2px solid rgb(248, 98, 149); padding-left: 20px;"><strong style="font-size: 18px; color: rgb(255, 255, 255); display: block; margin-bottom: 4px;">${formData.yourName}</strong><span style="display: block; margin-bottom: 2px; color: rgb(255, 255, 255);">${formData.yourRole}</span><span style="color: rgb(204, 204, 204); display: block; margin-bottom: 12px;">${formData.company}</span><a href="mailto:${formData.yourName.toLowerCase().replace(/\s+/g, ".")}@silverspaceinc.com" style="color: rgb(255, 255, 255); text-decoration: none; display: block; margin-bottom: 4px;">📧 ${formData.yourName.toLowerCase().replace(/\s+/g, ".")}@silverspaceinc.com</a><a href="tel:${formData.yourPhone}" style="color: rgb(255, 255, 255); text-decoration: none; display: block; margin-bottom: 4px;">📞 ${formData.yourPhone}</a><a href="${websiteLink}" target="_blank" style="color: rgb(255, 255, 255); text-decoration: none; display: block;">🔗 ${websiteUrl}</a></td></tr></tbody></table>
          </body>
        </html>
      `;

      const payload = {
        message: {
          subject: `Request to schedule mock interview - ${formData.candidateName}`,
          body: {
            contentType: "HTML",
            content: emailBody,
          },
          toRecipients: formData.to
            .split(",")
            .map((email) => ({ emailAddress: { address: email.trim() } }))
            .filter((r) => r.emailAddress.address),
          ccRecipients: formData.cc
            .split(",")
            .map((email) => ({ emailAddress: { address: email.trim() } }))
            .filter((r) => r.emailAddress.address),
          attachments: attachment ? [attachment] : [],
        },
        saveToSentItems: "true",
      };

      if (!user) throw new Error("User session not found");

      const reservedAttempt = await reserveMockAttempt(user.$id, selectedLead.$id);

      try {
        const response = await fetch("/api/mock/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(await readErrorResponseMessage(response, "Failed to send email"));
        }
      } catch (sendError) {
        await rollbackMockAttempt(user.$id, reservedAttempt.reservation);
        throw sendError;
      }

      const storedSignature = localStorage.getItem("mockSignature");
      const parsedSignature = storedSignature ? JSON.parse(storedSignature) : {};

      await completeMockAttempt(
        user.$id,
        selectedLead.$id,
        formData.candidateName,
        reservedAttempt.attemptCount,
        reservedAttempt.userName,
      );

      setMockAttempts((prev) =>
        new Map(prev).set(selectedLead.$id, {
          $id: reservedAttempt.$id,
          leadId: reservedAttempt.leadId,
          userId: reservedAttempt.userId,
          attemptCount: reservedAttempt.attemptCount,
          lastAttemptAt: reservedAttempt.lastAttemptAt,
        }),
      );

      toast({ title: "Success", description: "Email sent successfully." });
      setIsModalOpen(false);
      setFormData({
        ...INITIAL_FORM_DATA,
        yourName: parsedSignature.yourName || "",
        yourRole: parsedSignature.yourRole || "",
        yourPhone: parsedSignature.yourPhone || "",
        company: parsedSignature.company || "Silverspace Inc.",
      });
    } catch (error: unknown) {
      logger.error("Error sending email:", error);
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

  const totalPages = Math.max(1, Math.ceil(filteredLeads.length / ITEMS_PER_PAGE));
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
        <h1 className="text-2xl font-bold mb-6">Mock Interview Setup</h1>
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
        <h1 className="text-2xl font-bold">Mock Interview Setup</h1>
        {!isReadOnly && (!isOutlookConnected ? (
          <Button onClick={handleConnectOutlook} disabled={isAuthLoading}>
            {isAuthLoading ? "Connecting..." : "Connect Outlook"}
          </Button>
        ) : (
          <Button variant="outline" disabled className="text-green-600 border-green-600">
            Outlook Connected
          </Button>
        ))}
      </div>

      <MockFiltersCard
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        filter={filter}
        setFilter={setFilter}
      />

      <Card>
        <MockTable
          paginatedLeads={paginatedLeads}
          mockAttempts={mockAttempts}
          isReadOnly={isReadOnly}
          isAdminUser={user?.role === "admin"}
          isOutlookConnected={isOutlookConnected}
          isPreparingMock={isPreparingMock}
          selectedLead={selectedLead}
          getCooldownStatus={getCooldownStatus}
          handleCreateMock={handleCreateMock}
          currentPage={currentPage}
          totalPages={totalPages}
          setCurrentPage={setCurrentPage}
        />
      </Card>

      <MockDialog
        isModalOpen={isModalOpen}
        setIsModalOpen={setIsModalOpen}
        formData={formData}
        setFormData={setFormData}
        minDateTime={minDateTime}
        fileInputKey={fileInputKey}
        handleFileChange={handleFileChange}
        sendEmail={sendEmail}
        isSending={isSending}
      />
    </div>
  );
}

export default function MockPage() {
  return (
    <ProtectedRoute componentKey="mock">
      <MockContent />
    </ProtectedRoute>
  );
}
