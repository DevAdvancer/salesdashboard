"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { Lead } from "@/lib/types";

interface LeadMetadataCardProps {
  lead: Lead;
  metaNames: Record<string, string>;
}

export function LeadMetadataCard({ lead, metaNames }: LeadMetadataCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Metadata</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <Label>Created</Label>
            <p className="text-muted-foreground">
              {lead.$createdAt
                ? new Date(lead.$createdAt).toLocaleString()
                : "N/A"}
            </p>
          </div>
          <div>
            <Label>Last Updated</Label>
            <p className="text-muted-foreground">
              {lead.$updatedAt
                ? new Date(lead.$updatedAt).toLocaleString()
                : "N/A"}
            </p>
          </div>
          <div>
            <Label>Owner</Label>
            <p className="text-muted-foreground">
              {metaNames[lead.ownerId] || "Unknown"}
            </p>
          </div>
          <div>
            <Label>Assigned To</Label>
            <p className="text-muted-foreground">
              {lead.assignedToId ? (metaNames[lead.assignedToId] || "Unknown") : "Unassigned"}
            </p>
          </div>
          {lead.closedAt && (
            <div>
              <Label>Closed At</Label>
              <p className="text-muted-foreground">
                {new Date(lead.closedAt).toLocaleString()}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
