"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AssessmentFiltersCardProps {
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  filter: string;
  setFilter: (val: string) => void;
}

export function AssessmentFiltersCard({
  searchQuery,
  setSearchQuery,
  filter,
  setFilter,
}: AssessmentFiltersCardProps) {
  return (
    <Card>
      <CardContent className="p-4 border-b">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <Label htmlFor="search" className="sr-only">
              Search
            </Label>
            <Input
              id="search"
              placeholder="Search by name, email, phone or company..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="w-full sm:w-[200px]">
            <Label htmlFor="filter" className="sr-only">
              Filter
            </Label>
            <select
              id="filter"
              className="w-full border rounded px-2"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All Leads</option>
              <option value="assessment_created">Assessment Created</option>
              <option value="assessment_not_created">Assessment Not Created</option>
            </select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
