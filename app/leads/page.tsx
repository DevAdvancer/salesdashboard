'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { listLeads } from '@/lib/services/lead-service';
import { getAgentsByManager, getUserById } from '@/lib/services/user-service';
import { Lead, User, LeadListFilters } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TableSkeleton } from '@/components/ui/skeleton';
import { handleError } from '@/lib/utils/error-handler';
import { ProtectedRoute } from '@/components/protected-route';

function LeadsContent() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [agents, setAgents] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState<LeadListFilters>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [assignedToFilter, setAssignedToFilter] = useState('');
  const [dateFromFilter, setDateFromFilter] = useState('');
  const [dateToFilter, setDateToFilter] = useState('');

  const ITEMS_PER_PAGE = 10;

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
    if (user) {
      loadLeads();
    }
  }, [filters]);

  const loadAgents = async () => {
    if (!user || (user.role !== 'manager' && user.role !== 'team_lead')) return;

    try {
      const fetchedAgents = await getAgentsByManager(user.$id);
      setAgents(fetchedAgents);
    } catch (err: any) {
      console.error('Error loading agents:', err);
    }
  };

  const loadLeads = async () => {
    if (!user) return;

    try {
      setIsLoading(true);
      setError(null);
      const fetchedLeads = await listLeads(filters, user.$id, user.role, user.branchIds);
      setLeads(fetchedLeads);
      setCurrentPage(1);
    } catch (err: any) {
      const errorMessage = handleError(err, {
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
    if (dateFromFilter) newFilters.dateFrom = new Date(dateFromFilter).toISOString();
    if (dateToFilter) newFilters.dateTo = new Date(dateToFilter).toISOString();

    setFilters(newFilters);
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setStatusFilter('');
    setAssignedToFilter('');
    setDateFromFilter('');
    setDateToFilter('');
    setFilters({});
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
        <Button onClick={() => router.push('/leads/new')}>
          Create Lead
        </Button>
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
                <option value="New">New</option>
                <option value="Contacted">Contacted</option>
                <option value="Qualified">Qualified</option>
                <option value="Proposal">Proposal</option>
                <option value="Negotiation">Negotiation</option>
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
                      {(user?.role === 'manager' || user?.role === 'team_lead') && (
                        <th className="p-3 md:p-4 font-semibold hidden md:table-cell">Assigned To</th>
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
                            {leadData.firstName} {leadData.lastName}
                          </td>
                          <td className="p-3 md:p-4 text-muted-foreground hidden sm:table-cell">
                            {leadData.email}
                          </td>
                          <td className="p-3 md:p-4">
                            <span className="inline-block px-2 md:px-3 py-1 text-xs md:text-sm rounded-full bg-primary/10 text-primary">
                              {lead.status}
                            </span>
                          </td>
                          {(user?.role === 'manager' || user?.role === 'team_lead') && (
                            <td className="p-3 md:p-4 text-muted-foreground hidden md:table-cell">
                              {lead.assignedToId ? (
                                <AssignedAgentName agentId={lead.assignedToId} agents={agents} />
                              ) : (
                                'Unassigned'
                              )}
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

function AssignedAgentName({ agentId, agents }: { agentId: string; agents: User[] }) {
  const agent = agents.find((a) => a.$id === agentId);
  return <span>{agent?.name || 'Unknown'}</span>;
}

export default function LeadsPage() {
  return (
    <ProtectedRoute componentKey="leads">
      <LeadsContent />
    </ProtectedRoute>
  );
}
