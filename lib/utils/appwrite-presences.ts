type UpsertPresenceInput = {
  presenceId: string;
  status: string;
  metadata?: Record<string, unknown>;
  expiresAt?: string;
};

function getEndpointBase() {
  const raw = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT ?? "";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function getProjectId() {
  return process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID ?? "";
}

export async function upsertAppwritePresence(input: UpsertPresenceInput) {
  const endpoint = getEndpointBase();
  const projectId = getProjectId();
  if (!endpoint || !projectId) {
    throw new Error("Missing Appwrite configuration");
  }

  const response = await fetch(`${endpoint}/presences`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Appwrite-Project": projectId,
    },
    body: JSON.stringify({
      presenceId: input.presenceId,
      status: input.status,
      metadata: input.metadata,
      expiresAt: input.expiresAt,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Failed to upsert presence (${response.status})`);
  }

  return response.json().catch(() => null) as Promise<unknown>;
}

export async function deleteAppwritePresence(input: { presenceId: string }) {
  const endpoint = getEndpointBase();
  const projectId = getProjectId();
  if (!endpoint || !projectId) {
    throw new Error("Missing Appwrite configuration");
  }

  const response = await fetch(`${endpoint}/presences/${encodeURIComponent(input.presenceId)}`, {
    method: "DELETE",
    credentials: "include",
    headers: {
      "X-Appwrite-Project": projectId,
    },
  });

  if (!response.ok && response.status !== 404) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Failed to delete presence (${response.status})`);
  }

  return null;
}

