"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { Lead, User } from "@/lib/types";
import { Search, ChevronDown, Check } from "lucide-react";

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
  const [searchQuery, setSearchQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setSearchQuery("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  const formatRole = (role: string) =>
    role
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");

  // Build the sorted list: currently assigned user on top, then rest sorted by name
  const sortedAgents = useMemo(() => {
    const currentAssignedId = lead.assignedToId;
    const assigned: User[] = [];
    const rest: User[] = [];

    for (const agent of assignableAgents) {
      if (agent.$id === currentAssignedId) {
        assigned.push(agent);
      } else {
        rest.push(agent);
      }
    }

    rest.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return [...assigned, ...rest];
  }, [assignableAgents, lead.assignedToId]);

  // Filter by search query
  const filteredAgents = useMemo(() => {
    if (!searchQuery.trim()) return sortedAgents;
    const q = searchQuery.toLowerCase();
    return sortedAgents.filter(
      (agent) =>
        (agent.name || "").toLowerCase().includes(q) ||
        (agent.email || "").toLowerCase().includes(q) ||
        formatRole(agent.role).toLowerCase().includes(q),
    );
  }, [sortedAgents, searchQuery]);

  const selectedAgent = useMemo(
    () => assignableAgents.find((a) => a.$id === lead.assignedToId),
    [assignableAgents, lead.assignedToId],
  );

  const handleSelect = (agentId: string) => {
    if (agentId !== lead.assignedToId) {
      onAssign(agentId);
    }
    setIsOpen(false);
    setSearchQuery("");
  };

  const disabled = lead.isClosed || isAssigning;

  return (
    <Card id="tour-lead-assignment">
      <CardHeader>
        <CardTitle>Assignment</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div ref={containerRef} className="relative">
            <Label htmlFor="assignedTo">
              {isLeadGeneration ? "Assigned Team Lead" : "Assigned To"}
            </Label>

            {/* Trigger button */}
            <button
              id="assignedTo"
              type="button"
              onClick={() => {
                if (!disabled) setIsOpen(!isOpen);
              }}
              disabled={disabled}
              className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background pl-3 pr-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className={`truncate ${selectedAgent ? "" : "text-muted-foreground"}`}>
                {selectedAgent
                  ? `${selectedAgent.name} (${formatRole(selectedAgent.role)})`
                  : "Select a user..."}
              </span>
              <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
            </button>

            {/* Dropdown panel */}
            {isOpen && (
              <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg">
                {/* Search input */}
                <div className="flex items-center border-b border-border px-3 py-2">
                  <Search className="mr-2 h-4 w-4 opacity-50 shrink-0" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search by name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  />
                </div>

                {/* Options list */}
                <div className="max-h-60 overflow-y-auto p-1">
                  {filteredAgents.length === 0 ? (
                    <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                      No users found
                    </div>
                  ) : (
                    filteredAgents.map((agent) => {
                      const isSelected = agent.$id === lead.assignedToId;
                      return (
                        <button
                          key={agent.$id}
                          type="button"
                          onClick={() => handleSelect(agent.$id)}
                          className={`flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm text-left transition-colors hover:bg-accent hover:text-accent-foreground ${
                            isSelected
                              ? "bg-accent/50 font-medium"
                              : ""
                          }`}
                        >
                          <Check
                            className={`h-4 w-4 shrink-0 ${
                              isSelected ? "opacity-100" : "opacity-0"
                            }`}
                          />
                          <span className="truncate">
                            {agent.name}{" "}
                            <span className="text-muted-foreground">
                              ({formatRole(agent.role)})
                            </span>
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
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
