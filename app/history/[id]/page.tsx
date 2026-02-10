'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/contexts/auth-context';
import { useRouter, useParams } from 'next/navigation';
import { getLead, reopenLead } from '@/lib/services/lead-service';
import { getFormConfig } from '@/lib/services/form-config-service';
import { Lead, FormField, LeadData } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { ProtectedRoute } from '@/components/protected-route';

export default function HistoryDetailPage() {
  return (
    <ProtectedRoute componentKey="history">
      <HistoryDetailContent />
    </ProtectedRoute>
  );
}

function HistoryDetailContent() {
  const { user, loading: authLoading, isManager } = useAuth();
  const router = useRouter();
  const params = useParams();
  const { toast } = useToast();
  const leadId = params.id as string;

  const [lead, setLead] = useState<Lead | null>(null);
  const [leadData, setLeadData] = useState<LeadData>({});
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isReopening, setIsReopening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReopenDialog, setShowReopenDialog] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
      return;
    }

    if (user && leadId) {
      loadLead();
      loadFormConfig();
    }
  }, [user, authLoading, leadId, router]);

  const loadLead = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const fetchedLead = await getLead(leadId);

      // Verify this is a closed lead
      if (!fetchedLead.isClosed) {
        router.push(`/leads/${leadId}`);
        return;
      }

      setLead(fetchedLead);
      setLeadData(JSON.parse(fetchedLead.data));
    } catch (err: any) {
      console.error('Error loading lead:', err);
      setError(err.message || 'Failed to load lead');
    } finally {
      setIsLoading(false);
    }
  };

  const loadFormConfig = async () => {
    try {
      const config = await getFormConfig();
      setFormFields(config.fields.sort((a, b) => a.order - b.order));
    } catch (err: any) {
      console.error('Error loading form config:', err);
    }
  };

  const handleReopenLead = async () => {
    if (!lead || !isManager) return;

    try {
      setIsReopening(true);
      await reopenLead(leadId);
      toast({
        title: 'Success',
        description: 'Lead reopened successfully',
      });
      setShowReopenDialog(false);
      router.push(`/leads/${leadId}`);
    } catch (err: any) {
      console.error('Error reopening lead:', err);
      toast({
        title: 'Error',
        description: err.message || 'Failed to reopen lead',
        variant: 'destructive',
      });
    } finally {
      setIsReopening(false);
    }
  };

  const renderField = (field: FormField) => {
    const value = leadData[field.key] || '';

    switch (field.type) {
      case 'textarea':
        return (
          <textarea
            id={field.key}
            className="w-full min-h-[100px] px-3 py-2 rounded-md border border-input bg-muted text-muted-foreground"
            value={value}
            disabled
            readOnly
          />
        );

      case 'dropdown':
        return (
          <Input
            id={field.key}
            type="text"
            value={value}
            disabled
            readOnly
          />
        );

      case 'checklist':
        return (
          <div className="space-y-2">
            {field.options?.map((option) => (
              <div key={option} className="flex items-center">
                <input
                  type="checkbox"
                  checked={Array.isArray(value) && value.includes(option)}
                  disabled
                  readOnly
                  className="mr-2"
                />
                <span className="text-muted-foreground">{option}</span>
              </div>
            ))}
          </div>
        );

      default:
        return (
          <Input
            id={field.key}
            type={field.type}
            value={value}
            disabled
            readOnly
          />
        );
    }
  };

  if (authLoading || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg text-muted-foreground">Loading lead history...</p>
      </div>
    );
  }

  if (error || !lead) {
    return (
      <div className="container mx-auto">
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">{error || 'Lead not found'}</p>
            <Button onClick={() => router.push('/history')} className="mt-4">
              Back to History
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <Button
            variant="outline"
            onClick={() => router.push('/history')}
            className="mb-2"
          >
            ← Back to History
          </Button>
          <h1 className="text-2xl md:text-3xl font-bold">Lead History Detail</h1>
          <p className="text-muted-foreground mt-1">Read-only view of closed lead</p>
        </div>
        <div className="flex gap-2">
          {isManager && (
            <Button
              onClick={() => setShowReopenDialog(true)}
              variant="default"
            >
              Reopen Lead
            </Button>
          )}
        </div>
      </div>

      {/* Closure Information Banner */}
      <Card className="mb-6 border-yellow-700 bg-yellow-900/20">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2">
            <svg
              className="w-5 h-5 text-yellow-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div>
              <p className="text-yellow-500 font-semibold">This lead is closed</p>
              <p className="text-muted-foreground text-sm">
                Closed on {lead.closedAt ? new Date(lead.closedAt).toLocaleString() : 'N/A'} with
                status: <span className="font-semibold text-foreground">{lead.status}</span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6">
        {/* Lead Information */}
        <Card>
          <CardHeader>
            <CardTitle>Lead Information</CardTitle>
            <p className="text-sm text-muted-foreground">All fields are read-only</p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {formFields.map((field) => (
                <div key={field.id}>
                  <Label htmlFor={field.key}>
                    {field.label}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                    {!field.visible && (
                      <span className="ml-2 text-xs text-muted-foreground">(Hidden field)</span>
                    )}
                  </Label>
                  {renderField(field)}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Closure Metadata */}
        <Card>
          <CardHeader>
            <CardTitle>Closure Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Status</Label>
                <p className="mt-2">
                  <span className="inline-block px-3 py-1 rounded-full bg-secondary text-secondary-foreground">
                    {lead.status}
                  </span>
                </p>
              </div>
              <div>
                <Label>Closed At</Label>
                <p className="text-muted-foreground mt-2">
                  {lead.closedAt ? new Date(lead.closedAt).toLocaleString() : 'N/A'}
                </p>
              </div>
              <div>
                <Label>Is Closed</Label>
                <p className="text-muted-foreground mt-2">{lead.isClosed ? 'Yes' : 'No'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* General Metadata */}
        <Card>
          <CardHeader>
            <CardTitle>General Metadata</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <Label>Created</Label>
                <p className="text-muted-foreground mt-2">
                  {lead.$createdAt ? new Date(lead.$createdAt).toLocaleString() : 'N/A'}
                </p>
              </div>
              <div>
                <Label>Last Updated</Label>
                <p className="text-muted-foreground mt-2">
                  {lead.$updatedAt ? new Date(lead.$updatedAt).toLocaleString() : 'N/A'}
                </p>
              </div>
              <div>
                <Label>Owner ID</Label>
                <p className="text-muted-foreground mt-2 font-mono text-xs">{lead.ownerId}</p>
              </div>
              <div>
                <Label>Assigned To ID</Label>
                <p className="text-muted-foreground mt-2 font-mono text-xs">
                  {lead.assignedToId || 'Unassigned'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Reopen Lead Dialog */}
      {showReopenDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <Card className="w-full sm:max-w-md sm:mx-4 rounded-b-none sm:rounded-b-lg">
            <CardHeader>
              <CardTitle>Reopen Lead</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-muted-foreground">
                Are you sure you want to reopen this lead? It will be moved back to active leads
                and can be edited again.
              </p>
              <p className="mb-4 text-sm text-muted-foreground">
                Note: The closure timestamp will be preserved for audit purposes.
              </p>
              <div className="flex flex-col-reverse sm:flex-row gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowReopenDialog(false)}
                  className="w-full sm:w-auto"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleReopenLead}
                  disabled={isReopening}
                  className="w-full sm:w-auto"
                >
                  {isReopening ? 'Reopening...' : 'Reopen Lead'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
