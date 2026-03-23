const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export function gmailHeaders(accessToken) {
  return { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
}

export async function searchGmail(accessToken, query, maxResults = 50) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const r = await fetch(
    `${GMAIL_BASE}/messages?${new URLSearchParams({ q: query, maxResults })}`,
    { headers }
  );
  const data = await r.json();
  if (!data.messages) return [];

  const emails = [];
  // Fetch details in batches of 10
  for (let i = 0; i < data.messages.length; i += 10) {
    const batch = data.messages.slice(i, i + 10);
    const details = await Promise.all(
      batch.map((msg) =>
        fetch(
          `${GMAIL_BASE}/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
          { headers }
        ).then((r) => r.json())
      )
    );
    for (const d of details) {
      const h = d.payload?.headers || [];
      emails.push({
        id: d.id,
        subject: h.find((x) => x.name === "Subject")?.value || "(no subject)",
        sender: h.find((x) => x.name === "From")?.value || "(unknown)",
      });
    }
  }
  return emails;
}

export async function getFullMessage(accessToken, messageId) {
  const r = await fetch(`${GMAIL_BASE}/messages/${messageId}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return r.json();
}

export async function trashMessage(accessToken, messageId) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  return fetch(`${GMAIL_BASE}/messages/${messageId}/trash`, { method: "POST", headers });
}

export async function markAsRead(accessToken, messageId) {
  const headers = gmailHeaders(accessToken);
  return fetch(`${GMAIL_BASE}/messages/${messageId}/modify`, {
    method: "POST",
    headers,
    body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
  });
}

export async function modifyMessage(accessToken, messageId, body) {
  const headers = gmailHeaders(accessToken);
  return fetch(`${GMAIL_BASE}/messages/${messageId}/modify`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

export async function getOrCreateLabel(accessToken, name) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const r = await fetch(`${GMAIL_BASE}/labels`, { headers });
  const data = await r.json();
  const existing = (data.labels || []).find((l) => l.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  const create = await fetch(`${GMAIL_BASE}/labels`, {
    method: "POST",
    headers: gmailHeaders(accessToken),
    body: JSON.stringify({ name, labelListVisibility: "labelShow", messageListVisibility: "show" }),
  });
  const label = await create.json();
  return label.id;
}

export async function getAccessToken(refreshToken) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.VITE_GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  const data = await r.json();
  return data.access_token || null;
}
