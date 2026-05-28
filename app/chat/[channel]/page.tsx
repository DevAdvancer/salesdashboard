"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { ProtectedRoute } from "@/components/protected-route";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/contexts/auth-context";
import type { ChatChannelType, ChatMessage } from "@/lib/types";
import { listChatMessagesAction, sendChatMessageAction } from "@/app/actions/chat";

function normalizeChannel(value: string | string[] | undefined): ChatChannelType {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "announcement" || raw === "general" ? raw : "announcement";
}

function getChannelLabel(channel: ChatChannelType) {
  return channel === "announcement" ? "Announcement" : "General";
}

export default function ChatChannelPage() {
  return (
    <ProtectedRoute componentKey="chat">
      <ChatChannelContent />
    </ProtectedRoute>
  );
}

function ChatChannelContent() {
  const { user } = useAuth();
  const params = useParams<{ channel?: string | string[] }>();

  const channel = useMemo<ChatChannelType>(() => normalizeChannel(params?.channel), [params]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);

  const canPost = useMemo(() => {
    if (!user) return false;
    if (channel === "announcement") return user.role === "admin";
    return true;
  }, [channel, user]);

  const loadMessages = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const result = await listChatMessagesAction({
        currentUserId: user.$id,
        channel,
      });
      setMessages(result);
    } catch (e: unknown) {
      setMessages([]);
      setError(e instanceof Error ? e.message : "Failed to load messages");
    } finally {
      setLoading(false);
    }
  }, [channel, user]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (loading) return;
    const el = scrollAreaRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [loading, messages]);

  const send = async () => {
    if (!user) return;
    const text = body.trim();
    if (!text) return;

    try {
      setSending(true);
      await sendChatMessageAction({
        currentUserId: user.$id,
        channel,
        body: text,
      });
      setBody("");
      await loadMessages();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  if (!user) return null;

  return (
    <div className="container mx-auto space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Chatting</h1>
          <p className="text-muted-foreground">{getChannelLabel(channel)}</p>
        </div>
        <Button type="button" variant="outline" onClick={loadMessages} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{getChannelLabel(channel)}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 h-[70vh]">
          {error && (
            <div className="p-3 border border-red-200 bg-red-50 rounded-md text-sm text-red-700">
              {error}
            </div>
          )}

          <div
            ref={scrollAreaRef}
            className="flex-1 overflow-y-auto rounded-md border border-border bg-background/40 p-3"
          >
            {loading ? (
              <div className="h-full flex items-center justify-center">
                <p className="text-sm text-muted-foreground">Loading…</p>
              </div>
            ) : messages.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <p className="text-sm text-muted-foreground">No messages yet.</p>
              </div>
            ) : (
              <div className="min-h-full flex flex-col justify-end gap-3">
                {messages.map((m) => {
                  const isMine = m.createdById === user.$id;
                  return (
                    <div key={m.$id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-3 border ${
                          isMine
                            ? "bg-primary text-primary-foreground border-primary/30"
                            : "bg-background border-border"
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <p className={`text-sm font-medium ${isMine ? "text-primary-foreground" : ""}`}>
                            {m.createdByName}
                          </p>
                          <p className={`text-xs ${isMine ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                            {new Date(m.createdAt).toLocaleString()}
                          </p>
                        </div>
                        <p className={`mt-1 whitespace-pre-wrap text-sm ${isMine ? "text-primary-foreground/90" : "text-muted-foreground"}`}>
                          {m.body}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-border">
            {canPost ? (
              <div className="space-y-2">
                <Label htmlFor="chat-message">Message</Label>
                <textarea
                  id="chat-message"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="w-full min-h-[90px] px-3 py-2 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  placeholder={channel === "announcement" ? "Write an announcement..." : "Write a message..."}
                  disabled={sending}
                />
                <div className="flex items-center justify-end gap-2">
                  <Button type="button" onClick={send} disabled={sending || !body.trim()}>
                    {sending ? "Sending..." : "Send"}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Only admins can post announcements.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
