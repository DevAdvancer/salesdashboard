"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";
import { ProtectedRoute } from "@/components/protected-route";
import {
  createPreviousFollowupsPaymentAction,
  deletePreviousFollowupsPaymentAction,
  listPreviousFollowupsPaymentsAction,
  updatePreviousFollowupsPaymentAction,
} from "@/app/actions/previous-followups-payments";
import { addClientPaymentUpdateAction } from "@/app/actions/client-payments";
import type { ComponentKey } from "@/lib/contexts/access-control-context";
import type { PreviousFollowupsPayment, PaymentStatus } from "@/lib/types";
import { getCurrentEasternMonthKey } from "@/lib/utils/eastern-date";

const FollowupsPaymentForm = dynamic(
  () =>
    import("@/components/followups/followups-payment-form").then(
      (m) => m.FollowupsPaymentForm,
    ),
  { loading: () => <Skeleton className="h-96 w-full" />, ssr: false },
);

const FollowupsPaymentTable = dynamic(
  () =>
    import("@/components/followups/followups-payment-table").then(
      (m) => m.FollowupsPaymentTable,
    ),
  { loading: () => <Skeleton className="h-[400px] w-full" />, ssr: false },
);

const COMPONENT_KEY: ComponentKey = "followups-payments";

export default function PreviousFollowupsPaymentsPage() {
  const { user, isAdmin, isTeamLead, isOperations, serverSessionReady } =
    useAuth();
  const { toast } = useToast();
  const isAgentOrLeadGen = user?.role === "agent" || user?.role === "lead_generation";
  const canMutate = isAdmin || isTeamLead || isAgentOrLeadGen;

  const [payments, setPayments] = useState<PreviousFollowupsPayment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingPayment, setEditingPayment] =
    useState<PreviousFollowupsPayment | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const loadPayments = useCallback(async () => {
    if (!user || !serverSessionReady) {
      return;
    }

    setIsLoading(true);
    try {
      const rows = await listPreviousFollowupsPaymentsAction({
        actorId: user.$id,
      });
      setPayments(rows);
    } catch (error) {
      console.error("Failed to load followup payments:", error);
      toast({
        title: "Failed to load payments",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [serverSessionReady, toast, user]);

  useEffect(() => {
    if (!user || !serverSessionReady) return;
    void loadPayments();
  }, [loadPayments, serverSessionReady, user]);

  const thisMonthKey = getCurrentEasternMonthKey();
  const thisMonthPayments = useMemo(
    () => payments.filter((payment) => payment.date.startsWith(thisMonthKey)),
    [payments, thisMonthKey],
  );

  const closeDialog = () => {
    setShowForm(false);
    setEditingPayment(null);
  };

  const allowedRoles = ["admin", "developer", "operations", "monitor", "team_lead", "agent", "lead_generation"];
  const isAllowed = user?.role && allowedRoles.includes(user.role);

  if (!isAllowed) {
    return (
      <ProtectedRoute componentKey={COMPONENT_KEY}>
        <div className="container mx-auto py-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">
                Followup Payments
              </h1>
              <p className="text-muted-foreground">
                You do not have permission to view this page.
              </p>
            </div>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  async function handleSave(payment: {
    leadId?: string | null;
    company: PreviousFollowupsPayment["company"];
    candidateName: string;
    amount: number;
    date: string;
    remark?: string | null;
    status?: PaymentStatus;
    hasPaymentRecord?: boolean;
  }) {
    if (!user || !canMutate) {
      return;
    }

    setIsSaving(true);
    try {
      if (editingPayment) {
        await updatePreviousFollowupsPaymentAction({
          actorId: user.$id,
          paymentId: editingPayment.$id,
          leadId: payment.leadId,
          company: payment.company,
          candidateName: payment.candidateName,
          amount: payment.amount,
          date: payment.date,
          remark: payment.remark,
        });
        toast({
          title: "Payment updated",
          description: "The followup payment was updated successfully.",
        });
      } else {
        await createPreviousFollowupsPaymentAction({
          actorId: user.$id,
          leadId: payment.leadId,
          company: payment.company,
          candidateName: payment.candidateName,
          amount: payment.amount,
          date: payment.date,
          remark: payment.remark,
        });
        toast({
          title: "Payment added",
          description:
            "The amount will be included in this month's followup payments.",
        });
      }

      if (payment.status && payment.hasPaymentRecord && payment.leadId) {
        try {
          await addClientPaymentUpdateAction({
            actorId: user.$id,
            leadId: payment.leadId,
            status: payment.status,
            note: payment.remark || "Followup payment added",
            amount: payment.amount,
          });
        } catch (e) {
          console.error("Failed to update client payment status", e);
        }
      }

      closeDialog();
      await loadPayments();
    } catch (error) {
      console.error("Failed to save followup payment:", error);
      toast({
        title: "Failed to save payment",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(payment: PreviousFollowupsPayment) {
    if (!user || !canMutate) {
      return;
    }

    const confirmed = window.confirm(
      `Delete payment for ${payment.candidateName}?`,
    );
    if (!confirmed) return;

    try {
      await deletePreviousFollowupsPaymentAction({
        actorId: user.$id,
        paymentId: payment.$id,
      });
      toast({
        title: "Payment deleted",
        description: "The followup payment has been removed.",
      });
      await loadPayments();
    } catch (error) {
      console.error("Failed to delete followup payment:", error);
      toast({
        title: "Failed to delete payment",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  return (
    <ProtectedRoute componentKey={COMPONENT_KEY}>
      <div className="min-h-screen bg-background">
        <div className="container mx-auto py-10 px-4 md:px-8">
          
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
            <div className="space-y-1">
              <h1 className="text-3xl font-extrabold tracking-tight">
                Followup Payments
              </h1>
              <p className="text-muted-foreground text-sm">
                Track manual and client-linked followup payments for your team
              </p>
            </div>
            {canMutate ? (
              <Button 
                onClick={() => setShowForm(true)}
                className="shadow-md transition-all active:scale-95"
              >
                Add Followup Payment
              </Button>
            ) : (
              <Badge variant="secondary" className="px-3 py-1 text-sm">Read only</Badge>
            )}
          </div>

        <div className="grid gap-6 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Total Payments
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {payments
                  .reduce((sum, p) => sum + p.amount, 0)
                  .toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground">
                {payments.length} entries
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Paid Amount</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-500">
                {payments
                  .reduce((sum, p) => sum + p.amount, 0)
                  .toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground">
                All followup payments are marked paid
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">This Month</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-500">
                {thisMonthPayments
                  .reduce((sum, p) => sum + p.amount, 0)
                  .toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground">
                {thisMonthPayments.length} payments
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Status</CardTitle>
            </CardHeader>
            <CardContent>
              <Badge
                variant="secondary"
                className="text-xs bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-400">
                {payments.length} Paid
              </Badge>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Payment History</CardTitle>
            <CardDescription>All recorded followup payments</CardDescription>
          </CardHeader>
          <CardContent>
            <FollowupsPaymentTable
              payments={payments}
              isLoading={isLoading}
              canEdit={canMutate}
              onEdit={(payment) => {
                if (!canMutate) return;
                setEditingPayment(payment);
                setShowForm(true);
              }}
              onDelete={canMutate ? handleDelete : undefined}
            />
          </CardContent>
        </Card>

        {(showForm || editingPayment) && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <CardHeader>
                <CardTitle>
                  {editingPayment
                    ? "Edit Followup Payment"
                    : "Add Followup Payment"}
                </CardTitle>
                <CardDescription>
                  {editingPayment
                    ? "Update an existing followup payment entry"
                    : "Add candidate name, company, and amount so it counts toward the month's followup payments."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FollowupsPaymentForm
                  payment={editingPayment}
                  onSave={handleSave}
                  onCancel={closeDialog}
                />
                {isSaving ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Saving payment...
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
      </div>
    </ProtectedRoute>
  );
}
