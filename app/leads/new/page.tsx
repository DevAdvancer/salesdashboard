'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { createLead } from '@/lib/services/lead-service';
import { validateLeadUniqueness } from '@/lib/services/lead-validator';
import { listBranches } from '@/lib/services/branch-service';
import { getFormConfig } from '@/lib/services/form-config-service';
import { FormField, Branch } from '@/lib/types';
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
  const { user, isAdmin, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
      return;
    }

    if (user) {
      loadFormConfig();
      if (user.role === 'admin') {
        loadBranches();
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

  const loadBranches = async () => {
    try {
      const fetchedBranches = await listBranches();
      setBranches(fetchedBranches.filter(b => b.isActive));
    } catch (err: any) {
      console.error('Error loading branches:', err);
    }
  };

  const handleSubmit = async (data: Record<string, any>) => {
    if (!user) return;

    try {
      setIsSaving(true);
      setDuplicateError(null);

      // Validate lead uniqueness before creating
      const validation = await validateLeadUniqueness(data);
      if (!validation.isValid) {
        const fieldLabel = validation.duplicateField === 'email' ? 'email address' : 'phone number';
        setDuplicateError(
          `A lead with this ${fieldLabel} already exists${validation.existingBranchId ? ' in another branch' : ''}.`
        );
        setIsSaving(false);
        return;
      }

      // Determine branchId: admin can specify, others inherit from their user
      const branchId = isAdmin && selectedBranch
        ? selectedBranch
        : user.branchId || undefined;

      // Extract assignedToId added by DynamicLeadForm and prevent it from being stored in data JSON
      const { assignedToId, ...sanitizedData } = data as { assignedToId?: string } & Record<string, any>;

      // Create lead with auto-set owner and optional assigned agent
      await createLead(user.$id, {
        data: sanitizedData,
        assignedToId: assignedToId || undefined,
        status: sanitizedData.status || 'New',
        branchId,
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
          {/* Duplicate Error */}
          {duplicateError && (
            <div className="mb-6 p-3 text-sm text-red-500 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-md">
              {duplicateError}
            </div>
          )}

          {/* Branch Selector (Admin Only) */}
          {isAdmin && branches.length > 0 && (
            <div className="mb-6 pb-6 border-b">
              <Label htmlFor="branch">Branch</Label>
              <select
                id="branch"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 mt-2"
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
              >
                <option value="">No branch</option>
                {branches.map((branch) => (
                  <option key={branch.$id} value={branch.$id}>
                    {branch.name}
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
