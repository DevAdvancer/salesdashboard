"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FOLLOWUPS_PAYMENT_COMPANIES,
  type FollowupsPaymentCompany,
  type PreviousFollowupsPayment,
} from "@/lib/types";

interface FollowupsPaymentFormProps {
  payment?: PreviousFollowupsPayment | null;
  onSave: (payment: FollowupsPaymentFormValues) => void;
  onCancel: () => void;
}

export interface FollowupsPaymentFormValues {
  company: FollowupsPaymentCompany;
  candidateName: string;
  amount: number;
  date: string;
  remark?: string | null;
}

export function FollowupsPaymentForm({
  payment,
  onSave,
  onCancel,
}: FollowupsPaymentFormProps) {
  const [company, setCompany] = useState<FollowupsPaymentCompany>(payment?.company || FOLLOWUPS_PAYMENT_COMPANIES[0]);
  const [candidateName, setCandidateName] = useState(payment?.candidateName || "");
  const [amount, setAmount] = useState(payment?.amount?.toString() || "0");
  const [date, setDate] = useState(payment?.date || new Date().toISOString().slice(0, 10));
  const [remark, setRemark] = useState(payment?.remark || "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      company,
      candidateName,
      amount: parseFloat(amount) || 0,
      date,
      remark: remark || null,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Company</label>
        <Select value={company} onValueChange={(value) => setCompany(value as FollowupsPaymentCompany)}>
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
        <label className="text-sm font-medium">Candidate Name</label>
        <Input
          value={candidateName}
          onChange={(e) => setCandidateName(e.target.value)}
          placeholder="Enter candidate name"
          required
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Amount</label>
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
        <label className="text-sm font-medium">Date</label>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Remark (Optional)</label>
        <Textarea
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder="Add any notes..."
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Status</label>
        <Input value="Paid" disabled />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">
          {payment ? "Update Payment" : "Add Payment"}
        </Button>
      </div>
    </form>
  );
}
