"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PaymentStatus } from "@/lib/types";

interface ClientPaymentUpdateCardProps {
  paymentStatus: PaymentStatus;
  setPaymentStatus: (val: PaymentStatus) => void;
  editUpfrontAmount: string;
  setEditUpfrontAmount: (val: string) => void;
  paymentNote: string;
  setPaymentNote: (val: string) => void;
  handleAddPaymentUpdate: () => void;
  paymentSaving: boolean;
  canEditClientPayments: boolean;
}

export function ClientPaymentUpdateCard({
  paymentStatus,
  setPaymentStatus,
  editUpfrontAmount,
  setEditUpfrontAmount,
  paymentNote,
  setPaymentNote,
  handleAddPaymentUpdate,
  paymentSaving,
  canEditClientPayments,
}: ClientPaymentUpdateCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Update Payment Status</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Status</label>
            <Select
              value={paymentStatus}
              onValueChange={(val) => setPaymentStatus(val as PaymentStatus)}
              disabled={!canEditClientPayments || paymentSaving}>
              <SelectTrigger>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="not_paid">Not Paid</SelectItem>
                <SelectItem value="partially_paid">Partially Paid</SelectItem>
                <SelectItem value="fully_paid">Fully Paid</SelectItem>
                <SelectItem value="non_upfront">Non-Upfront</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Amount Paid ($)
            </label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={editUpfrontAmount}
              onChange={(e) => setEditUpfrontAmount(e.target.value)}
              disabled={!canEditClientPayments || paymentSaving}
              placeholder="e.g. 1000.00"
            />
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Note / Check Number</label>
          <Textarea
            value={paymentNote}
            onChange={(e) => setPaymentNote(e.target.value)}
            disabled={!canEditClientPayments || paymentSaving}
            placeholder="Add payment details, check numbers, or transaction IDs..."
            className="min-h-[100px]"
          />
        </div>
        <Button
          onClick={handleAddPaymentUpdate}
          disabled={
            !canEditClientPayments || paymentSaving || !paymentNote.trim()
          }>
          {paymentSaving ? "Saving..." : "Add Update"}
        </Button>
      </CardContent>
    </Card>
  );
}
