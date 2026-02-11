'use client';

import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { getAssignableUsers } from '@/lib/services/user-service';
import type { User, UserRole } from '@/lib/types';

interface LeadAssignmentDropdownProps {
  creatorRole: UserRole;
  creatorBranchIds: string[];
  creatorId?: string;
  value: string | null;
  onChange: (userId: string | null) => void;
}

/**
 * LeadAssignmentDropdown Component
 *
 * Renders a role-aware "Assigned To" dropdown for lead creation/editing.
 * - Manager: shows Team Leads and Agents whose branchIds overlap
 * - Team Lead: shows only Agents whose branchIds overlap
 * - Agent: hidden (agents auto-own their leads)
 *
 * Requirements: 4.2, 4.3, 4.4
 */
export function LeadAssignmentDropdown({
  creatorRole,
  creatorBranchIds,
  creatorId,
  value,
  onChange,
}: LeadAssignmentDropdownProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Agents don't see the dropdown (Requirement 4.4)
    if (creatorRole === 'agent') return;
    if (!creatorBranchIds.length) return;

    let cancelled = false;

    async function fetchUsers() {
      setLoading(true);
      setError(null);
      try {
        const assignable = await getAssignableUsers(creatorRole, creatorBranchIds, creatorId);
        if (!cancelled) {
          setUsers(assignable);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Failed to load assignable users');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchUsers();

    return () => {
      cancelled = true;
    };
  }, [creatorRole, creatorBranchIds, creatorId]);

  // Hidden for agents (Requirement 4.4)
  if (creatorRole === 'agent') {
    return null;
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="assignedToId">Assigned To</Label>
      <select
        id="assignedToId"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={loading}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="">Select a user</option>
        {users.map((user) => (
          <option key={user.$id} value={user.$id}>
            {user.name} ({user.role === 'team_lead' ? 'Team Lead' : 'Agent'})
          </option>
        ))}
      </select>
      {loading && (
        <p className="text-sm text-muted-foreground">Loading users...</p>
      )}
      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}
    </div>
  );
}
