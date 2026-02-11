'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/contexts/auth-context';
import { useRouter, useParams } from 'next/navigation';
import { getLead, updateLead, closeLead, assignLead } from '@/lib/services/lead-service';
import { getAgentsByManager } from '@/lib/services/user-service';
import { getFormConfig } from '@/lib/services/form-config-service';
import { Lead, User, FormField, LeadData } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { ProtectedRoute } from '@/components/protected-route';

export default function LeadDetailPage() {
  return (
    <ProtectedRoute componentKey="leads">
      <LeadDetailContent />
    </ProtectedRoute>
  );
}

function LeadDetailContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const { toast } = useToast();
  const leadId = params.id as string;

  const [lead, setLead] = useState<Lead | null>(null);
  const [leadData, setLeadData] = useState<LeadData>({});
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [agents, setAgents] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [closeStatus, setCloseStatus] = useState('Closed');

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
      return;
    }

    if (user && leadId) {
      loadLead();
      loadFormConfig();
      if (user.role === 'manager') {
        loadAgents();
      }
    }
  }, [user, authLoading, leadId, router]);

  const loadLead = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const fetchedLead = await getLead(leadId);
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
      const fields = config.fields;
      setFormFields(fields.sort((a, b) => a.order - b.order));
    } catch (err: any) {
      console.error('Error loading form config:', err);
    }
  };

  const loadAgents = async () => {
    if (!user || user.role !== 'manager') return;

    try {
      const fetchedAgents = await getAgentsByManager(user.$id);
      setAgents(fetchedAgents);
    } catch (err: any) {
      console.error('Error loading agents:', err);
    }
  };

  const handleSave = async () => {
    if (!lead || !user) return;

    try {
      setIsSaving(true);
      await updateLead(leadId, leadData, user.$id, user.name);
      toast({
        title: 'Success',
        description: 'Lead updated successfully',
      });
      setIsEditing(false);
      await loadLead();
    } catch (err: any) {
      console.error('Error saving lead:', err);
      toast({
        title: 'Error',
        description: err.message || 'Failed to save lead',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCloseLead = async () => {
    if (!lead || !user) return;

    try {
      setIsSaving(true);
      await closeLead(leadId, closeStatus, user.$id, user.name);
      toast({
        title: 'Success',
        description: 'Lead closed successfully',
      });
      setShowCloseDialog(false);
      router.push('/leads');
    } catch (err: any) {
      console.error('Error closing lead:', err);
      toast({
        title: 'Error',
        description: err.message || 'Failed to close lead',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAssignAgent = async (agentId: string) => {
    if (!lead || !user) return;

    try {
      await assignLead(leadId, agentId, user.$id, user.name);
      toast({
        title: 'Success',
        description: 'Lead assigned successfully',
      });
      await loadLead();
    } catch (err: any) {
      console.error('Error assigning lead:', err);
      toast({
        title: 'Error',
        description: err.message || 'Failed to assign lead',
        variant: 'destructive',
      });
    }
  };

  const handleFieldChange = (key: string, value: any) => {
    setLeadData((prev) => ({ ...prev, [key]: value }));
  };

  const renderField = (field: FormField) => {
    const value = leadData[field.key] || '';
    const isReadOnly = !isEditing || lead?.isClosed;

    switch (field.type) {
      case 'textarea':
        return (
          <textarea
            id={field.key}
            className="w-full min-h-[100px] px-3 py-2 rounded-md border border-input bg-background text-foreground"
            value={value}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            disabled={isReadOnly}
            placeholder={field.placeholder}
          />
        );

      case 'dropdown':
        return (
          <select
            id={field.key}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={value}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            disabled={isReadOnly}
          >
            <option value="">Select {field.label}</option>
            {field.options?.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        );

      default:
        return (
          <Input
            id={field.key}
            type={field.type}
            value={value}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            disabled={isReadOnly}
            placeholder={field.placeholder}
          />
        );
    }
  };

  if (authLoading || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg">Loading lead...</p>
      </div>
    );
  }

  if (error || !lead) {
    return (
      <div className="container mx-auto">
        <Card className="border-red-500">
          <CardHeader>
            <CardTitle className="text-red-500">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p>{error || 'Lead not found'}</p>
            <Button onClick={() => router.push('/leads')} className="mt-4">
              Back to Leads
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
          <Button variant="outline" onClick={() => router.push('/leads')} className="mb-2">
            ← Back to Leads
          </Button>
          <h1 className="text-2xl md:text-3xl font-bold">
            {leadData.firstName} {leadData.lastName}
          </h1>
          <p className="text-muted-foreground mt-1">
            {lead.isClosed ? 'Closed Lead' : 'Active Lead'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!lead.isClosed && (
            <>
              {!isEditing ? (
                <>
                  <Button onClick={() => setIsEditing(true)}>Edit</Button>
                  <Button variant="destructive" onClick={() => setShowCloseDialog(true)}>
                    Close Lead
                  </Button>
                </>
              ) : (
                <>
                  <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? 'Saving...' : 'Save'}
                  </Button>
                  <Button variant="outline" onClick={() => {
                    setIsEditing(false);
                    setLeadData(JSON.parse(lead.data));
                  }}>
                    Cancel
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6">
        {/* Lead Information */}
        <Card>
          <CardHeader>
            <CardTitle>Lead Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {formFields
                .filter((field) => user?.role === 'manager' || field.visible)
                .map((field) => (
                  <div key={field.id}>
                    <Label htmlFor={field.key}>
                      {field.label}
                      {field.required && <span className="text-red-500 ml-1">*</span>}
                    </Label>
                    {renderField(field)}
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>

        {/* Assignment Section (Manager Only) */}
        {user?.role === 'manager' && (
          <Card>
            <CardHeader>
              <CardTitle>Assignment</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="assignedTo">Assigned To</Label>
                  <select
                    id="assignedTo"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    value={lead.assignedToId || ''}
                    onChange={(e) => handleAssignAgent(e.target.value)}
                    disabled={lead.isClosed}
                  >
                    <option value="">Unassigned</option>
                    {agents.map((agent) => (
                      <option key={agent.$id} value={agent.$id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Status</Label>
                  <p className="text-sm text-muted-foreground mt-2">
                    <span className="inline-block px-3 py-1 rounded-full bg-primary/10 text-primary">
                      {lead.status}
                    </span>
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Metadata */}
        <Card>
          <CardHeader>
            <CardTitle>Metadata</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <Label>Created</Label>
                <p className="text-muted-foreground">
                  {lead.$createdAt ? new Date(lead.$createdAt).toLocaleString() : 'N/A'}
                </p>
              </div>
              <div>
                <Label>Last Updated</Label>
                <p className="text-muted-foreground">
                  {lead.$updatedAt ? new Date(lead.$updatedAt).toLocaleString() : 'N/A'}
                </p>
              </div>
              {lead.closedAt && (
                <div>
                  <Label>Closed At</Label>
                  <p className="text-muted-foreground">
                    {new Date(lead.closedAt).toLocaleString()}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Close Lead Dialog */}
      {showCloseDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <Card className="w-full sm:max-w-md sm:mx-4 rounded-b-none sm:rounded-b-lg">
            <CardHeader>
              <CardTitle>Close Lead</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4">Are you sure you want to close this lead?</p>
              <div className="mb-4">
                <Label htmlFor="closeStatus">Final Status</Label>
                <select
                  id="closeStatus"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={closeStatus}
                  onChange={(e) => setCloseStatus(e.target.value)}
                >
                  <option value="Closed">Closed</option>
                  <option value="Won">Won</option>
                  <option value="Lost">Lost</option>
                  <option value="Rejected">Rejected</option>
                </select>
              </div>
              <div className="flex flex-col-reverse sm:flex-row gap-2">
                <Button variant="outline" onClick={() => setShowCloseDialog(false)} className="w-full sm:w-auto">
                  Cancel
                </Button>
                <Button onClick={handleCloseLead} disabled={isSaving} variant="destructive" className="w-full sm:w-auto">
                  {isSaving ? 'Closing...' : 'Close Lead'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
