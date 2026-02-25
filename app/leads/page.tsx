'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { listLeads } from '@/lib/services/lead-service';
import { getAgentsByManager, getAssignableUsers, getUserById as getUserByIdService } from '@/lib/services/user-service';
import { Lead, User, LeadListFilters } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TableSkeleton } from '@/components/ui/skeleton';
import { handleError } from '@/lib/utils/error-handler';
import { ProtectedRoute } from '@/components/protected-route';

import { Download } from 'lucide-react';

function LeadsContent() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [agents, setAgents] = useState<User[]>([]);
  const [owners, setOwners] = useState<Map<string, User>>(new Map());
  const [assignedUsers, setAssignedUsers] = useState<Map<string, User>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState<LeadListFilters>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [assignedToFilter, setAssignedToFilter] = useState('');
  const [dateFromFilter, setDateFromFilter] = useState('');
  const [dateToFilter, setDateToFilter] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  const ITEMS_PER_PAGE = 10;

  // Check if current user is Shashi Pathak
  const isSpecialUser = user?.email === 'shashi.pathak@silverspaceinc.com';

  const handleExport = () => {
    if (!leads.length) return;
    setIsExporting(true);

    try {
      // 1. Collect all unique keys from all leads' data
      const allKeys = new Set<string>();
      const parsedLeads = leads.map(lead => {
        let data: any = {};
        try {
            data = JSON.parse(lead.data);
        } catch (e) {
            console.error('Failed to parse lead data', e);
        }

        // Add all keys from this lead to the set
        Object.keys(data).forEach(key => allKeys.add(key));

        return {
            ...lead,
            parsedData: data
        };
      });

      // 2. Define standard headers we always want first
      const standardHeaders = ['firstName', 'lastName', 'email', 'phone', 'company', 'status', 'sourceName', 'referralName'];

      // 3. Create final list of headers (standard + any others found)
      // Filter out standard ones from allKeys to avoid duplicates, then spread the rest
      const otherKeys = Array.from(allKeys).filter(key => !standardHeaders.includes(key));

      // Create display headers (Capitalized)
      const displayHeaders = [
          'First Name', 'Last Name', 'Email', 'Phone', 'Company', 'Status', 'Source Name', 'Referral Name', 'Created At',
          ...otherKeys.map(k => k.charAt(0).toUpperCase() + k.slice(1).replace(/([A-Z])/g, ' $1').trim()) // Simple title case
      ];

      // 4. Map data rows
      const rows = parsedLeads.map(lead => {
        const data = lead.parsedData;

        // Smart mapping for Source and Referral
        // Use sourceName if available, otherwise fall back to 'source' field
        const sourceVal = data.sourceName || data.source || '';
        // Use referralName if available, otherwise check common variations
        const referralVal = data.referralName || data.referral || data['Referral Name'] || '';

        // Build row array matching the order of displayHeaders
        const row = [
          data.firstName || '',
          data.lastName || '',
          data.email || '',
          data.phone || '',
          data.company || '',
          lead.status || '',
          sourceVal,    // Mapped Source Value
          referralVal,  // Mapped Referral Value
          lead.$createdAt ? new Date(lead.$createdAt).toLocaleDateString() : '',
          ...otherKeys.map(key => data[key] || '') // Add values for other dynamic keys
        ];

        return row.map(cell => `"${String(cell).replace(/"/g, '""')}"`); // Escape quotes
      });

      // 5. Combine headers and rows
      const csvContent = [
        displayHeaders.join(','),
        ...rows.map(row => row.join(','))
      ].join('\n');

      // Create download link
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `leads_export_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
      return;
    }

    if (user) {
      loadLeads();
      if (user.role === 'manager' || user.role === 'team_lead') {
        loadAgents();
      }
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (leads.length > 0) {
      loadOwnerNames();
      loadAssignedAgentNames();
    }
  }, [leads]);

  const loadAssignedAgentNames = async () => {
    if (!user || leads.length === 0) return;

    try {
      const assignedIds = [...new Set(leads.filter(l => l.assignedToId).map(lead => lead.assignedToId!))];
      const userMap = new Map<string, User>();

      // Check if we already have these users in 'agents' or 'assignedUsers'
      for (const id of assignedIds) {
        // Try finding in existing agents list first
        const existingAgent = agents.find(a => a.$id === id);
        if (existingAgent) {
          userMap.set(id, existingAgent);
          continue;
        }

        // Fetch from server if not found
        try {
          const fetchedUser = await getUserByIdService(id);
          userMap.set(id, fetchedUser);
        } catch (err) {
          console.error(`Error loading assigned user ${id}:`, err);
        }
      }

      setAssignedUsers(prev => new Map([...prev, ...userMap]));
    } catch (err) {
      console.error('Error loading assigned agent names:', err);
    }
  };

  useEffect(() => {
    if (user) {
      // Don't reload if filters haven't changed meaningfully to avoid loops
      // but ensure we do load when filters *do* change.
      loadLeads();
    }
  }, [filters, user]); // Added user to dependencies to ensure load on initial auth

  const loadAgents = async () => {
    if (!user || (user.role !== 'manager' && user.role !== 'team_lead')) return;

    try {
      let fetchedUsers: User[] = [];

      if (user.role === 'manager') {
        // For managers, load assignable users (team leads and agents) based on their branch scope
        fetchedUsers = await getAssignableUsers(user.role, user.branchIds || [], user.$id);
      } else {
        // Team leads can only see agents assigned to them
        fetchedUsers = await getAgentsByManager(user.$id);
      }

      setAgents(fetchedUsers);
    } catch (err) {
      console.error('Error loading agents:', err);
    }
  };

  const loadOwnerNames = async () => {
    if (!user || leads.length === 0) return;

    try {
      const ownerIds = [...new Set(leads.map(lead => lead.ownerId))];
      const ownerMap = new Map<string, User>();

      // Fetch owner details
      for (const ownerId of ownerIds) {
        try {
          const owner = await getUserByIdService(ownerId);
          ownerMap.set(ownerId, owner);
        } catch (err) {
          console.error(`Error loading owner ${ownerId}:`, err);
        }
      }

      setOwners(ownerMap);
    } catch (err) {
      console.error('Error loading owner names:', err);
    }
  };

  const loadLeads = async () => {
    if (!user) return;

    try {
      setIsLoading(true);
      setError(null);
      // Ensure we explicitly pass isClosed=false to the filters, as listLeads defaults to that
      // but let's be explicit. Also, if filters already has isClosed, it will be respected.
      const currentFilters = { ...filters };

      // If we are searching, we might want to search across ALL leads (closed and open)?
      // For now, let's stick to active leads unless user filters for closed.
      if (currentFilters.isClosed === undefined) {
          currentFilters.isClosed = false;
      }

      const fetchedLeads = await listLeads(currentFilters, user.$id, user.role, user.branchIds);
      setLeads(fetchedLeads);
      setCurrentPage(1);
    } catch (err) {
      const errorMessage = handleError(err as Error, {
        title: 'Failed to Load Leads',
        showToast: true,
        retry: loadLeads,
      });
      setError(errorMessage || 'Failed to load leads');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyFilters = () => {
    const newFilters: LeadListFilters = {};

    if (searchQuery) newFilters.searchQuery = searchQuery;
    if (statusFilter) newFilters.status = statusFilter;
    if (assignedToFilter) newFilters.assignedToId = assignedToFilter;
    if (dateFromFilter) {
      // Set to start of day
      const date = new Date(dateFromFilter);
      date.setHours(0, 0, 0, 0);
      newFilters.dateFrom = date.toISOString();
    }
    if (dateToFilter) {
      // Set to end of day
      const date = new Date(dateToFilter);
      date.setHours(23, 59, 59, 999);
      newFilters.dateTo = date.toISOString();
    }

    setFilters(newFilters);
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setStatusFilter('');
    setAssignedToFilter('');
    setDateFromFilter('');
    setDateToFilter('');
    // Explicitly set empty object to reset everything, including hidden isClosed logic
    setFilters({});
    // Force reload immediately
    setTimeout(() => loadLeads(), 0);
  };

  const paginatedLeads = leads.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const totalPages = Math.ceil(leads.length / ITEMS_PER_PAGE);

  if (loading || isLoading) {
    return (
      <div className="container mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl md:text-3xl font-bold">Active Leads</h1>
        </div>
        <Card>
          <CardContent className="p-4 md:p-6">
            <TableSkeleton rows={5} />
          </CardContent>
        </Card>
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
            <Button onClick={loadLeads} className="mt-4">
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <h1 className="text-2xl md:text-3xl font-bold">Active Leads</h1>
        <div className="flex items-center gap-2">
            {isSpecialUser && (
                <Button
                    variant="outline"
                    onClick={handleExport}
                    disabled={isExporting || leads.length === 0}
                    className="flex items-center gap-2"
                >
                    <Download className="h-4 w-4" />
                    {isExporting ? 'Exporting...' : 'Export CSV'}
                </Button>
            )}
            <Button onClick={() => router.push('/leads/new')}>
              Create Lead
            </Button>
        </div>
      </div>

      {/* Filters Section */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="search">Search</Label>
              <Input
                id="search"
                placeholder="Search leads..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        handleApplyFilters();
                    }
                }}
              />
            </div>

            <div>
              <Label htmlFor="status">Status</Label>
              <select
                id="status"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All Statuses</option>
                <option value="Interested">Interested</option>
                <option value="Not-Interested">Not-Interested</option>
                <option value="Pipeline">Pipeline</option>
                <option value="Prospect">Prospect</option>
                <option value="Signed">Signed</option>
              </select>
            </div>

            {(user?.role === 'manager' || user?.role === 'team_lead') && (
              <div>
                <Label htmlFor="assignedTo">Assigned To</Label>
                <select
                  id="assignedTo"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={assignedToFilter}
                  onChange={(e) => setAssignedToFilter(e.target.value)}
                >
                  <option value="">All Agents</option>
                  {agents.map((agent) => (
                    <option key={agent.$id} value={agent.$id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <Label htmlFor="dateFrom">Date From</Label>
              <Input
                id="dateFrom"
                type="date"
                value={dateFromFilter}
                onChange={(e) => setDateFromFilter(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="dateTo">Date To</Label>
              <Input
                id="dateTo"
                type="date"
                value={dateToFilter}
                onChange={(e) => setDateToFilter(e.target.value)}
              />
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <Button onClick={handleApplyFilters}>Apply Filters</Button>
            <Button variant="outline" onClick={handleClearFilters}>
              Clear Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Leads Table */}
      {leads.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-center text-muted-foreground">
              No leads found. {Object.keys(filters).length > 0 ? 'Try adjusting your filters.' : 'Create your first lead to get started.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px]">
                  <thead className="border-b">
                    <tr className="text-left">
                      <th className="p-3 md:p-4 font-semibold">Name</th>
                      <th className="p-3 md:p-4 font-semibold hidden sm:table-cell">Email</th>
                      <th className="p-3 md:p-4 font-semibold">Status</th>
                      {isSpecialUser && (
                        <>
                          <th className="p-3 md:p-4 font-semibold hidden lg:table-cell">Source</th>
                          <th className="p-3 md:p-4 font-semibold hidden lg:table-cell">Referral</th>
                        </>
                      )}
                      {(user?.role === 'manager' || user?.role === 'team_lead') && (
                        <th className="p-3 md:p-4 font-semibold hidden md:table-cell">Assigned To</th>
                      )}
                      {(user?.role === 'manager' || user?.role === 'team_lead') && (
                        <th className="p-3 md:p-4 font-semibold hidden lg:table-cell">Owner</th>
                      )}
                      <th className="p-3 md:p-4 font-semibold hidden sm:table-cell">Created</th>
                      <th className="p-3 md:p-4 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedLeads.map((lead) => {
                      const leadData = JSON.parse(lead.data);
                      return (
                        <tr
                          key={lead.$id}
                          className="border-b hover:bg-accent/50 transition-colors"
                        >
                          <td className="p-3 md:p-4">
                            {leadData.firstName} {leadData.lastName || ''}
                          </td>
                          <td className="p-3 md:p-4 text-muted-foreground hidden sm:table-cell">
                            {leadData.email}
                          </td>
                          <td className="p-3 md:p-4">
                            <span className="inline-block px-2 md:px-3 py-1 text-xs md:text-sm rounded-full bg-primary/10 text-primary">
                              {lead.status}
                            </span>
                          </td>
                          {isSpecialUser && (
                            <>
                              <td className="p-3 md:p-4 text-muted-foreground hidden lg:table-cell">
                                {leadData.sourceName || leadData.source || '-'}
                              </td>
                              <td className="p-3 md:p-4 text-muted-foreground hidden lg:table-cell">
                                {leadData.referralName || leadData.referral || leadData['Referral Name'] || '-'}
                              </td>
                            </>
                          )}
                          {(user?.role === 'manager' || user?.role === 'team_lead') && (
                            <td className="p-3 md:p-4 text-muted-foreground hidden md:table-cell">
                              {lead.assignedToId ? (
                                <AssignedAgentName agentId={lead.assignedToId} assignedUsers={assignedUsers} />
                              ) : (
                                'Unassigned'
                              )}
                            </td>
                          )}
                          {(user?.role === 'manager' || user?.role === 'team_lead') && (
                            <td className="p-3 md:p-4 text-muted-foreground hidden lg:table-cell">
                              <OwnerName ownerId={lead.ownerId} owners={owners} />
                            </td>
                          )}
                          <td className="p-3 md:p-4 text-muted-foreground hidden sm:table-cell">
                            {lead.$createdAt
                              ? new Date(lead.$createdAt).toLocaleDateString()
                              : 'N/A'}
                          </td>
                          <td className="p-3 md:p-4">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => router.push(`/leads/${lead.$id}`)}
                            >
                              View
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row justify-center items-center gap-2 mt-6">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AssignedAgentName({ agentId, assignedUsers }: { agentId: string; assignedUsers: Map<string, User> }) {
  const agent = assignedUsers.get(agentId);
  return <span>{agent?.name || 'Unknown'}</span>;
}

function OwnerName({ ownerId, owners }: { ownerId: string; owners: Map<string, User> }) {
  const owner = owners.get(ownerId);
  return <span>{owner?.name || 'Unknown'}</span>;
}

export default function LeadsPage() {
  return (
    <ProtectedRoute componentKey="leads">
      <LeadsContent />
    </ProtectedRoute>
  );
}
