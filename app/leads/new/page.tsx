'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { createLead } from '@/lib/services/lead-service';
import { getAgentsByManager } from '@/lib/services/user-service';
import { getFormConfig } from '@/lib/services/form-config-service';
import { FormField, User } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DynamicLeadForm } from '@/components/dynamic-lead-form';
import { useToast } from '@/components/ui/use-toast';
import { ProtectedRoute } from '@/components/protected-route';

export default function NewLeadPage() {
  return (
    <ProtectedRoute componentKey="leads">
      <NewLeadContent />
    </ProtectedRoute>
  );
}

function NewLeadContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [agents, setAgents] = useState<User[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
      return;
    }

    if (user) {
      loadFormConfig();
      if (user.role === 'manager') {
        loadAgents();
      }
    }
  }, [user, authLoading, router]);

  const loadFormConfig = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const config = await getFormConfig();
      const fields = config.fields;
      setFormFields(fields.sort((a, b) => a.order - b.order));
    } catch (err: any) {
      console.error('Error loading form config:', err);
      setError(err.message || 'Failed to load form configuration');
    } finally {
      setIsLoading(false);
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

  const handleSubmit = async (data: Record<string, any>) => {
    if (!user) return;

    try {
      setIsSaving(true);

      // Create lead with owner and optional assigned agent
      await createLead({
        data,
        ownerId: user.$id,
        assignedToId: selectedAgent || undefined,
        status: data.status || 'New',
      });

      toast({
        title: 'Success',
        description: 'Lead created successfully',
      });

      router.push('/leads');
    } catch (err: any) {
      console.error('Error creating lead:', err);
      toast({
        title: 'Error',
        description: err.message || 'Failed to create lead',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (authLoading || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg">Loading form...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto">
        <Card className="border-red-500">
          <CardHeader>
            <CardTitle className="text-red-500">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p>{error}</p>
            <Button onClick={loadFormConfig} className="mt-4">
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl">
      <div className="mb-6">
        <Button variant="outline" onClick={() => router.push('/leads')} className="mb-2">
          ← Back to Leads
        </Button>
        <h1 className="text-2xl md:text-3xl font-bold">Create New Lead</h1>
        <p className="text-muted-foreground">Fill in the lead information below</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lead Information</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Assignment Selector (Manager Only) */}
          {user?.role === 'manager' && agents.length > 0 && (
            <div className="mb-6 pb-6 border-b">
              <Label htmlFor="assignedTo">Assign To Agent (Optional)</Label>
              <select
                id="assignedTo"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 mt-2"
                value={selectedAgent}
                onChange={(e) => setSelectedAgent(e.target.value)}
              >
                <option value="">Unassigned</option>
                {agents.map((agent) => (
                  <option key={agent.$id} value={agent.$id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Dynamic Lead Form */}
          <DynamicLeadForm
            formConfig={formFields}
            onSubmit={handleSubmit}
            submitLabel="Create Lead"
            isLoading={isSaving}
          />
        </CardContent>
      </Card>
    </div>
  );
}
