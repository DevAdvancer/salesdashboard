"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/contexts/auth-context";
import { listLeads } from "@/lib/services/lead-service";
import {
  getUserById,
  getUsersByBranches,
  getAllManagers,
  getAssistantManagersByBranches,
} from "@/lib/services/user-service";
import type { Lead, User } from "@/lib/types";
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
// import { databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite'; // Removed client-side DB usage
// import { Query, ID } from 'appwrite';
import { Clock, RefreshCw, AlertCircle } from "lucide-react";
import { getMockAttempts, recordMockAttempt } from "@/app/actions/mock"; // Import Server Actions
import { useDebounce } from "@/lib/hooks/use-debounce";
// import { useMsal } from "@azure/msal-react";
// import { loginRequest } from "@/lib/msal-config";

interface MockFormData {
  to: string;
  cc: string;
  // subject is computed dynamically based on candidate name
  resume: File | null;
  role: string;
  mode: string;
  schedule: string; // ISO string from datetime-local input
  emailBody: string; // "part 1"
  // Signature fields
  yourName: string;
  yourRole: string;
  yourPhone: string;
  company: "Silverspace Inc." | "Vizva Consultancy";
}

const INITIAL_FORM_DATA: MockFormData = {
  to: "tech.leaders@silverspaceinc.com",
  // to: 'prateek.narvariya@silverspaceinc.com',
  cc: "",
  resume: null,
  role: "",
  mode: "Evaluation",
  schedule: "",
  emailBody: "Hi Team,\n\nThe candidate is available for the whole day.",
  yourName: "",
  yourRole: "",
  yourPhone: "",
  company: "Silverspace Inc.",
};

interface MockAttempt {
  $id: string;
  leadId: string;
  userId: string;
  attemptCount: number;
  lastAttemptAt: string;
}

function MockContent() {
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
  const [formData, setFormData] = useState<MockFormData>(INITIAL_FORM_DATA);
  const [isSending, setIsSending] = useState(false);
  // const { instance, accounts } = useMsal();
  const [isOutlookConnected, setIsOutlookConnected] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  // Mock Attempts State
  const [mockAttempts, setMockAttempts] = useState<Map<string, MockAttempt>>(
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
      if (!leadIds.length || !user) return;

      try {
        setLoadingAttempts(true);
        // Use Server Action instead of client DB call
        const attempts = await getMockAttempts(user.$id, leadIds);

        setMockAttempts((prev) => {
          const newMap = new Map(prev);
          let hasChanges = false;

          attempts.forEach((doc: any) => {
            const existing = newMap.get(doc.leadId);
            // Only update if data actually changed
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
              });
              hasChanges = true;
            }
          });

          return hasChanges ? newMap : prev;
        });
      } catch (err) {
        console.error("Error loading mock attempts:", err);
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
      // Reuse listLeads with existing role-based logic
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

  // Load attempts when filtered leads change (or pagination changes)
  useEffect(() => {
    if (filteredLeads.length > 0) {
      const pageLeads = filteredLeads.slice(
        (currentPage - 1) * ITEMS_PER_PAGE,
        currentPage * ITEMS_PER_PAGE,
      );
      const leadIds = pageLeads.map((l) => l.$id);
      loadMockAttempts(leadIds);
    }
  }, [filteredLeads, currentPage, loadMockAttempts]);

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

  // Reset file input key to force re-render and clear file
  const [fileInputKey, setFileInputKey] = useState(Date.now());

  const [isPreparingMock, setIsPreparingMock] = useState(false);

  const getCooldownStatus = (leadId: string) => {
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
    // Check restrictions again
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

      // Reset form data but keep signature preferences
      setFormData((prev) => ({
        ...INITIAL_FORM_DATA,
        yourName: prev.yourName,
        yourRole: prev.yourRole,
        yourPhone: prev.yourPhone,
        company: prev.company,
      }));
      setFileInputKey(Date.now()); // Reset file input

      // Get lead data and owner/assignee
      const leadData = JSON.parse(lead.data);

      // Determine the user associated with the candidate (Owner/Assignee)
      // Use assignedToId if available, otherwise ownerId
      const targetUserId = lead.assignedToId || lead.ownerId;

      // We need to fetch the target user to know their role and hierarchy
      let targetUser: User | null = null;
      if (targetUserId) {
        targetUser = await getUserById(targetUserId);
      }

      // If no target user found (e.g. unassigned), fallback to current user logic?
      // But per requirement: "if I am agent then my tl if available then all the managers..."
      // This implies logic is based on the *current logged-in user* who is creating the mock,
      // OR the *owner* of the lead?
      // "if I am agent" suggests it's about the current user's role.
      // Let's assume the logic is based on the CURRENT USER (who is performing the action).

      const currentUser = user;
      if (!currentUser) return; // Should be protected route anyway

      let ccEmails: string[] = [];

      // Logic based on Current User Role
      if (currentUser.role === "agent") {
        // Agent -> TL + All Managers

        // 1. Add Team Lead
        if (currentUser.teamLeadId) {
          const tlUser = await getUserById(currentUser.teamLeadId);
          if (tlUser && tlUser.email) ccEmails.push(tlUser.email);
        }

        // 2. Add All Managers Globally
        const allManagers = await getAllManagers();
        allManagers.forEach((m) => {
          if (m.email) ccEmails.push(m.email);
        });
      } else if (currentUser.role === "team_lead") {
        // TL -> Creating Agent + All Managers

        // 1. Add Creating Agent (assigned agent)
        if (
          targetUser &&
          targetUser.role === "agent" &&
          targetUser.$id !== currentUser.$id
        ) {
          if (targetUser.email) ccEmails.push(targetUser.email);
        }

        // 2. Add All Managers Globally
        const allManagers = await getAllManagers();
        allManagers.forEach((m) => {
          if (m.email) ccEmails.push(m.email);
        });
      } else if (currentUser.role === "manager") {
        // Manager -> All OTHER Managers Globally
        const allManagers = await getAllManagers();
        allManagers.forEach((m) => {
          if (m.email && m.$id !== currentUser.$id) ccEmails.push(m.email);
        });
      }

      // 3. Add Assistant Managers in the branch(es)
      // Determine branch(es) context: Use lead's branch if available, otherwise user's branches.
      const targetBranchIds: string[] = lead.branchId
        ? [lead.branchId]
        : currentUser.branchIds || [];

      if (targetBranchIds.length > 0) {
        const assistantManagers =
          await getAssistantManagersByBranches(targetBranchIds);
        assistantManagers.forEach((am) => {
          if (am.email) ccEmails.push(am.email);
        });
      }

      // Exclude current user's email
      ccEmails = ccEmails.filter((email) => email !== currentUser.email);

      // Deduplicate emails
      const uniqueCC = Array.from(new Set(ccEmails));

      setFormData((prev) => ({
        ...prev,
        cc: uniqueCC.join(", "),
      }));

      setIsModalOpen(true);
    } catch (error) {
      console.error("Error preparing mock:", error);
      toast({
        title: "Error",
        description: "Failed to prepare mock interview form.",
        variant: "destructive",
      });
    } finally {
      setIsPreparingMock(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size > 4 * 1024 * 1024) {
        // 4MB limit
        toast({
          title: "File too large",
          description: "Resume must be less than 4MB.",
          variant: "destructive",
        });
        e.target.value = ""; // Reset input
        return;
      }
      setFormData({ ...formData, resume: file });
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
      const leadData = JSON.parse(selectedLead.data);

      // Save signature preferences
      localStorage.setItem(
        "mockSignature",
        JSON.stringify({
          yourName: formData.yourName,
          yourRole: formData.yourRole,
          yourPhone: formData.yourPhone,
          company: formData.company,
        }),
      );

      // Convert file to base64
      let attachment = null;
      if (formData.resume) {
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const result = reader.result as string;
            // Remove data URL prefix (e.g., "data:application/pdf;base64,")
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

      // Format Schedule
      let formattedSchedule = "";
      if (formData.schedule) {
        const date = new Date(formData.schedule);
        // Format: Feb 20, 2026 at 3:00 PM
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

      // Construct email body
      const emailBody = `
        <html>
          <body style="font-family: Arial, sans-serif; color: #333;">
            <p>${formData.emailBody.replace(/\n/g, "<br/>")}</p>

            <table cellpadding="5" cellspacing="0" border="0" style="width: 100%; max-width: 600px; margin-top: 20px; border-collapse: collapse;">
              <tr><td style="font-weight: bold; width: 150px; padding: 5px;">Candidate Name</td><td style="padding: 5px;">${leadData.firstName} ${leadData.lastName}</td></tr>
              <tr><td style="font-weight: bold; padding: 5px;">End Client</td><td style="padding: 5px;">${leadData.company || "Silverspace Inc"}</td></tr>
              <tr><td style="font-weight: bold; padding: 5px;">Role</td><td style="padding: 5px;">${formData.role}</td></tr>
              <tr><td style="font-weight: bold; padding: 5px;">Mode</td><td style="padding: 5px;">${formData.mode}</td></tr>
              <tr><td style="font-weight: bold; padding: 5px;">Schedule</td><td style="padding: 5px;">${formattedSchedule}</td></tr>
              <tr><td style="font-weight: bold; padding: 5px;">Email ID</td><td style="padding: 5px;">${leadData.email || ""}</td></tr>
              <tr><td style="font-weight: bold; padding: 5px;">Contact Number</td><td style="padding: 5px;">${leadData.phone || ""}</td></tr>
            </table>

            <br/>
            <p>Regards,</p>

            <table cellpadding="0" cellspacing="0" border="0" style="font-family: Arial, sans-serif; font-size: 14px; color: rgb(255, 255, 255); background-color: #1a1a1a; padding: 10px; border-radius: 5px;"><tbody><tr><td style="padding-right: 20px;"><div style="filter: drop-shadow(rgba(255, 255, 255, 0.8) 0px 0px 4px) drop-shadow(rgba(255, 255, 255, 0.4) 0px 0px 20px); padding: 4px;"><img src="${logoUrl}" alt="${formData.company} logo" width="130" style="display: block; max-width: 100%; height: auto;"></div></td><td style="border-left: 2px solid rgb(248, 98, 149); padding-left: 20px;"><strong style="font-size: 18px; color: rgb(255, 255, 255); display: block; margin-bottom: 4px;">${formData.yourName}</strong><span style="display: block; margin-bottom: 2px; color: rgb(255, 255, 255);">${formData.yourRole}</span><span style="color: rgb(204, 204, 204); display: block; margin-bottom: 12px;">${formData.company}</span><a href="mailto:${formData.yourName.toLowerCase().replace(/\s+/g, ".")}@silverspaceinc.com" style="color: rgb(255, 255, 255); text-decoration: none; display: block; margin-bottom: 4px;">📧 ${formData.yourName.toLowerCase().replace(/\s+/g, ".")}@silverspaceinc.com</a><a href="tel:${formData.yourPhone}" style="color: rgb(255, 255, 255); text-decoration: none; display: block; margin-bottom: 4px;">📞 ${formData.yourPhone}</a><a href="${websiteLink}" target="_blank" style="color: rgb(255, 255, 255); text-decoration: none; display: block;">🔗 ${websiteUrl}</a></td></tr></tbody></table>
          </body>
        </html>
      `;

      // Construct payload for our API
      const payload = {
        message: {
          subject: `Request to schedule mock interview - ${leadData.firstName} ${leadData.lastName}`,
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
          attachments: attachment ? [attachment] : [],
        },
        saveToSentItems: "true",
      };

      // Send via our server-side API
      const response = await fetch("/api/mock/send-email", {
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

      toast({
        title: "Success",
        description: "Mock interview email sent successfully!",
      });
      setIsModalOpen(false);
      // We don't reset form data here to preserve signature, or we do reset but signature is re-read from state?
      // Actually handleCreateMock resets it properly.
      // But let's reset to initial state for next time, but keep signature?
      // For now, simple reset is fine, next open will re-read or use handleCreateMock logic.
      // Wait, handleCreateMock uses INITIAL_FORM_DATA and merges current state.
      // So if I reset here, I lose current state signature.
      // I should update INITIAL_FORM_DATA to have empty signature, but `handleCreateMock` preserves it.
      // So I can just reset to INITIAL_FORM_DATA here.
      // However, if I close and reopen without refreshing, `prev` in handleCreateMock will be INITIAL_FORM_DATA (empty).
      // So I need to ensure signature is persisted in state or localStorage is read again.
      // `handleCreateMock` reads `prev` state. If I reset state to INITIAL here, `prev` will be empty.
      // So I should reload from localStorage or just not reset the signature fields.

      const storedSignature = localStorage.getItem("mockSignature");
      const parsedSignature = storedSignature
        ? JSON.parse(storedSignature)
        : {};

      // Update Mock Attempts Count using Server Action
      if (user) {
        try {
          const updatedAttempt = await recordMockAttempt(
            user.$id,
            selectedLead.$id,
          );

          setMockAttempts((prev) =>
            new Map(prev).set(selectedLead.$id, {
              $id: updatedAttempt.$id,
              leadId: updatedAttempt.leadId,
              userId: updatedAttempt.userId,
              attemptCount: updatedAttempt.attemptCount,
              lastAttemptAt: updatedAttempt.lastAttemptAt,
            }),
          );
        } catch (e: any) {
          console.error("Failed to record mock attempt:", e);
          // If failed (e.g. limit reached), notify user but email was already sent?
          // Ideally this should be checked BEFORE sending email, but we do optimistic check in handleCreateMock.
          // If server rejects, it means race condition or tampering.
        }
      }

      toast({
        title: "Success",
        description: "Email sent successfully.",
      });

      setIsModalOpen(false);
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

      // If token expired or invalid (server will return 401)
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
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}>
                <option value="all">All Leads</option>
                <option value="mock_created">Mock Created</option>
                <option value="mock_not_created">Mock Not Created</option>
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
                  const status = getCooldownStatus(lead.$id);
                  const attempt = mockAttempts.get(lead.$id);
                  const attemptsCount = attempt?.attemptCount || 0;

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
                      <td className="p-4 flex items-center gap-2">
                        {attemptsCount > 0 && (
                          <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-1 rounded border border-green-200">
                            Mock Created
                          </span>
                        )}
                        {attemptsCount === 0 ? (
                          <Button
                            size="sm"
                            onClick={() => handleCreateMock(lead)}
                            disabled={!isOutlookConnected || isPreparingMock}>
                            {isPreparingMock && selectedLead?.$id === lead.$id
                              ? "Preparing..."
                              : "Create Mock"}
                          </Button>
                        ) : (
                          <div className="flex items-center gap-2">
                            {/* Attempts count display removed as per request */}
                            {attemptsCount < 2 &&
                              (status.canCreate ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleCreateMock(lead)}
                                  disabled={
                                    !isOutlookConnected || isPreparingMock
                                  }>
                                  <RefreshCw className="h-3 w-3 mr-1" />
                                  Retry
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled
                                  className="text-orange-500 border-orange-200 bg-orange-50">
                                  <Clock className="h-3 w-3 mr-1" />
                                  {status.remainingTime}m
                                </Button>
                              ))}
                            {attemptsCount >= 2 && (
                              <span className="text-xs font-medium text-red-500 flex items-center">
                                <AlertCircle className="h-3 w-3 mr-1" />
                                Max Limit
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {paginatedLeads.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
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
            <DialogTitle>Create Mock Interview</DialogTitle>
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
                <div className="p-2 border rounded-md bg-muted text-muted-foreground">
                  Request to schedule mock interview -{" "}
                  {selectedLead
                    ? JSON.parse(selectedLead.data).firstName +
                      " " +
                      JSON.parse(selectedLead.data).lastName
                    : ""}
                </div>
              </div>

              <div className="col-span-2">
                <Label htmlFor="emailBody">Email Content</Label>
                <Textarea
                  id="emailBody"
                  value={formData.emailBody}
                  onChange={(e) =>
                    setFormData({ ...formData, emailBody: e.target.value })
                  }
                  rows={4}
                />
              </div>

              <div className="col-span-2 md:col-span-1">
                <Label htmlFor="role">Role</Label>
                <Input
                  id="role"
                  value={formData.role}
                  onChange={(e) =>
                    setFormData({ ...formData, role: e.target.value })
                  }
                  placeholder="e.g. Data Analyst"
                />
              </div>

              <div className="col-span-2 md:col-span-1">
                <Label htmlFor="mode">Mode</Label>
                <Input
                  id="mode"
                  value={formData.mode}
                  onChange={(e) =>
                    setFormData({ ...formData, mode: e.target.value })
                  }
                  placeholder="Evaluation"
                />
              </div>

              <div className="col-span-2 md:col-span-1">
                <Label htmlFor="schedule">Schedule</Label>
                <Input
                  id="schedule"
                  type="datetime-local"
                  value={formData.schedule}
                  onChange={(e) =>
                    setFormData({ ...formData, schedule: e.target.value })
                  }
                />
              </div>

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

              <div className="col-span-2">
                <Label htmlFor="resume">Upload Resume</Label>
                <Input
                  id="resume"
                  key={fileInputKey}
                  type="file"
                  onChange={handleFileChange}
                  accept=".pdf,.doc,.docx"
                />
              </div>

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
              {isSending ? "Sending..." : "Create Mock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
