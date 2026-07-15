"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/contexts/auth-context";
import type { CallRequestChatMessage } from "@/lib/types";
import { postCallRequestMessageAction } from "@/app/actions/call-requests";
import { primeNotificationPermission } from "@/lib/utils/notification-sound";

/**
 * Per-request chat panel shared by the Sales (Request Calls) and Resume
 * (Calls) pages. Messages live as a JSON array on the call_request document;
 * each is tagged with the sender's team ("sales" / "resume" / "system") so the
 * same thread renders both sides. This component is read-write when
 * `canPost` is true, read-only otherwise.
 */
export function CallRequestChat({
  requestId,
  messages,
  canPost = true,
  onPosted,
}: {
  requestId: string;
  messages: CallRequestChatMessage[];
  canPost?: boolean;
  onPosted?: (message: CallRequestChatMessage) => void;
}) {
  const { user } = useAuth();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async () => {
    const text = body.trim();
    if (!text) return;
    try {
      setSending(true);
      setError(null);
      // Sending is a user gesture — prime OS notification permission so the
      // other side's replies can pop for this user too.
      primeNotificationPermission();
      const message = await postCallRequestMessageAction({ requestId, body: text });
      setBody("");
      onPosted?.(message);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div className="p-2 border border-red-200 bg-red-50 rounded-md text-xs text-red-700">
          {error}
        </div>
      )}

      <div
        ref={scrollRef}
        className="h-64 overflow-y-auto rounded-md border border-border bg-background/40 p-3"
      >
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-xs text-muted-foreground">No messages yet.</p>
          </div>
        ) : (
          <div className="flex flex-col justify-end gap-2">
            {messages.map((m) => {
              if (m.team === "system") {
                return (
                  <div key={m.id} className="flex justify-center">
                    <p className="text-[11px] text-muted-foreground italic px-2 py-1">
                      {m.body}
                    </p>
                  </div>
                );
              }
              const isMine = user ? m.senderId === user.$id : false;
              const teamLabel = m.team === "resume" ? "Resume" : "Sales";
              return (
                <div
                  key={m.id}
                  className={`flex ${isMine ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3 py-2 border ${
                      isMine
                        ? "bg-primary text-primary-foreground border-primary/30"
                        : "bg-background border-border"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-xs font-medium">
                        {m.senderName}
                        <span
                          className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] ${
                            m.team === "resume"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-emerald-100 text-emerald-700"
                          }`}
                        >
                          {teamLabel}
                        </span>
                      </p>
                      <p
                        className={`text-[10px] ${
                          isMine ? "text-primary-foreground/80" : "text-muted-foreground"
                        }`}
                      >
                        {new Date(m.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{m.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {canPost && (
        <div className="space-y-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full min-h-[70px] px-3 py-2 rounded-md border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Write a message..."
            disabled={sending}
          />
          <div className="flex justify-end">
            <Button type="button" onClick={send} disabled={sending || !body.trim()}>
              {sending ? "Sending..." : "Send"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
