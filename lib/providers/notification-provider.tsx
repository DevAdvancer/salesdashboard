"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/contexts/auth-context";
import { client } from "@/lib/appwrite";
import { COLLECTIONS, DATABASE_ID } from "@/lib/constants/appwrite";
import { useToast } from "@/components/ui/use-toast";

function playChime() {
  try {
    const AudioContextClass =
      window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    const audioCtx = new AudioContextClass();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    // Simple two-tone chime
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
    oscillator.frequency.exponentialRampToValueAtTime(
      440,
      audioCtx.currentTime + 0.3
    ); // Drop to A4

    gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(
      0.01,
      audioCtx.currentTime + 0.5
    );

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.5);
  } catch (e) {
    console.error("Audio playback failed", e);
  }
}

function showBrowserNotification(title: string, body: string, url?: string) {
  if (!("Notification" in window)) return;
  
  if (Notification.permission === "granted") {
    const notification = new Notification(title, {
      body,
      icon: "/silverspace.png",
    });
    if (url) {
      notification.onclick = () => {
        window.focus();
        window.location.href = url;
      };
    }
  }
}

export function NotificationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const { toast } = useToast();

  // Request browser notification permissions once on mount
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (!user) return;

    const unsubscribe = client.subscribe(
      [
        `databases.${DATABASE_ID}.collections.${COLLECTIONS.NOTIFICATIONS}.documents`,
        `databases.${DATABASE_ID}.collections.${COLLECTIONS.CHAT_MESSAGES}.documents`,
        `databases.${DATABASE_ID}.collections.${COLLECTIONS.RESUME_CHAT_MESSAGES}.documents`,
      ],
      (response) => {
        const eventType = response.events[0];
        // We only care about new documents
        if (!eventType.includes(".create")) return;

        const payload: any = response.payload;
        
        // --- System Notifications ---
        if (response.events.some((e) => e.includes(COLLECTIONS.NOTIFICATIONS))) {
          if (payload.recipientId === user.$id) {
            toast({
              title: payload.title || "New Notification",
              description: payload.body,
            });
            // Trigger a browser notification for standard system notifications
            showBrowserNotification(payload.title || "New Notification", payload.body, "/notifications");
          }
        }
        
        // --- Chat Broadcasts ---
        if (
          response.events.some(
            (e) =>
              e.includes(COLLECTIONS.CHAT_MESSAGES) ||
              e.includes(COLLECTIONS.RESUME_CHAT_MESSAGES)
          )
        ) {
          // Check if it's general or announcement
          if (payload.channel === "general" || payload.channel === "announcements") {
            // Optional: skip if we sent it ourselves
            if (payload.createdById !== user.$id) {
              const title = `New message in #${payload.channel}`;
              const body = `${payload.createdByName}: ${payload.body}`;
              
              toast({
                title,
                description: body,
              });
              
              playChime();
              
              const chatPath = response.events.some((e) => e.includes(COLLECTIONS.RESUME_CHAT_MESSAGES)) 
                ? `/resume-chat/${payload.channel}` 
                : `/chat/${payload.channel}`;
                
              showBrowserNotification(title, body, chatPath);
            }
          }
        }
      }
    );

    return () => {
      unsubscribe();
    };
  }, [user, toast]);

  return <>{children}</>;
}
