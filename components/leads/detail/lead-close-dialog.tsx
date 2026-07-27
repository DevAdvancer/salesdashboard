"use client";

import type { Dispatch, SetStateAction } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormField, LeadData, PaymentStatus } from "@/lib/types";
import {
  isBackoutStatus,
  isLinkedinRequestLead,
} from "./lead-detail-utils";
import {
  isPaymentDetailsMissing,
  getMissingPaymentFields,
} from "@/lib/utils/lead-close-gate";

interface LeadCloseDialogProps {
  leadData: LeadData;
  leadId: string;
  userId: string;
  userName: string;
  userRole: string;
  userDepartment: string;
  closeStep: number;
  setCloseStep: Dispatch<SetStateAction<number>>;
  closeStatus: string;
  setCloseStatus: Dispatch<SetStateAction<string>>;
  initialPaymentStatus: string;
  setInitialPaymentStatus: Dispatch<SetStateAction<string>>;
  closureFields: FormField[];
  paymentPlanFields: FormField[];
  closureValues: Record<string, unknown>;
  setClosureValues: Dispatch<SetStateAction<Record<string, unknown>>>;
  paymentPlanValues: Record<string, unknown>;
  setPaymentPlanValues: Dispatch<SetStateAction<Record<string, unknown>>>;
  isSaving: boolean;
  isCloseRequiredFieldsMissingFlag: boolean;
  missingCloseRequiredFields: string[];
  onClose: () => void;
  onConfirmClose: () => void;
  renderCloseField: (
    field: FormField,
    values: Record<string, unknown>,
    setValues: Dispatch<SetStateAction<Record<string, unknown>>>,
  ) => React.ReactNode;
}

export function LeadCloseDialog({
  leadData,
  closeStep,
  setCloseStep,
  closeStatus,
  setCloseStatus,
  initialPaymentStatus,
  setInitialPaymentStatus,
  closureFields,
  paymentPlanFields,
  closureValues,
  setClosureValues,
  paymentPlanValues,
  setPaymentPlanValues,
  isSaving,
  isCloseRequiredFieldsMissingFlag,
  missingCloseRequiredFields,
  onClose,
  onConfirmClose,
  renderCloseField,
}: LeadCloseDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <Card className="w-full sm:max-w-2xl sm:mx-4 rounded-b-none sm:rounded-b-lg">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            <span>Close Lead</span>
            <span className="text-sm text-muted-foreground">
              Step {closeStep} of 3
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {closeStep === 1 && (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">
                  Personal Details
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {closureFields
                  .filter((field) => field.visible)
                  .map((field) => (
                    <div key={field.id} className="space-y-2">
                      <Label htmlFor={field.key}>
                        {field.label}
                        {field.required && (
                          <span className="text-red-500 ml-1">*</span>
                        )}
                      </Label>
                      {renderCloseField(
                        field,
                        closureValues,
                        setClosureValues,
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}

          {closeStep === 2 && (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">
                  Payment Plan
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {paymentPlanFields
                  .filter((field) => {
                    if (!field.visible) return false;
                    if (field.key === "paymentMonths" && paymentPlanValues.paymentPercent === "H1B Agreement") {
                      return false;
                    }
                    return true;
                  })
                  .map((field) => (
                    <div key={field.id} className="space-y-2">
                      <Label htmlFor={field.key}>
                        {field.label}
                        {field.required && (
                          <span className="text-red-500 ml-1">*</span>
                        )}
                      </Label>
                      {renderCloseField(
                        field,
                        paymentPlanValues,
                        setPaymentPlanValues,
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}

          {closeStep === 3 && (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">
                  Final Status & Confirmation
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="closeStatus">Final Status</Label>
                  <select
                    id="closeStatus"
                    className="flex h-10 w-full rounded-md border border-input bg-background pl-3 pr-8 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    value={closeStatus}
                    onChange={(e) => setCloseStatus(e.target.value)}>
                    {isLinkedinRequestLead(leadData) ? (
                      <>
                        <option value="Signed/Closure">
                          Signed/Closure
                        </option>
                      </>
                    ) : (
                      <>
                        <option value="Won">Won</option>
                        <option value="Lost">Lost</option>
                        <option value="Rejected">Rejected</option>
                      </>
                    )}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="initialPaymentStatus">
                    Initial Payment Status
                  </Label>
                  <select
                    id="initialPaymentStatus"
                    className="flex h-10 w-full rounded-md border border-input bg-background pl-3 pr-8 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    value={
                      initialPaymentStatus ||
                      (Number(paymentPlanValues.upfrontAmount) > 0
                        ? "partially_paid"
                        : "not_paid")
                    }
                    onChange={(e) =>
                      setInitialPaymentStatus(e.target.value)
                    }>
                    <option value="not_paid">Not Paid</option>
                    <option value="partially_paid">Partially Paid</option>
                    <option value="fully_paid">Fully Paid</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-col-reverse sm:flex-row justify-between gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              className="w-full sm:w-auto">
              Cancel
            </Button>
            <div className="flex flex-col-reverse sm:flex-row gap-2">
              {closeStep > 1 && (
                <Button
                  variant="outline"
                  onClick={() => setCloseStep((s) => Math.max(1, s - 1))}
                  className="w-full sm:w-auto">
                  Back
                </Button>
              )}
              {closeStep < 3 ? (
                <Button
                  onClick={() => setCloseStep((s) => Math.min(3, s + 1))}
                  className="w-full sm:w-auto">
                  Next
                </Button>
              ) : (
                <Button
                  onClick={onConfirmClose}
                  disabled={
                    isSaving ||
                    (!isBackoutStatus(closeStatus) &&
                      isCloseRequiredFieldsMissingFlag)
                  }
                  title={
                    !isBackoutStatus(closeStatus) &&
                    isCloseRequiredFieldsMissingFlag
                      ? `Fill ${missingCloseRequiredFields.join(
                          ", ",
                        )} in the lead form before closing. N/A, blank, or whitespace is not accepted.`
                      : undefined
                  }
                  variant="destructive"
                  className="w-full sm:w-auto">
                  {isSaving ? "Closing..." : "Close Lead"}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
