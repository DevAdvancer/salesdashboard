"use client";

import type { Dispatch, SetStateAction } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { DateRangePicker } from "@/components/ui/date-picker";
import type { Branch, User } from "@/lib/types";

type FilterDrafts = {
  q: string;
  status: string;
  assignedTo: string;
  owner: string;
  mine: string;
  branch: string;
  from: string;
  to: string;
  team: string;
};

const LEADERSHIP_ROLES = new Set([
  "admin",
  "developer",
  "monitor",
  "operations",
  "team_lead",
]);

const ADMIN_OPS_NO_DEFAULT = new Set(["admin", "operations"]);

interface LeadFiltersCardProps {
  drafts: FilterDrafts;
  setDrafts: Dispatch<SetStateAction<FilterDrafts>>;
  userRole: string;
  statusOptions: string[];
  agents: User[];
  branches: Branch[];
  teamLeads: User[];
  onClearFilters: () => void;
  onApplyFilters: () => void;
}

export function LeadFiltersCard({
  drafts,
  setDrafts,
  userRole,
  statusOptions,
  agents,
  branches,
  teamLeads,
  onClearFilters,
  onApplyFilters,
}: LeadFiltersCardProps) {
  const {
    q: searchDraft,
    status: statusDraft,
    assignedTo: assignedToDraft,
    owner: ownerDraft,
    mine: mineDraft,
    branch: branchDraft,
    from: dateFromDraft,
    to: dateToDraft,
    team: teamDraft,
  } = drafts;

  return (
    <Card id="tour-leads-filters" className="mb-6">
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
              value={searchDraft}
              onChange={(e) =>
                setDrafts((prev) => ({ ...prev, q: e.target.value }))
              }
            />
          </div>

          <div>
            <Label htmlFor="status">Status</Label>
            <select
              id="status"
              className="flex h-10 w-full rounded-md border border-input bg-background pl-3 pr-8 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={statusDraft}
              onChange={(e) =>
                setDrafts((prev) => ({ ...prev, status: e.target.value }))
              }>
              <option value="">All Statuses</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>

          {LEADERSHIP_ROLES.has(userRole) && (
            <div>
              <Label htmlFor="teamFilter">Team</Label>
              <select
                id="teamFilter"
                className="flex h-10 w-full rounded-md border border-input bg-background pl-3 pr-8 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={teamDraft}
                onChange={(e) =>
                  setDrafts((prev) => ({ ...prev, team: e.target.value }))
                }>
                <option value="">
                  {ADMIN_OPS_NO_DEFAULT.has(userRole) ? "All Teams" : "My Team"}
                </option>
                {teamLeads.map((tl) => (
                  <option key={tl.$id} value={tl.$id}>
                    {tl.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <Label htmlFor="ownerFilter">Owner</Label>
            <select
              id="ownerFilter"
              className="flex h-10 w-full rounded-md border border-input bg-background pl-3 pr-8 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={ownerDraft}
              onChange={(e) =>
                setDrafts((prev) => ({ ...prev, owner: e.target.value }))
              }>
              <option value="">All Owners</option>
              {agents.map((agent) => (
                <option key={agent.$id} value={agent.$id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="assignedTo">Assigned To</Label>
            <select
              id="assignedTo"
              className="flex h-10 w-full rounded-md border border-input bg-background pl-3 pr-8 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={assignedToDraft}
              onChange={(e) =>
                setDrafts((prev) => ({ ...prev, assignedTo: e.target.value }))
              }>
              <option value="">All Agents</option>
              {agents.map((agent) => (
                <option key={agent.$id} value={agent.$id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="branchFilter">Branch</Label>
            <select
              id="branchFilter"
              className="flex h-10 w-full rounded-md border border-input bg-background pl-3 pr-8 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={branchDraft}
              onChange={(e) =>
                setDrafts((prev) => ({ ...prev, branch: e.target.value }))
              }>
              <option value="">All Branches</option>
              {branches.map((branch) => (
                <option key={branch.$id} value={branch.$id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="leadDateRange">Date Range</Label>
            <DateRangePicker
              id="leadDateRange"
              value={{ from: dateFromDraft || undefined, to: dateToDraft || undefined }}
              onChange={(range) => {
                setDrafts((prev) => ({
                  ...prev,
                  from: range.from ?? "",
                  to: range.to ?? "",
                }));
              }}
            />
          </div>

          <div className="flex items-center gap-2 pt-6">
            <Checkbox
              id="myLeadsFilter"
              checked={mineDraft === "true"}
              onCheckedChange={(checked) =>
                setDrafts((prev) => ({ ...prev, mine: checked ? "true" : "" }))
              }
            />
            <Label htmlFor="myLeadsFilter" className="cursor-pointer">
              My Leads Only
            </Label>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4 md:col-span-2 lg:col-span-3">
          <Button variant="outline" onClick={onClearFilters}>
            Clear Filters
          </Button>
          <Button onClick={onApplyFilters}>
            Apply Filters & Search
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export type { FilterDrafts };
