'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/auth-context';
import { listLeads } from '@/lib/services/lead-service';
import { Lead, LeadData, HistoryFilters } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TableSkeleton } from '@/components/ui/skeleton';
import { ProtectedRoute } from '@/components/protected-route';

function HistoryContent() {
  const router = useRouter();
  const { user, isManager, isAgent } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<HistoryFilters>({});

  useEffect(() => {
    if (!user) {
      router.push('/login');
      return;
    }

    loadClosedLeads();
  }, [user, filters]);

  const loadClosedLeads = async () => {
    if (!user) return;

    try {
      setLoading(true);
      const closedLeads = await listLeads(
        {
          isClosed: true,
          status: filters.status,
          assignedToId: filters.agentId,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
        },
        user.$id,
        user.role
      );
      setLeads(closedLeads);
    } catch (error) {
      console.error('Error loading closed leads:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (key: keyof HistoryFilters, value: string) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value || undefined,
    }));
  };

  const clearFilters = () => {
    setFilters({});
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString();
  };

  const getLeadData = (lead: Lead): LeadData => {
    try {
      return JSON.parse(lead.data);
    } catch {
      return {};
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl md:text-3xl font-bold mb-2">Lead History</h1>
        </div>
        <Card className="p-4 md:p-6">
          <TableSkeleton rows={5} />
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold mb-2">Lead History</h1>
        <p className="text-muted-foreground">View all closed leads</p>
      </div>

      {/* Filters */}
      <Card className="p-4 mb-6">
        <h2 className="text-lg font-semibold mb-4">Filters</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <Label htmlFor="dateFrom">From Date</Label>
            <Input
              id="dateFrom"
              type="date"
              value={filters.dateFrom || ''}
              onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="dateTo">To Date</Label>
            <Input
              id="dateTo"
              type="date"
              value={filters.dateTo || ''}
              onChange={(e) => handleFilterChange('dateTo', e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="status">Status</Label>
            <Input
              id="status"
              type="text"
              placeholder="Filter by status"
              value={filters.status || ''}
              onChange={(e) => handleFilterChange('status', e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={clearFilters}
              variant="outline"
              className="w-full"
            >
              Clear Filters
            </Button>
          </div>
        </div>
      </Card>

      {/* Leads Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[500px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left p-3 md:p-4 font-semibold">Name</th>
                <th className="text-left p-3 md:p-4 font-semibold hidden sm:table-cell">Email</th>
                <th className="text-left p-3 md:p-4 font-semibold">Status</th>
                <th className="text-left p-3 md:p-4 font-semibold hidden sm:table-cell">Closed Date</th>
                <th className="text-left p-3 md:p-4 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {leads.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center p-8 text-muted-foreground">
                    No closed leads found
                  </td>
                </tr>
              ) : (
                leads.map((lead) => {
                  const data = getLeadData(lead);
                  return (
                    <tr
                      key={lead.$id}
                      className="border-b border-border hover:bg-accent/50 cursor-pointer transition-colors"
                      onClick={() => router.push(`/history/${lead.$id}`)}
                    >
                      <td className="p-3 md:p-4">
                        {data.firstName} {data.lastName}
                      </td>
                      <td className="p-3 md:p-4 text-muted-foreground hidden sm:table-cell">{data.email || 'N/A'}</td>
                      <td className="p-3 md:p-4">
                        <span className="px-2 py-1 rounded-full text-xs bg-secondary text-secondary-foreground">
                          {lead.status}
                        </span>
                      </td>
                      <td className="p-3 md:p-4 text-muted-foreground hidden sm:table-cell">{formatDate(lead.closedAt)}</td>
                      <td className="p-3 md:p-4">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/history/${lead.$id}`);
                          }}
                        >
                          View
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Summary */}
      <div className="mt-4 text-muted-foreground text-sm">
        Showing {leads.length} closed lead{leads.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

export default function HistoryPage() {
  return (
    <ProtectedRoute componentKey="history">
      <HistoryContent />
    </ProtectedRoute>
  );
}
