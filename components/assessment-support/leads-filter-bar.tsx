"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LeadsFilterBarProps {
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  filter: string;
  onFilterChange: (filter: string) => void;
}

export function LeadsFilterBar({
  searchQuery,
  onSearchQueryChange,
  filter,
  onFilterChange,
}: LeadsFilterBarProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-4">
      <div className="flex-1">
        <Label htmlFor="search" className="sr-only">
          Search
        </Label>
        <Input
          id="search"
          placeholder="Search by name, email, phone or company..."
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
        />
      </div>
      <div className="w-full sm:w-[200px]">
        <Label htmlFor="filter" className="sr-only">
          Filter
        </Label>
        <select
          id="filter"
          className="w-full"
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}>
          <option value="all">All Leads</option>
          <option value="assessment_created">Assessment Created</option>
          <option value="assessment_not_created">Assessment Not Created</option>
        </select>
      </div>
    </div>
  );
}
