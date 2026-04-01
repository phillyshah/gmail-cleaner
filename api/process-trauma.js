import { withImap } from "./_lib/imap.js";
import { getFullMessage, markAsRead, trashMessage } from "./_lib/gmail.js";
import { sendTelegramDocument } from "./_lib/telegram.js";

export const config = { maxDuration: 60 };

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

function findExcelPart(struct) {
  if (!struct) return null;
  const mime = `${struct.type || ""}/${struct.subtype || ""}`.toLowerCase();
  const name = (struct.parameters?.name || struct.disposition?.parameters?.filename || "").toLowerCase();
  if (struct.part && (mime.includes("sheet") || mime.includes("excel") || (mime === "application/octet-stream" && name.match(/\.xlsx?$/)))) {
    return { part: struct.part, filename: struct.parameters?.name || struct.disposition?.parameters?.filename || "trauma-dashboard.xlsx" };
  }
  if (struct.childNodes) {
    for (const child of struct.childNodes) {
      const found = findExcelPart(child);
      if (found) return found;
    }
  }
  return null;
}

function findGmailAttachment(parts) {
  if (!parts) return null;
  for (const part of parts) {
    const mime = (part.mimeType || "").toLowerCase();
    const name = (part.filename || "").toLowerCase();
    if (part.body && (mime.includes("sheet") || mime.includes("excel") || (mime === "application/octet-stream" && name.match(/\.xlsx?$/)))) {
      return { attachmentId: part.body.attachmentId, data: part.body.data, filename: part.filename || "trauma-dashboard.xlsx" };
    }
    if (part.parts) {
      const found = findGmailAttachment(part.parts);
      if (found) return found;
    }
  }
  return null;
}

async function fetchImapAttachment(client, uid) {
  let buffer = null, filename = "trauma-dashboard.xlsx", emailDate = null;
  for await (const msg of client.fetch([String(uid)], { envelope: true, bodyStructure: true }, { uid: true })) {
    emailDate = msg.envelope.date;
    const result = findExcelPart(msg.bodyStructure);
    if (result) {
      filename = result.filename;
      const dl = await client.download(String(uid), result.part, { uid: true });
      const chunks = [];
      for await (const chunk of dl.content) chunks.push(chunk);
      buffer = Buffer.concat(chunks);
    }
  }
  await client.messageFlagsAdd([String(uid)], ["\\Seen"], { uid: true });
  return { buffer, filename, emailDate };
}

async function fetchGmailAttachment(accessToken, messageId) {
  const full = await getFullMessage(accessToken, messageId);
  const headers = full.payload?.headers || [];
  const dateHeader = headers.find((h) => h.name === "Date")?.value;
  const emailDate = dateHeader ? new Date(dateHeader) : new Date();
  const subjectHeader = headers.find((h) => h.name === "Subject")?.value || "";

  const attachment = findGmailAttachment(full.payload?.parts || []);
  if (!attachment) return { buffer: null, filename: null, emailDate, subject: subjectHeader };

  let data = attachment.data;
  if (!data && attachment.attachmentId) {
    const r = await fetch(`${GMAIL_BASE}/messages/${messageId}/attachments/${attachment.attachmentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = await r.json();
    data = json.data;
  }

  if (!data) return { buffer: null, filename: null, emailDate, subject: subjectHeader };
  const buffer = Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return { buffer, filename: attachment.filename, emailDate, subject: subjectHeader };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { emails, accessToken } = req.body;
    if (!emails?.length) return res.status(400).json({ error: "Missing emails" });

    const results = [];

    for (const email of emails) {
      try {
        let buffer, filename, emailDate;

        if (email.source === "imap") {
          ({ buffer, filename, emailDate } = await withImap((client) => fetchImapAttachment(client, email.id)));
        } else {
          if (!accessToken) {
            results.push({ id: email.id, action: "error", error: "No access token for Gmail trauma email" });
            continue;
          }
          ({ buffer, filename, emailDate } = await fetchGmailAttachment(accessToken, email.id));
        }

        if (!buffer) {
          results.push({ id: email.id, action: "error", error: "No Excel attachment found" });
          continue;
        }

        // Forward the Excel file directly to Telegram
        const dateStr = new Date(emailDate || new Date()).toLocaleDateString("en-US", {
          month: "long", day: "numeric", year: "numeric",
        });
        await sendTelegramDocument(buffer, filename, `Trauma Dashboard — ${dateStr}`);

        // Mark as read and trash
        if (email.source !== "imap" && accessToken) {
          await Promise.all([markAsRead(accessToken, email.id), trashMessage(accessToken, email.id)]);
        }

        results.push({ id: email.id, action: "notified", date: dateStr });
      } catch (err) {
        results.push({ id: email.id, action: "error", error: err.message });
      }
    }

    res.json({ results });
  } catch (topErr) {
    res.status(500).json({ results: [], error: topErr.message });
  }
}
