"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getCurrentEasternIsoDate } from "@/lib/utils/eastern-date";
import {
  FOLLOWUPS_PAYMENT_COMPANIES,
  type FollowupsPaymentCompany,
  type PreviousFollowupsPayment,
} from "@/lib/types";
import { followupsPaymentCategory, type FollowupsPaymentCategory } from '@/lib/utils/followups-payment-category';
import { useAuth } from "@/lib/contexts/auth-context";
import { getClientPaymentRecordAction } from "@/app/actions/client-payments/record";
import { listClientPaymentSummariesAction } from '@/app/actions/client-payments/list';
import type { PaymentStatus } from "@/lib/types";
import { listLeadsAction, getLeadAction } from "@/app/actions/lead/queries";
import { getCreditableAgentsAction } from "@/app/actions/previous-followups-payments";

export interface FollowupsPaymentFormValues {
  leadId?: string | null;
  category?: FollowupsPaymentCategory;
  company: FollowupsPaymentCompany;
  candidateName: string;
  amount: number;
  date: string;
  remark?: string | null;
  status?: PaymentStatus;
  hasPaymentRecord?: boolean;
  creditedAgentId?: string | null;
}

interface FollowupsPaymentFormProps {
  payment?: PreviousFollowupsPayment | null;
  isSaving?: boolean;
  onSave: (payment: FollowupsPaymentFormValues) => void;
  onCancel: () => void;
}

export function FollowupsPaymentForm({
  payment,
  isSaving = false,
  onSave,
  onCancel,
}: FollowupsPaymentFormProps) {
  const { user, isTeamLead, isAdmin, isOperations, serverSessionReady } = useAuth();
  
  // BGC is independent for every role that can create followup payments.
  const canUseManual = isTeamLead || isAdmin || isOperations;
  const [mode, setMode] = useState<"manual" | "client" | "bgc">(
    followupsPaymentCategory(payment?.leadId) === "bgc" ? "bgc" : payment?.leadId?.startsWith("manual_followup:") || (canUseManual && !payment)
      ? "manual"
      : "client"
  );

  const [company, setCompany] = useState<FollowupsPaymentCompany>(
    payment?.company || FOLLOWUPS_PAYMENT_COMPANIES[0],
  );
  const [candidateName, setCandidateName] = useState(
    payment?.candidateName || "",
  );
  const [amount, setAmount] = useState(payment ? Math.abs(payment.amount).toString() : "0");
  const [isRefund, setIsRefund] = useState(payment ? payment.status === 'refunded' || payment.amount < 0 : false);
  const [date, setDate] = useState(payment?.date || getCurrentEasternIsoDate());
  const [remark, setRemark] = useState(payment?.remark || "");

  const [status, setStatus] = useState<PaymentStatus>(payment?.status === 'refunded' || (payment?.amount ?? 0) < 0 ? 'refunded' : 'not_paid');
  const [hasPaymentRecord, setHasPaymentRecord] = useState(false);

  // Client Selection State
  const [searchQuery, setSearchQuery] = useState("");
  const [leads, setLeads] = useState<Array<{ id: string; name: string; company: string }>>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string>(
    payment && !payment.leadId?.startsWith("manual_followup:") ? payment.leadId : ""
  );
  const [isSearching, setIsSearching] = useState(false);

  // Agent Selection State
  const [creditableAgents, setCreditableAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [creditedAgentId, setCreditedAgentId] = useState<string>(
    payment ? (payment.creditedAgentId || "none") : canUseManual ? user?.$id || "none" : "none"
  );

  function changeMode(next: "manual" | "client" | "bgc") {
    setMode(next);
    setSelectedLeadId("");
    setSearchQuery("");
    setLeads([]);
    setHasPaymentRecord(false);
    setIsSearching(false);
    setIsLoadingClientData(false);
    setCreditedAgentId(next === 'client' ? 'none' : user?.$id || 'none');
  }

  useEffect(() => {
    if (!user?.$id || !serverSessionReady || !canUseManual) return;
    let cancelled = false;
    async function loadAgents() {
      try {
        const agents = await getCreditableAgentsAction(user!.$id);
        if (!cancelled) {
          setCreditableAgents(agents);
          if (payment) {
             const selected = payment.creditedAgentId;
             if (selected && !agents.find(a => a.id === selected)) {
               setCreditableAgents([{id: selected, name: "Unknown"}, ...agents]);
             }
          }
        }
      } catch (err) {
        console.error("Failed to fetch creditable agents", err);
      }
    }
    loadAgents();
    return () => { cancelled = true; };
  }, [user?.$id, serverSessionReady, canUseManual, payment]);

  // Search effect
  useEffect(() => {
    if (mode !== "client" || !user?.$id || !serverSessionReady) return;
    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      setIsSearching(true);
      try {
        const result = await listLeadsAction(
          {
            includeClosed: true,
            searchQuery: searchQuery || undefined,
          },
          user.$id,
          user.role as any,
          undefined,
          { page: 1, pageSize: 50 }
        );
        const summaries = result.leads.length ? await listClientPaymentSummariesAction({
          actorId: user.$id, leadIds: result.leads.map(lead => lead.$id),
        }) : [];
        const paymentLeadIds = new Set(summaries.map(summary => summary.leadId));
        const mappedLeads = result.leads.filter(lead => lead.isClosed || paymentLeadIds.has(lead.$id)).map((l) => {
          let name = "Unknown";
          let company = "";
          try {
            const data = JSON.parse(l.data);
            const firstName = typeof data.firstName === "string" ? data.firstName.trim() : "";
            const lastName = typeof data.lastName === "string" ? data.lastName.trim() : "";
            name = [firstName, lastName].filter(Boolean).join(" ") || (data.email as string) || "Unknown";
            company = typeof data.company === "string" ? data.company.trim() : "";
          } catch {}
          return { id: l.$id, name, company };
        });
        if (!cancelled) setLeads(mappedLeads);
      } catch (err) {
        console.error("Failed to search leads", err);
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, 500);

    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [searchQuery, mode, user?.$id, serverSessionReady]);

  const [isLoadingClientData, setIsLoadingClientData] = useState(false);

  useEffect(() => {
    if (mode !== "client" || !selectedLeadId || selectedLeadId.startsWith("manual_followup:") || !user || !serverSessionReady) {
      return;
    }

    let cancelled = false;
    setIsLoadingClientData(true);

    async function fetchCurrentClientData() {
      // Fetch payment record — use the top-level `status` field
      try {
        const record = await getClientPaymentRecordAction(user!.$id, selectedLeadId);
        if (!cancelled) {
          if (record) {
            setHasPaymentRecord(true);
            if (!payment) {
              setStatus(record.status || "not_paid");
              setIsRefund(record.status === 'refunded');
            }
          } else {
            setHasPaymentRecord(false);
            setStatus("not_paid");
          }
        }
      } catch (e) {
        console.error("Failed to fetch payment record", e);
        if (!cancelled) {
          setHasPaymentRecord(false);
          setStatus("not_paid");
        }
      }

      // Fetch lead company from lead data
      try {
        const lead = await getLeadAction(selectedLeadId, user!.$id);
        if (!cancelled && lead && lead.data) {
          const data = JSON.parse(lead.data);
          const leadCompany = typeof data.company === "string" ? data.company.trim() : "";
          if (leadCompany && !payment) {
            // Case-insensitive match against known companies
            const matched = FOLLOWUPS_PAYMENT_COMPANIES.find(
              (c) => c.toLowerCase() === leadCompany.toLowerCase()
            );
            if (matched) {
              setCompany(matched);
            }
          }
        }
      } catch (e) {
        console.error("Failed to fetch lead for company", e);
      }

      if (!cancelled) {
        setIsLoadingClientData(false);
      }
    }

    fetchCurrentClientData();

    return () => {
      cancelled = true;
    };
  }, [selectedLeadId, mode, user, serverSessionReady]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      leadId: mode === "client" ? selectedLeadId : payment?.leadId || null,
      category: mode === "bgc" ? "bgc" : "followup",
      company,
      candidateName,
      amount: (parseFloat(amount) || 0) * (isRefund ? -1 : 1),
      date,
      remark: remark || null,
      status: isRefund ? 'refunded' : status,
      hasPaymentRecord: mode === "client" && hasPaymentRecord,
      creditedAgentId: creditedAgentId === "none" ? null : (creditedAgentId || null),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {!payment && (
        <div className="flex flex-wrap bg-muted p-1 rounded-md border">
          {canUseManual && <button
            type="button"
            onClick={() => changeMode("manual")}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
              mode === "manual" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Manual Entry
          </button>}
          <button
            type="button"
            onClick={() => changeMode("client")}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
              mode === "client" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Client Entry (Tracked)
          </button>
          <button type="button" onClick={() => changeMode("bgc")}
            className={`px-4 py-1.5 text-sm font-medium rounded-md ${mode === "bgc" ? "bg-background shadow-sm" : "text-muted-foreground"}`}>
            BGC
          </button>
        </div>
      )}

      {mode === "bgc" && <p className="text-sm text-muted-foreground">Independent BGC profile. Payments and refunds count toward the credited profile&apos;s target on the payment date.</p>}

      {mode === "client" && !payment && (
        <div className="space-y-3 p-4 bg-muted/50 border rounded-xl">
          <div className="space-y-2 relative">
            <label className="text-sm font-semibold text-foreground">Search and Select Client</label>
            <Input
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelectedLeadId("");
              }}
              placeholder="Type to search your assigned clients..."
              className="bg-background"
            />
            {isSearching && <p className="text-xs text-muted-foreground mt-1">Searching...</p>}
            
            {leads.length > 0 && !selectedLeadId && searchQuery.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-background border rounded-md shadow-md max-h-48 overflow-y-auto">
                {leads.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-muted text-sm text-foreground transition-colors"
                    onClick={async () => {
                      setSelectedLeadId(l.id);
                      setCandidateName(l.name);
                      setSearchQuery(l.name);
                      if (l.company && FOLLOWUPS_PAYMENT_COMPANIES.includes(l.company as any)) {
                        setCompany(l.company as FollowupsPaymentCompany);
                      }
                      setLeads([]);
                    }}
                  >
                    {l.name}
                  </button>
                ))}
              </div>
            )}
            
            {!isSearching && leads.length === 0 && searchQuery.length > 0 && !selectedLeadId && (
              <p className="text-xs text-muted-foreground mt-1">No clients found.</p>
            )}
          </div>
        </div>
      )}

      {isLoadingClientData && (
        <p className="text-xs text-muted-foreground animate-pulse">Loading client data...</p>
      )}

      {canUseManual && creditableAgents.length > 0 && (
        <div className="space-y-2 bg-muted/30 p-3 rounded-lg border">
          <label className="text-sm font-semibold text-foreground">Credit To (Agent)</label>
          <Select value={creditedAgentId} onValueChange={setCreditedAgentId}>
            <SelectTrigger className="bg-background">
              <span>
                {creditedAgentId === "none"
                  ? mode === "client"
                    ? "Assigned profile (default)"
                    : "Select Agent"
                  : creditableAgents.find((a) => a.id === creditedAgentId)?.name ||
                    creditedAgentId ||
                    "Select Agent"}
              </span>
            </SelectTrigger>
            <SelectContent className="max-h-60 overflow-y-auto">
              {mode === "client" && (
                <SelectItem value="none">Assigned profile (default)</SelectItem>
              )}
              {creditableAgents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1">
            This followup will be securely credited to this agent&apos;s daily stats and Target Report.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-semibold text-foreground">
            Company {isLoadingClientData && <span className="animate-pulse">...</span>}
          </label>
          <Select
            value={company}
            onValueChange={(value) =>
              setCompany(value as FollowupsPaymentCompany)
            }>
            <SelectTrigger>
              <SelectValue placeholder="Select company" />
            </SelectTrigger>
            <SelectContent className="max-h-60 overflow-y-auto">
              {FOLLOWUPS_PAYMENT_COMPANIES.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-foreground">Candidate Name</label>
          <Input
            value={candidateName}
            onChange={(e) => setCandidateName(e.target.value)}
            placeholder="Enter candidate name"
            required
            disabled={mode === "client"}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label htmlFor="followup-payment-status" className="text-sm font-semibold text-foreground">Status</label>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value as PaymentStatus);
              setIsRefund(value === 'refunded');
            }}
            disabled={mode === 'client' && !selectedLeadId}
          >
            <SelectTrigger id="followup-payment-status">
              {status === 'refunded' ? <span>Refunded</span> : <SelectValue placeholder="Select status" />}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="not_paid">Not Paid</SelectItem>
              <SelectItem value="partially_paid">Partially Paid</SelectItem>
              <SelectItem value="non_upfront">Non-Upfront</SelectItem>
              <SelectItem value="fully_paid">Fully Paid</SelectItem>
              <SelectItem value="refunded">Refunded</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-foreground">Amount</label>
          <div className="flex items-center gap-2 mb-2">
            <input
              type="checkbox"
              id="isRefund"
              checked={isRefund}
              onChange={(e) => {
                setIsRefund(e.target.checked);
                setStatus(e.target.checked ? 'refunded' : 'not_paid');
              }}
            />
            <label htmlFor="isRefund" className="text-sm text-muted-foreground">
              Is this a refund?
            </label>
          </div>
          <Input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            min="0"
            required
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="followup-payment-date" className="text-sm font-semibold text-foreground">Date</label>
          <Input
            id="followup-payment-date"
            type="date"
            className="bg-none pr-3 [&::-webkit-calendar-picker-indicator]:m-0 [&::-webkit-calendar-picker-indicator]:p-0 [&::-webkit-calendar-picker-indicator]:opacity-100"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-semibold text-foreground">Remark (Optional)</label>
        <Textarea
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder="Add any notes..."
          rows={3}
        />
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="outline" onClick={onCancel} className="px-6">
          Cancel
        </Button>
        <Button 
          type="submit" 
          disabled={isSaving || (mode === "client" && !selectedLeadId && !payment)}
          className="bg-blue-600 hover:bg-blue-700 px-6 shadow-md"
        >
          {isSaving ? "Saving..." : payment ? "Update Payment" : "Add Payment"}
        </Button>
      </div>
    </form>
  );
}
