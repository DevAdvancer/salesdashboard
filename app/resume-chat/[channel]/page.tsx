"use client";

import { ProtectedRoute } from "@/components/protected-route";
import { ChatChannelView } from "@/components/chat-channel";

export default function ResumeChatChannelPage() {
  return (
    <ProtectedRoute componentKey="chat">
      <ChatChannelView department="resume" />
    </ProtectedRoute>
  );
}