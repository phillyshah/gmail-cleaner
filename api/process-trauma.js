import { ImapFlow } from "imapflow";
import * as XLSX from "xlsx";

export const config = { maxDuration: 60 };

function imapClient() {
  return new ImapFlow({
    host: process.env.HOSTINGER_IMAP_HOST || "imap.hostinger.com",
    port: 993,
    secure: true,
    auth: { user: process.env.HOSTINGER_EMAIL, pass: process.env.HOSTINGER_PASSWORD },
    logger: false,
    tls: { rejectUnauthorized: false },
  });
}

function findExcelPart(struct) {
  if (!struct) return null;
  const mime = `${struct.type || ""}/${struct.subtype || ""}`.toLowerCase();
  const name = (struct.parameters?.name || struct.disposition?.parameters?.filename || "").toLowerCase();
  if (
    struct.part &&
    (mime.includes("sheet") || mime.includes("excel") ||
      (mime === "application/octet-stream" && name.match(/\.xlsx?$/)))
  ) {
    return struct.part;
  }
  if (struct.childNodes) {
    for (const child of struct.childNodes) {
      const found = findExcelPart(child);
      if (found) return found;
    }
  }
  return null;
}

async function fetchEmailAttachment(uid) {
  const client = imapClient();
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    let buffer = null;
    let emailDate = null;

    try {
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
      // Mark as read
      await client.messageFlagsAdd([String(uid)], ["\\Seen"], { uid: true });
    } finally {
      lock.release();
    }
    await client.logout();
    return { buffer, emailDate };
  } catch (err) {
    throw new Error(`IMAP: ${err.message}`);
  }
}

async function extractTraumaTotal(buffer, emailDate) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const month = new Date(emailDate).toLocaleString("en-US", { month: "long", year: "numeric" });

  // Combine all sheets into text for Claude
  const sheetsText = workbook.SheetNames.map((name) => {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
    return `=== Sheet: ${name} ===\n${csv}`;
  }).join("\n\n").substring(0, 10000);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      messages: [{
        role: "user",
        content: `In this trauma sales dashboard spreadsheet, find the "Revenue by Product Type" table and extract the Grand Total for ${month}.

${sheetsText}

Respond ONLY with valid JSON, no markdown:
{"amount": 123456.78, "formatted": "$123,456", "month": "${month}", "found": true}
If not found: {"amount": 0, "formatted": "unknown", "month": "${month}", "found": false}`,
      }],
    }),
  });

  const data = await res.json();
  const text = data.content?.[0]?.text || "{}";
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    return JSON.parse(text.substring(start, end + 1));
  } catch {
    return { amount: 0, formatted: "unknown", found: false, month };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { emails } = req.body;
  if (!emails?.length) return res.status(400).json({ error: "Missing emails" });

  const results = [];

  for (const email of emails) {
    try {
      const { buffer, emailDate } = await fetchEmailAttachment(email.id);

      if (!buffer) {
        results.push({ id: email.id, action: "error", error: "No Excel attachment found" });
        continue;
      }

      const extracted = await extractTraumaTotal(buffer, emailDate || new Date());
      const dateStr = new Date(emailDate || new Date()).toLocaleDateString("en-US", {
        month: "long", day: "numeric", year: "numeric",
      });

      if (extracted.found) {
        const msg = `📊 MH Trauma sales as of ${dateStr} are ${extracted.formatted}`;
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: msg,
          }),
        });
        results.push({ id: email.id, action: "notified", amount: extracted.formatted, date: dateStr });
      } else {
        results.push({ id: email.id, action: "error", error: `Could not find Revenue by Product Type for ${extracted.month}` });
      }
    } catch (err) {
      results.push({ id: email.id, action: "error", error: err.message });
    }
  }

  res.json({ results });
}
