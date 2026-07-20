"use client";

import { useEffect, useState, useMemo } from "react";
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
import { useAuth } from "@/lib/contexts/auth-context";
import { listLeadsAction, getLeadAction } from "@/app/actions/lead";
import { isVisibleClientLead } from "@/lib/utils/client-history";
import { getClientPaymentRecordAction } from "@/app/actions/client-payments";
import type { PaymentStatus } from "@/lib/types";

export interface FollowupsPaymentFormValues {
  leadId?: string | null;
  company: FollowupsPaymentCompany;
  candidateName: string;
  amount: number;
  date: string;
  remark?: string | null;
  status?: PaymentStatus;
  hasPaymentRecord?: boolean;
}

interface FollowupsPaymentFormProps {
  payment?: PreviousFollowupsPayment | null;
  onSave: (payment: FollowupsPaymentFormValues) => void;
  onCancel: () => void;
}

export function FollowupsPaymentForm({
  payment,
  onSave,
  onCancel,
}: FollowupsPaymentFormProps) {
  const { user, isTeamLead, isAdmin, isOperations, serverSessionReady } = useAuth();
  
  // Agents only have 'client' mode. Leadership has both.
  const canUseManual = isTeamLead || isAdmin || isOperations;
  const [mode, setMode] = useState<"manual" | "client">(
    canUseManual && (!payment || payment.leadId?.startsWith("manual_followup:"))
      ? "manual"
      : "client"
  );

  const [company, setCompany] = useState<FollowupsPaymentCompany>(
    payment?.company || FOLLOWUPS_PAYMENT_COMPANIES[0],
  );
  const [candidateName, setCandidateName] = useState(
    payment?.candidateName || "",
  );
  const [amount, setAmount] = useState(payment?.amount?.toString() || "0");
  const [date, setDate] = useState(payment?.date || getCurrentEasternIsoDate());
  const [remark, setRemark] = useState(payment?.remark || "");

  const [status, setStatus] = useState<PaymentStatus>("not_paid");
  const [hasPaymentRecord, setHasPaymentRecord] = useState(false);

  // Client Selection State
  const [searchQuery, setSearchQuery] = useState("");
  const [leads, setLeads] = useState<Array<{ id: string; name: string; company: string }>>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string>(
    payment && !payment.leadId?.startsWith("manual_followup:") ? payment.leadId : ""
  );
  const [isSearching, setIsSearching] = useState(false);

  // Search effect
  useEffect(() => {
    if (mode !== "client" || !user?.$id || !serverSessionReady) return;
    const timeoutId = setTimeout(async () => {
      setIsSearching(true);
      try {
        const result = await listLeadsAction(
          {
            isClosed: true,
            searchQuery: searchQuery || undefined,
          },
          user.$id,
          user.role as any,
          undefined,
          { page: 1, pageSize: 50 }
        );
        const mappedLeads = result.leads.filter(isVisibleClientLead).map((l) => {
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
        setLeads(mappedLeads);
      } catch (err) {
        console.error("Failed to search leads", err);
      } finally {
        setIsSearching(false);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, mode, user?.$id, serverSessionReady]);

  const [isLoadingClientData, setIsLoadingClientData] = useState(false);

  useEffect(() => {
    if (!selectedLeadId || selectedLeadId.startsWith("manual_followup:") || !user || !serverSessionReady) {
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
            setStatus(record.status || "not_paid");
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
          if (leadCompany) {
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
  }, [selectedLeadId, user, serverSessionReady]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      leadId: mode === "client" ? selectedLeadId : null,
      company,
      candidateName,
      amount: parseFloat(amount) || 0,
      date,
      remark: remark || null,
      status: mode === "client" && selectedLeadId ? status : undefined,
      hasPaymentRecord,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {canUseManual && !payment && (
        <div className="flex bg-muted p-1 rounded-md border w-max">
          <button
            type="button"
            onClick={() => setMode("manual")}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
              mode === "manual" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Manual Entry (No Reports)
          </button>
          <button
            type="button"
            onClick={() => setMode("client")}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
              mode === "client" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Client Entry (Tracked)
          </button>
        </div>
      )}

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
            <SelectContent>
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
          <label className="text-sm font-semibold text-foreground">Status</label>
          <Select
            value={status}
            onValueChange={(value) => setStatus(value as PaymentStatus)}
            disabled={mode !== "client" || !selectedLeadId || !hasPaymentRecord}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="not_paid">Not Paid</SelectItem>
              <SelectItem value="partially_paid">Partially Paid</SelectItem>
              <SelectItem value="non_upfront">Non-Upfront</SelectItem>
              <SelectItem value="fully_paid">Fully Paid</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-foreground">Amount</label>
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
          <label className="text-sm font-semibold text-foreground">Date</label>
          <Input
            type="date"
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
          disabled={mode === "client" && !selectedLeadId && !payment}
          className="bg-blue-600 hover:bg-blue-700 px-6 shadow-md"
        >
          {payment ? "Update Payment" : "Add Payment"}
        </Button>
      </div>
    </form>
  );
}
