"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { Lead, User } from "@/lib/types";

interface LeadAssignmentCardProps {
  lead: Lead;
  user: User;
  assignableAgents: User[];
  isAssigning: boolean;
  onAssign: (agentId: string) => void;
}

export function LeadAssignmentCard({
  lead,
  user,
  assignableAgents,
  isAssigning,
  onAssign,
}: LeadAssignmentCardProps) {
  const isLeadGeneration = user.role === "lead_generation";

  return (
    <Card id="tour-lead-assignment">
      <CardHeader>
        <CardTitle>Assignment</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="assignedTo">
              {isLeadGeneration ? "Assigned Team Lead" : "Assigned To"}
            </Label>
            <select
              id="assignedTo"
              className="flex h-10 w-full rounded-md border border-input bg-background pl-3 pr-8 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={lead.assignedToId || ""}
              onChange={(e) => onAssign(e.target.value)}
              disabled={lead.isClosed || isAssigning}>
              {assignableAgents.map((agent) => (
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
  );
}
