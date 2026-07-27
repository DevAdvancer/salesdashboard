"use client";

import type { Lead } from "@/lib/types";
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
import { useToast } from "@/components/ui/use-toast";

interface UpfrontPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedLeadForUpfront: Lead | null;
  upfrontAmount: string;
  onUpfrontAmountChange: (amount: string) => void;
  onContinue: (lead: Lead, amount: number) => void;
  /** Whether a lead is already selected in the main assessment modal */
  hasSelectedLead: boolean;
  onClearSelectedLead: () => void;
}

export function UpfrontPaymentDialog({
  open,
  onOpenChange,
  selectedLeadForUpfront,
  upfrontAmount,
  onUpfrontAmountChange,
  onContinue,
  hasSelectedLead,
  onClearSelectedLead,
}: UpfrontPaymentDialogProps) {
  const { toast } = useToast();

  return (
    <Dialog open={open} onOpenChange={(openState) => {
      if (!openState && !hasSelectedLead) {
        onClearSelectedLead();
      }
      onOpenChange(openState);
    }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Upfront Payment</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="mb-4">
            Before creating Assessment Support, please enter the upfront payment amount for this candidate:
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
              onChange={(e) => onUpfrontAmountChange(e.target.value)}
              required
            />
          </div>
        </div>
        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
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

              onContinue(selectedLeadForUpfront, amount);
            }}
          >
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
