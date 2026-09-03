"use client";

import { useState, useEffect } from "react";
import { format } from "date-fns";
import { useAuth } from "@/lib/contexts/auth-context";
import { CalendarEvent } from "@/lib/types";
import { listCalendarEventsAction, createCalendarEventAction, deleteCalendarEventAction } from "@/app/actions/calendar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Clock, Trash2, Bell, BellOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DateTimePicker } from "@/components/ui/date-picker";

export function CalendarView() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [title, setTitle] = useState("");
  const [type, setType] = useState("Task");
  const [priority, setPriority] = useState("Medium priority");
  const [dateTime, setDateTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  // Filter state
  const [filterType, setFilterType] = useState("All");
  const [sortOrder, setSortOrder] = useState("Sort by due date");

  useEffect(() => {
    if (!user) return;
    fetchEvents();
  }, [user]);

  const fetchEvents = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await listCalendarEventsAction({
        currentUserId: user.$id,
      });
      setEvents(data);
    } catch (err: any) {
      console.error(err);
      toast({ title: "Error", description: "Failed to load reminders.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleAddReminder = async () => {
    if (!user || !title || !dateTime) {
      toast({ title: "Missing fields", description: "Please fill out what to remember and the date/time.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const newEvent = await createCalendarEventAction({
        currentUserId: user.$id,
        title,
        type,
        priority,
        date: dateTime, // e.g. "2026-09-03T11:15"
        reminderEnabled: notificationsEnabled,
      });
      setEvents((prev) => [...prev, newEvent]);
      setTitle("");
      setDateTime("");
      toast({ title: "Success", description: "Reminder added successfully." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to add reminder.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (eventId: string) => {
    if (!user) return;
    try {
      await deleteCalendarEventAction({ currentUserId: user.$id, eventId });
      setEvents((prev) => prev.filter((e) => e.$id !== eventId));
      toast({ title: "Deleted", description: "Reminder removed." });
    } catch (err: any) {
      toast({ title: "Error", description: "Failed to delete.", variant: "destructive" });
    }
  };

  const filteredEvents = events.filter((e) => {
    if (filterType === "All") return true;
    if (filterType === "Tasks") return e.type === "Task";
    if (filterType === "Meetings") return e.type === "Meeting";
    if (filterType === "Follow-ups") return e.type === "Follow-up";
    if (filterType === "Other") return e.type === "Other";
    return true;
  });

  const sortedEvents = [...filteredEvents].sort((a, b) => {
    // string comparison works for ISO dates like "2026-09-03T11:15"
    if (sortOrder === "Sort by due date") {
      return a.date.localeCompare(b.date);
    }
    return b.date.localeCompare(a.date);
  });

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl tracking-tight">Reminders</h1>
          <p className="text-muted-foreground">All your tasks, meetings, and follow-ups in one place.</p>
        </div>
        <Button 
          variant={notificationsEnabled ? "outline" : "default"} 
          size="sm"
          onClick={() => setNotificationsEnabled(!notificationsEnabled)}
          className={notificationsEnabled ? "text-muted-foreground" : ""}
        >
          {notificationsEnabled ? <><BellOff className="w-4 h-4 mr-2" /> Disable Notifications</> : <><Bell className="w-4 h-4 mr-2" /> Enable Notifications</>}
        </Button>
      </div>

      <Card className="p-4 space-y-4">
        <Input 
          placeholder="What do you need to remember?" 
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="text-lg py-6"
        />
        
        <div className="flex flex-wrap gap-4 items-center">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Task">Task</SelectItem>
              <SelectItem value="Meeting">Meeting</SelectItem>
              <SelectItem value="Follow-up">Follow-up</SelectItem>
              <SelectItem value="Other">Other</SelectItem>
            </SelectContent>
          </Select>

          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Low priority">Low priority</SelectItem>
              <SelectItem value="Medium priority">Medium priority</SelectItem>
              <SelectItem value="High priority">High priority</SelectItem>
            </SelectContent>
          </Select>

          <div className="relative flex items-center min-w-[200px]">
            <DateTimePicker 
              value={dateTime} 
              onChange={setDateTime} 
            />
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button onClick={handleAddReminder} disabled={submitting || !title || !dateTime}>
            Add reminder
          </Button>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          {["All", "Tasks", "Meetings", "Follow-ups", "Other"].map((ft) => (
            <Button
              key={ft}
              variant={filterType === ft ? "default" : "outline"}
              className="rounded-full"
              size="sm"
              onClick={() => setFilterType(ft)}
            >
              {ft}
            </Button>
          ))}
        </div>
        
        <Select value={sortOrder} onValueChange={setSortOrder}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Sort by due date">Sort by due date</SelectItem>
            <SelectItem value="Sort by newest">Sort by newest</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        {loading ? (
          <p className="text-center text-muted-foreground py-8">Loading...</p>
        ) : sortedEvents.length === 0 ? (
          <p className="text-center text-muted-foreground py-12">No reminders here. Add one above.</p>
        ) : (
          sortedEvents.map((event) => {
            // Parse event.date (e.g. "2026-09-03T11:15" or "2026-09-03T11:15:00")
            // to display without local time shift
            let displayDate = event.date;
            try {
              const parts = event.date.split("T");
              if (parts.length === 2) {
                const dateParts = parts[0].split("-");
                const timeParts = parts[1].split(":");
                const d = new Date(Number(dateParts[0]), Number(dateParts[1]) - 1, Number(dateParts[2]));
                const formattedDate = format(d, "MMM d, yyyy");
                const hour = Number(timeParts[0]);
                const min = timeParts[1];
                const ampm = hour >= 12 ? "PM" : "AM";
                const hour12 = hour % 12 || 12;
                displayDate = `${formattedDate} ${hour12}:${min} ${ampm} EST`;
              }
            } catch (e) {
              // fallback
            }

            return (
            <Card key={event.$id} className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Bell className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h4 className="font-semibold text-lg">{event.title || event.candidateName}</h4>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                    <Badge variant="secondary" className="font-normal">{event.type}</Badge>
                    {event.priority && <Badge variant="outline" className="font-normal">{event.priority}</Badge>}
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {displayDate}
                    </span>
                  </div>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => handleDelete(event.$id)} className="hover:bg-red-500/20">
                <Trash2 className="h-4 w-4" style={{ color: '#ef4444', filter: 'none' }} />
              </Button>
            </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
