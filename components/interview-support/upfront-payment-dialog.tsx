"use client";

import { useState } from "react";
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
import type { Lead } from "@/lib/types";

interface UpfrontPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedLead: Lead | null;
  onConfirm: (lead: Lead, amount: number) => void;
}

export function UpfrontPaymentDialog({
  open,
  onOpenChange,
  selectedLead,
  onConfirm,
}: UpfrontPaymentDialogProps) {
  const { toast } = useToast();
  const [upfrontAmount, setUpfrontAmount] = useState("");

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setUpfrontAmount("");
    }
    onOpenChange(nextOpen);
  };

  const handleConfirm = () => {
    if (!selectedLead) return;
    const amount = Number(upfrontAmount);
    if (isNaN(amount) || amount < 0) {
      toast({ title: "Invalid Amount", description: "Please enter a valid amount", variant: "destructive" });
      return;
    }
    setUpfrontAmount("");
    onConfirm(selectedLead, amount);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Upfront Payment</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="mb-4">
            Before creating Interview Support, please enter the upfront payment amount for this candidate:
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
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
