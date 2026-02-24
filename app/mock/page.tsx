'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/contexts/auth-context';
import { listLeads } from '@/lib/services/lead-service';
import type { Lead } from '@/lib/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { TableSkeleton } from '@/components/ui/skeleton';
import { handleError } from '@/lib/utils/error-handler';
import { useToast } from '@/components/ui/use-toast';
import { ProtectedRoute } from '@/components/protected-route';
// import { useMsal } from "@azure/msal-react";
// import { loginRequest } from "@/lib/msal-config";

interface MockFormData {
  to: string;
  cc: string;
  subject: string;
  resume: File | null;
  isAvailable: boolean;
  signature: string;
}

const INITIAL_FORM_DATA: MockFormData = {
  to: '',
  cc: '',
  subject: 'Mock Interview Request',
  resume: null,
  isAvailable: false,
  signature: '',
};

function MockContent() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [filteredLeads, setFilteredLeads] = useState<Lead[]>([]);
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState<MockFormData>(INITIAL_FORM_DATA);
  const [isSending, setIsSending] = useState(false);
  // const { instance, accounts } = useMsal();
  const [isOutlookConnected, setIsOutlookConnected] = useState(false);

  const handleConnectOutlook = async () => {
    window.location.href = '/api/auth/login';
  };

  // Check for existing connection status
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const response = await fetch('/api/auth/status');
        const data = await response.json();
        setIsOutlookConnected(data.connected);
      } catch (error) {
        console.error("Failed to check connection status", error);
      }
    };

    checkConnection();
  }, []);

  const loadLeads = useCallback(async () => {
    if (!user) return;

    try {
      setIsLoading(true);
      // Reuse listLeads with existing role-based logic
      const fetchedLeads = await listLeads({}, user.$id, user.role, user.branchIds);
      setLeads(fetchedLeads);
      setFilteredLeads(fetchedLeads);
    } catch (err) {
      handleError(err as Error, {
        title: 'Failed to Load Leads',
        showToast: true,
      });
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadLeads();
    }
  }, [user, loadLeads]);

  useEffect(() => {
    let result = leads;

    if (filter === 'mock_created') {
      // Assuming we'll track mock creation status later.
      // For now, this is a placeholder or relies on a field we might need to add to LeadData
      // Or we can check if there's a specific tag or note.
      // Since we don't have a direct field, I'll leave it as all for now or implement if a field exists.
      // Ideally, we should add a 'mockCreated' flag to lead data.
      result = result.filter(lead => {
         const data = JSON.parse(lead.data);
         return data.mockCreated === true;
      });
    } else if (filter === 'mock_not_created') {
      result = result.filter(lead => {
         const data = JSON.parse(lead.data);
         return !data.mockCreated;
      });
    }

    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      result = result.filter(lead => {
        const data = JSON.parse(lead.data);
        return (
          data.firstName?.toLowerCase().includes(lowerQuery) ||
          data.lastName?.toLowerCase().includes(lowerQuery) ||
          data.email?.toLowerCase().includes(lowerQuery) ||
          data.phone?.includes(lowerQuery) ||
          data.company?.toLowerCase().includes(lowerQuery)
        );
      });
    }

    setFilteredLeads(result);
  }, [leads, filter, searchQuery]);

  // Reset file input key to force re-render and clear file
  const [fileInputKey, setFileInputKey] = useState(Date.now());

  const handleCreateMock = (lead: Lead) => {
    setSelectedLead(lead);
    const leadData = JSON.parse(lead.data);

    // Pre-fill To field with candidate email if available
    setFormData({
      ...INITIAL_FORM_DATA,
      to: leadData.email || '',
      subject: `Mock Interview Request - ${leadData.firstName} ${leadData.lastName}`,
    });
    setFileInputKey(Date.now()); // Reset file input

    setIsModalOpen(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size > 4 * 1024 * 1024) { // 4MB limit
        toast({
          title: 'File too large',
          description: 'Resume must be less than 4MB.',
          variant: 'destructive',
        });
        e.target.value = ''; // Reset input
        return;
      }
      setFormData({ ...formData, resume: file });
    }
  };

  const sendEmail = async () => {
    if (!isOutlookConnected) {
      toast({
        title: 'Authentication Required',
        description: 'Please connect to Outlook first.',
        variant: 'destructive',
      });
      return;
    }

    if (!selectedLead) return;

    try {
      setIsSending(true);
      const leadData = JSON.parse(selectedLead.data);

      // Convert file to base64
      let attachment = null;
      if (formData.resume) {
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const result = reader.result as string;
            // Remove data URL prefix (e.g., "data:application/pdf;base64,")
            const base64 = result.split(',')[1];
            resolve(base64);
          };
          reader.onerror = reject;
        });
        reader.readAsDataURL(formData.resume);
        const base64Content = await base64Promise;

        attachment = {
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: formData.resume.name,
          contentType: formData.resume.type,
          contentBytes: base64Content,
        };
      }

      // Construct email body
      const emailBody = `
        <html>
          <body>
            <p>Dear ${leadData.firstName} ${leadData.lastName},</p>
            <p>We are pleased to invite you for a mock interview.</p>

            <h3>Candidate Details:</h3>
            <ul>
              <li><strong>Name:</strong> ${leadData.firstName} ${leadData.lastName}</li>
              <li><strong>Phone:</strong> ${leadData.phone || 'N/A'}</li>
              <li><strong>Email:</strong> ${leadData.email || 'N/A'}</li>
              <li><strong>Company:</strong> ${leadData.company || 'N/A'}</li>
              <li><strong>Available Today:</strong> ${formData.isAvailable ? 'Yes' : 'No'}</li>
            </ul>

            ${formData.signature ? `<br/><div class="signature">${formData.signature}</div>` : ''}
          </body>
        </html>
      `;

      // Construct payload for our API
      const payload = {
        message: {
          subject: formData.subject,
          body: {
            contentType: 'HTML',
            content: emailBody,
          },
          toRecipients: formData.to.split(',').map(email => ({
            emailAddress: { address: email.trim() }
          })).filter(r => r.emailAddress.address),
          ccRecipients: formData.cc.split(',').map(email => ({
            emailAddress: { address: email.trim() }
          })).filter(r => r.emailAddress.address),
          attachments: attachment ? [attachment] : [],
        },
        saveToSentItems: 'true',
      };

      // Send via our server-side API
      const response = await fetch('/api/mock/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to send email');
      }

      toast({
        title: 'Success',
        description: 'Mock interview email sent successfully!',
      });
      setIsModalOpen(false);
      setFormData(INITIAL_FORM_DATA);
    } catch (error: unknown) {
      console.error('Error sending email:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to send email';

      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });

      // If token expired or invalid (server will return 401)
      if (errorMessage.includes('Not connected')) {
        setIsOutlookConnected(false);
      }
    } finally {
      setIsSending(false);
    }
  };

  if (loading || isLoading) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">Mock Interview Setup</h1>
        <Card>
          <CardContent className="p-6">
            <TableSkeleton rows={5} />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Mock Interview Setup</h1>
        {!isOutlookConnected ? (
          <Button onClick={handleConnectOutlook} disabled={isAuthLoading}>
            {isAuthLoading ? 'Connecting...' : 'Connect Outlook'}
          </Button>
        ) : (
          <Button variant="outline" disabled className="text-green-600 border-green-600">
            Outlook Connected
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-4 border-b">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <Label htmlFor="search" className="sr-only">Search</Label>
              <Input
                id="search"
                placeholder="Search by name, email, phone or company..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="w-full sm:w-[200px]">
              <Label htmlFor="filter" className="sr-only">Filter</Label>
              <select
                id="filter"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">All Leads</option>
                <option value="mock_created">Mock Created</option>
                <option value="mock_not_created">Mock Not Created</option>
              </select>
            </div>
          </div>
        </CardContent>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead className="border-b bg-muted/50">
                <tr className="text-left">
                  <th className="p-4 font-semibold">Name</th>
                  <th className="p-4 font-semibold">Phone</th>
                  <th className="p-4 font-semibold">Email</th>
                  <th className="p-4 font-semibold">Company</th>
                  <th className="p-4 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map((lead) => {
                  const leadData = JSON.parse(lead.data);
                  return (
                    <tr key={lead.$id} className="border-b hover:bg-muted/50 transition-colors">
                      <td className="p-4">
                        {leadData.firstName} {leadData.lastName}
                        {leadData.legalName && <div className="text-xs text-muted-foreground">({leadData.legalName})</div>}
                      </td>
                      <td className="p-4">{leadData.phone || 'N/A'}</td>
                      <td className="p-4">{leadData.email || 'N/A'}</td>
                      <td className="p-4">{leadData.company || 'N/A'}</td>
                      <td className="p-4">
                        <Button
                          size="sm"
                          onClick={() => handleCreateMock(lead)}
                          disabled={!isOutlookConnected}
                        >
                          Create Mock
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {filteredLeads.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-muted-foreground">
                      No leads found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Mock Interview</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label htmlFor="to">To (Comma separated)</Label>
                <Input
                  id="to"
                  value={formData.to}
                  onChange={(e) => setFormData({ ...formData, to: e.target.value })}
                  placeholder="interviewer@example.com, hr@example.com"
                />
              </div>

              <div className="col-span-2">
                <Label htmlFor="cc">CC (Comma separated)</Label>
                <Input
                  id="cc"
                  value={formData.cc}
                  onChange={(e) => setFormData({ ...formData, cc: e.target.value })}
                  placeholder="manager@example.com"
                />
              </div>

              <div className="col-span-2">
                <Label htmlFor="subject">Subject</Label>
                <Input
                  id="subject"
                  value={formData.subject}
                  onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                />
              </div>

              <div className="col-span-2">
                <Label htmlFor="resume">Upload Resume</Label>
                <Input
                  id="resume"
                  key={fileInputKey}
                  type="file"
                  onChange={handleFileChange}
                  accept=".pdf,.doc,.docx"
                />
              </div>

              <div className="flex items-center space-x-2 col-span-2">
                <Checkbox
                  id="available"
                  checked={formData.isAvailable}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, isAvailable: checked as boolean })
                  }
                />
                <Label htmlFor="available">Candidate is available today</Label>
              </div>

              <div className="col-span-2">
                <Label htmlFor="signature">Signature</Label>
                <Textarea
                  id="signature"
                  value={formData.signature}
                  onChange={(e) => setFormData({ ...formData, signature: e.target.value })}
                  placeholder="Best regards,&#10;[Your Name]"
                  rows={4}
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>
              Go Back
            </Button>
            <Button onClick={sendEmail} disabled={isSending}>
              {isSending ? 'Sending...' : 'Create Mock'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function MockPage() {
  // Using 'leads' permission as a proxy for access to mock feature
  // Adjust componentKey if a new one is needed
  return (
    <ProtectedRoute componentKey="leads">
      <MockContent />
    </ProtectedRoute>
  );
}
