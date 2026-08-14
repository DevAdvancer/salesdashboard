"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { createCalendarEventAction } from "@/app/actions/calendar";
import { useAuth } from "@/lib/contexts/auth-context";
import { CalendarEvent } from "@/lib/types";
import { X, CalendarPlus } from "lucide-react";
import { format } from "date-fns";

interface EventFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: string; // YYYY-MM-DD format
  dayEvents: CalendarEvent[];
  onEventCreated: (event: CalendarEvent) => void;
  onDeleteEvent: (eventId: string) => void;
}

export function EventFormModal({
  isOpen,
  onClose,
  selectedDate,
  dayEvents,
  onEventCreated,
  onDeleteEvent,
}: EventFormModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [notes, setNotes] = useState("");
  const [reminderEnabled, setReminderEnabled] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    if (!type.trim() || !candidateName.trim()) {
      toast({
        title: "Validation Error",
        description: "Type and Candidate Name are required.",
        variant: "destructive",
      });
      return;
    }

    try {
      setLoading(true);
      const newEvent = await createCalendarEventAction({
        currentUserId: user.$id,
        date: selectedDate, // Store the raw date string
        type,
        candidateName,
        notes,
        reminderEnabled,
      });

      toast({
        title: "Success",
        description: "Calendar event created.",
      });
      onEventCreated(newEvent);
      
      // Reset form
      setType("");
      setCandidateName("");
      setNotes("");
      setReminderEnabled(false);
      setShowForm(false);
    } catch (err: any) {
      console.error(err);
      toast({
        title: "Error",
        description: err.message || "Failed to create event.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleModalClose = () => {
    setShowForm(false);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleModalClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {showForm ? `Add Task for ${selectedDate}` : `Tasks on ${selectedDate}`}
          </DialogTitle>
        </DialogHeader>

        {!showForm ? (
          <div className="space-y-4 mt-2">
            {dayEvents.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-4">
                No tasks scheduled for this date.
              </p>
            ) : (
              <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 scrollbar-thin">
                {dayEvents.map((event) => (
                  <div key={event.$id} className="p-3 bg-secondary/50 rounded-lg border border-border/50 relative group">
                    <button
                      onClick={() => onDeleteEvent(event.$id)}
                      className="absolute right-2 top-2 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Delete task"
                    >
                      <X className="h-4 w-4" />
                    </button>
                    <div className="font-semibold text-sm">{event.type}</div>
                    <div className="text-sm text-foreground/80 mt-0.5">{event.candidateName}</div>
                    {event.notes && (
                      <div className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
                        {event.notes}
                      </div>
                    )}
                    {event.reminderEnabled && (
                      <div className="text-[11px] text-primary mt-2 font-medium">
                        🔔 Reminder set for 9:00 AM EST
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="pt-2 flex justify-end">
              <Button onClick={() => setShowForm(true)} className="w-full sm:w-auto">
                <CalendarPlus className="mr-2 h-4 w-4" />
                Add New Task
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label htmlFor="type">Task Type</Label>
            <Input
              id="type"
              placeholder="e.g. Follow up, Interview, Screening"
              value={type}
              onChange={(e) => setType(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="candidateName">Candidate Name</Label>
            <Input
              id="candidateName"
              placeholder="Candidate Name"
              value={candidateName}
              onChange={(e) => setCandidateName(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Optional notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={loading}
            />
          </div>

          <label className="flex items-center space-x-2 pt-2 cursor-pointer">
            <Switch
              checked={reminderEnabled}
              onCheckedChange={setReminderEnabled}
              disabled={loading}
            />
            <span>Enable 9:00 AM EST Reminder Notification</span>
          </label>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowForm(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save Event"}
            </Button>
          </div>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
