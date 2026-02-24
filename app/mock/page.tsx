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
  // subject is computed dynamically based on candidate name
  resume: File | null;
  role: string;
  mode: string;
  schedule: string; // ISO string from datetime-local input
  emailBody: string; // "part 1"
  // Signature fields
  yourName: string;
  yourRole: string;
  yourPhone: string;
  company: 'Silverspace Inc.' | 'Other Company' | 'Vizva Consultancy';
}

const INITIAL_FORM_DATA: MockFormData = {
  to: '',
  cc: '',
  resume: null,
  role: '',
  mode: 'Evaluation',
  schedule: '',
  emailBody: 'Hi Team,\n\nThe candidate is available for the whole day.',
  yourName: '',
  yourRole: '',
  yourPhone: '',
  company: 'Silverspace Inc.',
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

    // Load signature preferences
    const storedSignature = localStorage.getItem('mockSignature');
    if (storedSignature) {
      const parsed = JSON.parse(storedSignature);
      setFormData(prev => ({
        ...prev,
        yourName: parsed.yourName || '',
        yourRole: parsed.yourRole || '',
        yourPhone: parsed.yourPhone || '',
        company: parsed.company || 'Silverspace Inc.',
      }));
    }
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

    setFormData(prev => ({
      ...INITIAL_FORM_DATA,
      // Preserve signature preferences
      yourName: prev.yourName,
      yourRole: prev.yourRole,
      yourPhone: prev.yourPhone,
      company: prev.company,
    }));
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

      // Save signature preferences
      localStorage.setItem('mockSignature', JSON.stringify({
        yourName: formData.yourName,
        yourRole: formData.yourRole,
        yourPhone: formData.yourPhone,
        company: formData.company,
      }));

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

      // Format Schedule
      let formattedSchedule = '';
      if (formData.schedule) {
        const date = new Date(formData.schedule);
        // Format: Feb 20, 2026 at 3:00 PM
        const datePart = new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }).format(date);

        const timePart = new Intl.DateTimeFormat('en-US', {
          hour: 'numeric',
          minute: 'numeric',
          hour12: true,
        }).format(date);

        formattedSchedule = `${datePart} at ${timePart}`;
      }

      // Determine logo URL based on company
      let logoUrl = 'https://egvjgtfjstxgszpzvvbx.supabase.co/storage/v1/object/public/images//20250610_1111_3D%20Gradient%20Logo_remix_01jxd69dc9ex29jbj9r701yjkf%20(2).png';
      if (formData.company === 'Vizva Consultancy') {
        logoUrl = 'https://egvjgtfjstxgszpzvvbx.supabase.co/storage/v1/object/public/images//20250611_1634_3D%20Logo%20Design_remix_01jxgb3x1qebfa2hsxw7sdagw1%20(1).png';
      }

      // Construct email body
      const emailBody = `
        <html>
          <body style="font-family: Arial, sans-serif; color: #333;">
            <p>${formData.emailBody.replace(/\n/g, '<br/>')}</p>

            <table cellpadding="5" cellspacing="0" border="0" style="width: 100%; max-width: 600px; margin-top: 20px; border-collapse: collapse;">
              <tr><td style="font-weight: bold; width: 150px; padding: 5px;">Candidate Name</td><td style="padding: 5px;">${leadData.firstName} ${leadData.lastName}</td></tr>
              <tr><td style="font-weight: bold; padding: 5px;">End Client</td><td style="padding: 5px;">${leadData.company || 'Silverspace Inc'}</td></tr>
              <tr><td style="font-weight: bold; padding: 5px;">Role</td><td style="padding: 5px;">${formData.role}</td></tr>
              <tr><td style="font-weight: bold; padding: 5px;">Mode</td><td style="padding: 5px;">${formData.mode}</td></tr>
              <tr><td style="font-weight: bold; padding: 5px;">Schedule</td><td style="padding: 5px;">${formattedSchedule}</td></tr>
              <tr><td style="font-weight: bold; padding: 5px;">Email ID</td><td style="padding: 5px;">${leadData.email || ''}</td></tr>
              <tr><td style="font-weight: bold; padding: 5px;">Contact Number</td><td style="padding: 5px;">${leadData.phone || ''}</td></tr>
            </table>

            <br/>
            <p>Regards,</p>

            <table cellpadding="0" cellspacing="0" border="0" style="font-family: Arial, sans-serif; font-size: 14px; color: rgb(255, 255, 255); background-color: #1a1a1a; padding: 10px; border-radius: 5px;"><tbody><tr><td style="padding-right: 20px;"><div style="filter: drop-shadow(rgba(255, 255, 255, 0.8) 0px 0px 4px) drop-shadow(rgba(255, 255, 255, 0.4) 0px 0px 20px); padding: 4px;"><img src="${logoUrl}" alt="${formData.company} logo" width="130" style="display: block; max-width: 100%; height: auto;"></div></td><td style="border-left: 2px solid rgb(248, 98, 149); padding-left: 20px;"><strong style="font-size: 18px; color: rgb(255, 255, 255); display: block; margin-bottom: 4px;">${formData.yourName}</strong><span style="display: block; margin-bottom: 2px; color: rgb(255, 255, 255);">${formData.yourRole}</span><span style="color: rgb(204, 204, 204); display: block; margin-bottom: 12px;">${formData.company}</span><a href="mailto:${formData.yourName.toLowerCase().replace(/\s+/g, '.')}@silverspaceinc.com" style="color: rgb(255, 255, 255); text-decoration: none; display: block; margin-bottom: 4px;">📧 ${formData.yourName.toLowerCase().replace(/\s+/g, '.')}@silverspaceinc.com</a><a href="tel:${formData.yourPhone}" style="color: rgb(255, 255, 255); text-decoration: none; display: block; margin-bottom: 4px;">📞 ${formData.yourPhone}</a><a href="https://www.silverspaceinc.com" target="_blank" style="color: rgb(255, 255, 255); text-decoration: none; display: block;">🔗 www.silverspaceinc.com</a></td></tr></tbody></table>
          </body>
        </html>
      `;

      // Construct payload for our API
      const payload = {
        message: {
          subject: `Request to schedule mock interview - ${leadData.firstName} ${leadData.lastName}`,
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
      // We don't reset form data here to preserve signature, or we do reset but signature is re-read from state?
      // Actually handleCreateMock resets it properly.
      // But let's reset to initial state for next time, but keep signature?
      // For now, simple reset is fine, next open will re-read or use handleCreateMock logic.
      // Wait, handleCreateMock uses INITIAL_FORM_DATA and merges current state.
      // So if I reset here, I lose current state signature.
      // I should update INITIAL_FORM_DATA to have empty signature, but `handleCreateMock` preserves it.
      // So I can just reset to INITIAL_FORM_DATA here.
      // However, if I close and reopen without refreshing, `prev` in handleCreateMock will be INITIAL_FORM_DATA (empty).
      // So I need to ensure signature is persisted in state or localStorage is read again.
      // `handleCreateMock` reads `prev` state. If I reset state to INITIAL here, `prev` will be empty.
      // So I should reload from localStorage or just not reset the signature fields.

      const storedSignature = localStorage.getItem('mockSignature');
      const parsedSignature = storedSignature ? JSON.parse(storedSignature) : {};

      setFormData({
          ...INITIAL_FORM_DATA,
          yourName: parsedSignature.yourName || '',
          yourRole: parsedSignature.yourRole || '',
          yourPhone: parsedSignature.yourPhone || '',
          company: parsedSignature.company || 'Silverspace Inc.',
      });

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
                <Label>Subject</Label>
                <div className="p-2 border rounded-md bg-muted text-muted-foreground">
                  Request to schedule mock interview - {selectedLead ? JSON.parse(selectedLead.data).firstName + ' ' + JSON.parse(selectedLead.data).lastName : ''}
                </div>
              </div>

              <div className="col-span-2">
                <Label htmlFor="emailBody">Email Content</Label>
                <Textarea
                  id="emailBody"
                  value={formData.emailBody}
                  onChange={(e) => setFormData({ ...formData, emailBody: e.target.value })}
                  rows={4}
                />
              </div>

              <div className="col-span-2 md:col-span-1">
                <Label htmlFor="role">Role</Label>
                <Input
                  id="role"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  placeholder="e.g. Data Analyst"
                />
              </div>

              <div className="col-span-2 md:col-span-1">
                <Label htmlFor="mode">Mode</Label>
                <Input
                  id="mode"
                  value={formData.mode}
                  onChange={(e) => setFormData({ ...formData, mode: e.target.value })}
                  placeholder="Evaluation"
                />
              </div>

              <div className="col-span-2 md:col-span-1">
                <Label htmlFor="schedule">Schedule</Label>
                <Input
                  id="schedule"
                  type="datetime-local"
                  value={formData.schedule}
                  onChange={(e) => setFormData({ ...formData, schedule: e.target.value })}
                />
              </div>

              <div className="col-span-2 md:col-span-1">
                <Label htmlFor="company">Company (Signature)</Label>
                <select
                    id="company"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    value={formData.company}
                    onChange={(e) => setFormData({ ...formData, company: e.target.value as any })}
                >
                    <option value="Silverspace Inc.">Silverspace Inc.</option>
                    <option value="Vizva Consultancy">Vizva Consultancy</option>
                    <option value="Other Company">Other Company</option>
                </select>
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

              <div className="col-span-2 border-t pt-4 mt-2">
                <h3 className="font-semibold mb-2">Signature Details</h3>
                <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2 md:col-span-1">
                        <Label htmlFor="yourName">Your Name</Label>
                        <Input
                        id="yourName"
                        value={formData.yourName}
                        onChange={(e) => setFormData({ ...formData, yourName: e.target.value })}
                        placeholder="John Doe"
                        />
                    </div>
                    <div className="col-span-2 md:col-span-1">
                        <Label htmlFor="yourRole">Your Role</Label>
                        <Input
                        id="yourRole"
                        value={formData.yourRole}
                        onChange={(e) => setFormData({ ...formData, yourRole: e.target.value })}
                        placeholder="HR Manager"
                        />
                    </div>
                    <div className="col-span-2 md:col-span-1">
                        <Label htmlFor="yourPhone">Your Phone</Label>
                        <Input
                        id="yourPhone"
                        value={formData.yourPhone}
                        onChange={(e) => setFormData({ ...formData, yourPhone: e.target.value })}
                        placeholder="+1 (555) 123-4567"
                        />
                    </div>
                </div>
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
  return (
    <ProtectedRoute componentKey="mock">
      <MockContent />
    </ProtectedRoute>
  );
}
