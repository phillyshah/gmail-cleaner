import * as XLSX from "xlsx";
import { withImap } from "./_lib/imap.js";
import { getFullMessage, markAsRead, trashMessage } from "./_lib/gmail.js";
import { sendTelegram } from "./_lib/telegram.js";

export const config = { maxDuration: 60 };

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

function findExcelPart(struct) {
  if (!struct) return null;
  const mime = `${struct.type || ""}/${struct.subtype || ""}`.toLowerCase();
  const name = (struct.parameters?.name || struct.disposition?.parameters?.filename || "").toLowerCase();
  if (struct.part && (mime.includes("sheet") || mime.includes("excel") || (mime === "application/octet-stream" && name.match(/\.xlsx?$/)))) return struct.part;
  if (struct.childNodes) {
    for (const child of struct.childNodes) {
      const found = findExcelPart(child);
      if (found) return found;
    }
  }
  return null;
}

async function fetchImapAttachment(client, uid) {
  let buffer = null, emailDate = null;
  for await (const msg of client.fetch([String(uid)], { envelope: true, bodyStructure: true }, { uid: true })) {
    emailDate = msg.envelope.date;
    const part = findExcelPart(msg.bodyStructure);
    if (part) {
      const dl = await client.download(String(uid), part, { uid: true });
      const chunks = [];
      for await (const chunk of dl.content) chunks.push(chunk);
      buffer = Buffer.concat(chunks);
    }
  }
  await client.messageFlagsAdd([String(uid)], ["\\Seen"], { uid: true });
  return { buffer, emailDate };
}

function findGmailAttachment(parts) {
  if (!parts) return null;
  for (const part of parts) {
    const mime = (part.mimeType || "").toLowerCase();
    const name = (part.filename || "").toLowerCase();
    if (part.body && (mime.includes("sheet") || mime.includes("excel") || (mime === "application/octet-stream" && name.match(/\.xlsx?$/)))) {
      return { attachmentId: part.body.attachmentId, data: part.body.data };
    }
    if (part.parts) {
      const found = findGmailAttachment(part.parts);
      if (found) return found;
    }
  }
  return null;
}

async function fetchGmailAttachment(accessToken, messageId) {
  const full = await getFullMessage(accessToken, messageId);
  const headers = full.payload?.headers || [];
  const dateHeader = headers.find((h) => h.name === "Date")?.value;
  const emailDate = dateHeader ? new Date(dateHeader) : new Date();

  const attachment = findGmailAttachment(full.payload?.parts || []);
  if (!attachment) return { buffer: null, emailDate };

  let data = attachment.data;
  if (!data && attachment.attachmentId) {
    const r = await fetch(`${GMAIL_BASE}/messages/${messageId}/attachments/${attachment.attachmentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = await r.json();
    data = json.data;
  }

  if (!data) return { buffer: null, emailDate };
  const buffer = Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return { buffer, emailDate };
}

function extractTraumaTotal(buffer, emailDate) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const ws = workbook.Sheets["Trauma Dashboard"] || workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const currentMonth = new Date(emailDate).getMonth() + 1;

  let sectionStart = -1, colHeaderRow = -1, grandTotalRow = -1;
  for (let i = 0; i < data.length; i++) {
    const cell = String(data[i][0] || "").trim();
    if (cell.toLowerCase().includes("revenue by product type")) sectionStart = i;
    if (sectionStart !== -1) {
      if (cell.toLowerCase() === "product type" && data[i].some((c) => String(c) === "Grand Total")) colHeaderRow = i;
      if (colHeaderRow !== -1 && cell === "Grand Total") { grandTotalRow = i; break; }
      if (i > sectionStart + 2 && /revenue by (surgeon|manager|distributor)/i.test(cell)) break;
    }
  }

  if (colHeaderRow === -1 || grandTotalRow === -1)
    return { found: false, error: "Could not locate Revenue by Product Type Grand Total row" };

  const headers = data[colHeaderRow];
  const monthColIdx = headers.findIndex((c, idx) => idx > 0 && Number(c) === currentMonth);
  if (monthColIdx === -1)
    return { found: false, error: `Month ${currentMonth} column not found` };

  const amount = Number(data[grandTotalRow][monthColIdx]) || 0;
  const formatted = "$" + amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return { found: true, formatted };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { emails, accessToken } = req.body;
    if (!emails?.length) return res.status(400).json({ error: "Missing emails" });

    const results = [];

    for (const email of emails) {
      try {
        let buffer, emailDate;

        if (email.source === "imap") {
          ({ buffer, emailDate } = await withImap((client) => fetchImapAttachment(client, email.id)));
        } else {
          if (!accessToken) {
            results.push({ id: email.id, action: "error", error: "No access token for Gmail trauma email" });
            continue;
          }
          ({ buffer, emailDate } = await fetchGmailAttachment(accessToken, email.id));
        }

        if (!buffer) {
          results.push({ id: email.id, action: "error", error: "No Excel attachment found" });
          continue;
        }

        const extracted = extractTraumaTotal(buffer, emailDate || new Date());
        const dateStr = new Date(emailDate || new Date()).toLocaleDateString("en-US", {
          month: "long", day: "numeric", year: "numeric",
        });

        if (extracted.found) {
          await sendTelegram(`📊 MH Trauma sales as of ${dateStr} are ${extracted.formatted}`, { parseMode: null });
          // Mark as read and trash for Gmail emails
          if (email.source !== "imap" && accessToken) {
            await Promise.all([markAsRead(accessToken, email.id), trashMessage(accessToken, email.id)]);
          }
          results.push({ id: email.id, action: "notified", amount: extracted.formatted, date: dateStr });
        } else {
          results.push({ id: email.id, action: "error", error: extracted.error });
        }
      } catch (err) {
        results.push({ id: email.id, action: "error", error: err.message });
      }
    }

    res.json({ results });
  } catch (topErr) {
    res.status(500).json({ results: [], error: topErr.message });
  }
}
