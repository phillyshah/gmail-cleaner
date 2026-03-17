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

function extractTraumaTotal(buffer, emailDate) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const ws = workbook.Sheets["Trauma Dashboard"] || workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  const currentMonth = new Date(emailDate).getMonth() + 1; // 1–12

  // Find the Revenue by Product Type section, its column header row, and its Grand Total row
  let sectionStart = -1;
  let colHeaderRow = -1;
  let grandTotalRow = -1;

  for (let i = 0; i < data.length; i++) {
    const cell = String(data[i][0] || "").trim();

    if (cell.toLowerCase().includes("revenue by product type")) {
      sectionStart = i;
    }

    if (sectionStart !== -1) {
      // Column header row contains "Product Type" and "Grand Total"
      if (cell.toLowerCase() === "product type" && data[i].some((c) => String(c) === "Grand Total")) {
        colHeaderRow = i;
      }
      // Grand Total data row (after column headers are found)
      if (colHeaderRow !== -1 && cell === "Grand Total") {
        grandTotalRow = i;
        break;
      }
      // Stop if we've hit the next section
      if (i > sectionStart + 2 && /revenue by (surgeon|manager|distributor)/i.test(cell)) {
        break;
      }
    }
  }

  if (colHeaderRow === -1 || grandTotalRow === -1) {
    return { found: false, error: "Could not locate Revenue by Product Type Grand Total row" };
  }

  // Find which column matches the current month number
  const headers = data[colHeaderRow];
  const monthColIdx = headers.findIndex((c, idx) => idx > 0 && Number(c) === currentMonth);

  if (monthColIdx === -1) {
    return { found: false, error: `Month ${currentMonth} column not found (headers: ${headers.slice(0, 6).join(", ")})` };
  }

  const amount = Number(data[grandTotalRow][monthColIdx]) || 0;
  const formatted = "$" + amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const month = new Date(emailDate).toLocaleString("en-US", { month: "long", year: "numeric" });

  return { found: true, amount, formatted, month };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
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
  } catch (topErr) {
    // Always return JSON so the client never gets an HTML error page
    res.status(500).json({ results: [], error: topErr.message });
  }
}
