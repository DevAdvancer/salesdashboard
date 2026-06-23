"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { appIcons } from "@/components/navigation-config";

export interface TopMetrics {
  activeLeads: number;
  closedLeads: number;
  clientRecords?: number;
  createdMocks: number;
  createdInterviewSupport: number;
  createdAssessmentSupport: number;
}

interface TopMetricsRowProps {
  metrics: TopMetrics | null;
  isLoading: boolean;
  visibilityLabel: string;
}

const EMPTY_METRICS: TopMetrics = {
  activeLeads: 0,
  closedLeads: 0,
  createdMocks: 0,
  createdInterviewSupport: 0,
  createdAssessmentSupport: 0,
};

export function TopMetricsRow({
  metrics,
  isLoading,
  visibilityLabel,
}: TopMetricsRowProps) {
  const value = metrics ?? EMPTY_METRICS;

  const cards = [
    {
      id: "tour-active-leads",
      label: "Active Leads",
      icon: appIcons.leads,
      count: value.activeLeads,
      hint: visibilityLabel,
    },
    {
      id: "tour-clients",
      label: "Clients",
      icon: appIcons.clients,
      count: value.clientRecords ?? value.closedLeads,
      hint: "In client records",
    },
    {
      id: "tour-created-mocks",
      label: "Created Mocks",
      icon: appIcons.mock,
      count: value.createdMocks,
      hint: "Mock requests sent",
    },
    {
      id: "tour-interview-support",
      label: "Created Interview Support",
      icon: appIcons.interviewSupport,
      count: value.createdInterviewSupport,
      hint: "Interview emails sent",
    },
    {
      id: "tour-assessment-support",
      label: "Created Assessment Support",
      icon: appIcons.assessmentSupport,
      count: value.createdAssessmentSupport,
      hint: "Assessment emails sent",
    },
  ] as const;

  return (
    <div
      id="tour-global-metrics"
      className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.id} id={card.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {card.label}
              </CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {isLoading ? <Skeleton className="h-8 w-16" /> : card.count}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{card.hint}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
