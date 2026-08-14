"use client";

import { useState, useEffect } from "react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday, addMonths, subMonths } from "date-fns";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";
import { CalendarEvent } from "@/lib/types";
import { listCalendarEventsAction, deleteCalendarEventAction } from "@/app/actions/calendar";
import { EventFormModal } from "./event-form-modal";

export function CalendarView() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [eventToDelete, setEventToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!user) return;

    const fetchEvents = async () => {
      setLoading(true);
      try {
        const from = format(startOfMonth(currentDate), "yyyy-MM-dd");
        const to = format(endOfMonth(currentDate), "yyyy-MM-dd");
        
        const data = await listCalendarEventsAction({
          currentUserId: user.$id,
          from,
          to,
        });
        setEvents(data);
      } catch (err: any) {
        console.error(err);
        toast({
          title: "Error",
          description: "Failed to load calendar events.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, [user, currentDate, toast]);

  const days = eachDayOfInterval({
    start: startOfMonth(currentDate),
    end: endOfMonth(currentDate),
  });

  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));

  const handleAddEvent = (dateStr: string) => {
    setSelectedDate(dateStr);
    setIsModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!user || !eventToDelete) return;
    setIsDeleting(true);
    try {
      await deleteCalendarEventAction({
        currentUserId: user.$id,
        eventId: eventToDelete,
      });
      setEvents((prev) => prev.filter((ev) => ev.$id !== eventToDelete));
      toast({
        title: "Success",
        description: "Event deleted.",
      });
    } catch (err: any) {
      console.error(err);
      toast({
        title: "Error",
        description: "Failed to delete event.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setEventToDelete(null);
    }
  };

  const onEventCreated = (newEvent: CalendarEvent) => {
    setEvents((prev) => [...prev, newEvent]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">
          {format(currentDate, "MMMM yyyy")}
        </h2>
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="icon" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-4">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div key={day} className="text-center font-semibold text-sm text-muted-foreground p-2">
            {day}
          </div>
        ))}
        
        {/* Empty slots for start of month padding */}
        {Array.from({ length: startOfMonth(currentDate).getDay() }).map((_, i) => (
          <div key={`empty-${i}`} className="p-2 border border-transparent" />
        ))}

        {days.map((day) => {
          const dateStr = format(day, "yyyy-MM-dd");
          const dayEvents = events.filter((e) => e.date === dateStr);

          return (
            <Card
              key={dateStr}
              onDoubleClick={() => handleAddEvent(dateStr)}
              className={`min-h-[120px] p-3 flex flex-col relative group transition-colors hover:border-primary/50 cursor-pointer select-none ${
                isToday(day) ? "border-primary/50 bg-primary/5" : ""
              }`}
              title="Double click to add event"
            >
              <div className="flex justify-between items-start mb-2 px-1">
                <span className={`text-sm font-medium ${isToday(day) ? "text-primary font-bold" : ""}`}>
                  {format(day, "d")}
                </span>
              </div>

              <div className="flex-1 flex items-center justify-center">
                {dayEvents.length > 0 && (
                  <div className="text-xs font-semibold text-primary/80 bg-primary/10 px-2 py-1 rounded-full text-center group-hover:bg-primary/20 transition-colors">
                    {dayEvents.length} {dayEvents.length === 1 ? "task" : "tasks"}
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <EventFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        selectedDate={selectedDate}
        dayEvents={events.filter((e) => e.date === selectedDate)}
        onEventCreated={onEventCreated}
        onDeleteEvent={(eventId) => setEventToDelete(eventId)}
      />

      <Dialog open={!!eventToDelete} onOpenChange={(open) => !open && !isDeleting && setEventToDelete(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Event</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this event? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEventToDelete(null)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete Event"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
