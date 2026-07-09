"use client";

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DatePicker } from "@/components/ui/date-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import {
  createHolidayCalendarEntryAction,
  deleteHolidayCalendarEntryAction,
} from "@/app/actions/holiday-calendar";
import type { HolidayCalendarEntry } from "@/lib/types";

interface HolidayCalendarSectionProps {
  currentUserId: string;
  holidays: HolidayCalendarEntry[];
  isLoading: boolean;
  onCalendarChanged: () => Promise<void> | void;
}

export function HolidayCalendarSection({
  currentUserId,
  holidays,
  isLoading,
  onCalendarChanged,
}: HolidayCalendarSectionProps) {
  const { toast } = useToast();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const upcomingHolidays = useMemo(
    () =>
      [...holidays].sort((a, b) =>
        a.date.localeCompare(b.date) || a.name.localeCompare(b.name),
      ),
    [holidays],
  );

  async function handleAddHoliday() {
    if (!date.trim() || !name.trim()) {
      toast({
        title: "Missing holiday details",
        description: "Please select a date and enter a holiday name.",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      await createHolidayCalendarEntryAction({
        currentUserId,
        date,
        name,
      });
      setDate("");
      setName("");
      await onCalendarChanged();
      toast({
        title: "Holiday added",
        description: "KPI calculations will now skip this weekday holiday.",
      });
    } catch (error) {
      toast({
        title: "Failed to add holiday",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteHoliday(holiday: HolidayCalendarEntry) {
    setDeletingId(holiday.$id);
    try {
      await deleteHolidayCalendarEntryAction({
        currentUserId,
        holidayId: holiday.$id,
      });
      await onCalendarChanged();
      toast({
        title: "Holiday removed",
        description: `${holiday.name} was removed from the holiday calendar.`,
      });
    } catch (error) {
      toast({
        title: "Failed to delete holiday",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Holiday Calendar</CardTitle>
        <CardDescription>
          Admin-only holiday dates. Weekday holidays are excluded from Lead KPI
          and LinkedIn KPI calculations.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[12rem_minmax(0,1fr)_auto]">
          <DatePicker value={date} onChange={setDate} />
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Holiday name"
          />
          <Button onClick={handleAddHoliday} disabled={isSaving}>
            {isSaving ? "Saving..." : "Add Holiday"}
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : upcomingHolidays.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--hairline)] p-4 text-sm text-[var(--mute)]">
            No holidays added yet.
          </div>
        ) : (
          <div className="space-y-2">
            {upcomingHolidays.map((holiday) => (
              <div
                key={holiday.$id}
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="font-medium">{holiday.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {holiday.date}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">Holiday</Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void handleDeleteHoliday(holiday)}
                    disabled={deletingId === holiday.$id}
                    aria-label={`Delete ${holiday.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
