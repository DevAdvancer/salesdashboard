"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardContent } from "@/components/ui/card";

interface LeadsSearchFilterProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  filter: string;
  onFilterChange: (value: string) => void;
}

export function LeadsSearchFilter({
  searchQuery,
  onSearchChange,
  filter,
  onFilterChange,
}: LeadsSearchFilterProps) {
  return (
    <CardContent className="p-4 border-b">
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <Label htmlFor="search" className="sr-only">Search</Label>
          <Input
            id="search"
            placeholder="Search by name, email, phone or company..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-[200px]">
          <Label htmlFor="filter" className="sr-only">Filter</Label>
          <select
            id="filter"
            className="w-full"
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}>
            <option value="all">All Leads</option>
            <option value="interview_created">Interview Created</option>
            <option value="interview_not_created">Interview Not Created</option>
          </select>
        </div>
      </div>
    </CardContent>
  );
}
