import { Redis } from "@upstash/redis";

export const config = { maxDuration: 60 };

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// -- Investment criteria (must match api/process-listings.js) --
const CRITERIA = {
  "15228": {
    excluded: ["condo", "townhome", "townhouse", "co-op", "apartment", "manufactured"],
    rules: [
      { type: "single family", beds: 2, maxPrice: 170000 },
      { type: "single family", beds: 3, maxPrice: 225000 },
      { type: "duplex", beds: 4, maxPrice: 300000 },
      { type: "duplex", beds: 5, maxPrice: 350000 },
    ],
  },
  "15243": {
    excluded: ["condo", "townhome", "townhouse", "co-op", "apartment", "manufactured"],
    rules: [
      { type: "single family", beds: 2, maxPrice: 170000 },
      { type: "single family", beds: 3, maxPrice: 225000 },
      { type: "duplex", beds: 4, maxPrice: 300000 },
      { type: "duplex", beds: 5, maxPrice: 350000 },
    ],
  },
  "15234": {
    excluded: ["condo", "townhome", "townhouse", "co-op", "apartment", "manufactured"],
    rules: [
      { type: "single family", beds: 2, maxPrice: 140000 },
      { type: "single family", beds: 3, maxPrice: 175000 },
      { type: "duplex", beds: 4, maxPrice: 250000 },
      { type: "duplex", beds: 5, maxPrice: 300000 },
    ],
  },
  "15212": {
    excluded: ["condo", "lot", "land", "vacant"],
    rules: [{ type: "any", maxPrice: 200000 }],
  },
};

// -- Helpers --
async function tg(text) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: false,
    }),
  });
}

async function getAccessToken(refreshToken) {
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

// -- IMAP helpers --
import { ImapFlow } from "imapflow";
import * as XLSX from "xlsx";

function imapClient() {
  return new ImapFlow({
    host: process.env.HOSTINGER_IMAP_HOST || "imap.hostinger.com",
    port: 993, secure: true,
    auth: { user: process.env.HOSTINGER_EMAIL, pass: process.env.HOSTINGER_PASSWORD },
    logger: false, tls: { rejectUnauthorized: false },
  });
}

async function scanImap() {
  const client = imapClient();
  const emails = [];
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(); since.setDate(since.getDate() - 30);
      const uids = await client.search({ since }, { uid: true });
      if (uids.length) {
        for await (const msg of client.fetch(uids.slice(-50).reverse(), { envelope: true, flags: true }, { uid: true })) {
          const from = msg.envelope.from?.[0];
          const sender = from ? `${from.name ? from.name + " " : ""}<${from.address}>` : "Unknown";
          const sub = (msg.envelope.subject || "").toLowerCase();
          const snd = sender.toLowerCase();
          const category = sub.includes("trauma dashboard") ? "trauma"
            : (snd.includes("zillow") && (sub.includes("new listing") || sub.includes("price cut"))) ? "listing"
            : "inbox";
          emails.push({
            id: String(msg.uid), subject: msg.envelope.subject || "(no subject)",
            sender, date: msg.envelope.date ? new Date(msg.envelope.date).toISOString() : null,
            category, source: "imap",
          });
        }
      }
    } finally { lock.release(); }
    await client.logout();
  } catch {}
  return emails;
}

async function trashImapEmails(uids) {
  const client = imapClient();
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
      const mailboxes = await client.list();
      const trash = mailboxes.find((m) => m.specialUse === "\\Trash" || /trash|deleted/i.test(m.name));
      if (trash) await client.messageMove(uids, trash.path, { uid: true });
      else await client.messageFlagsAdd(uids, ["\\Deleted"], { uid: true });
    } finally { lock.release(); }
    await client.logout();
  } catch {}
}

async function processImapListing(email) {
  // Reuse Gmail listing logic but for IMAP — just evaluate subject/sender heuristically
  // For full body analysis, fetch the email
  const client = imapClient();
  let body = email.subject;
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      for await (const msg of client.fetch([email.id], { bodyParts: ["TEXT"] }, { uid: true })) {
        const part = msg.bodyParts?.get("text");
        if (part) body = part.toString();
      }
      await client.messageFlagsAdd([email.id], ["\\Seen"], { uid: true });
    } finally { lock.release(); }
    await client.logout();
  } catch {}
  // Use the same processListing logic from the webhook (already defined below)
  return processListing({ ...email }, null, body);
}

function findExcelPart(struct) {
  if (!struct) return null;
  const mime = `${struct.type || ""}/${struct.subtype || ""}`.toLowerCase();
  const name = (struct.parameters?.name || struct.disposition?.parameters?.filename || "").toLowerCase();
  if (struct.part && (mime.includes("sheet") || mime.includes("excel") || (mime === "application/octet-stream" && name.match(/\.xlsx?$/)))) return struct.part;
  if (struct.childNodes) { for (const c of struct.childNodes) { const f = findExcelPart(c); if (f) return f; } }
  return null;
}

async function processTraumaEmail(email) {
  const client = imapClient();
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    let buffer = null; let emailDate = email.date ? new Date(email.date) : new Date();
    try {
      for await (const msg of client.fetch([email.id], { envelope: true, bodyStructure: true }, { uid: true })) {
        emailDate = msg.envelope.date || emailDate;
        const part = findExcelPart(msg.bodyStructure);
        if (part) {
          const dl = await client.download(email.id, part, { uid: true });
          const chunks = []; for await (const chunk of dl.content) chunks.push(chunk);
          buffer = Buffer.concat(chunks);
        }
      }
      await client.messageFlagsAdd([email.id], ["\\Seen"], { uid: true });
    } finally { lock.release(); }
    await client.logout();

    if (!buffer) { await tg(`⚠️ No Excel attachment found in trauma dashboard email`); return; }

    const workbook = XLSX.read(buffer, { type: "buffer" });
    const ws = workbook.Sheets["Trauma Dashboard"] || workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    const currentMonth = new Date(emailDate).getMonth() + 1;
    let colHeaderRow = -1, grandTotalRow = -1, sectionStart = -1;
    for (let i = 0; i < rows.length; i++) {
      const cell = String(rows[i][0] || "").trim();
      if (cell.toLowerCase().includes("revenue by product type")) sectionStart = i;
      if (sectionStart !== -1) {
        if (cell.toLowerCase() === "product type" && rows[i].some((c) => String(c) === "Grand Total")) colHeaderRow = i;
        if (colHeaderRow !== -1 && cell === "Grand Total") { grandTotalRow = i; break; }
        if (i > sectionStart + 2 && /revenue by (surgeon|manager|distributor)/i.test(cell)) break;
      }
    }
    const dateStr = new Date(emailDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    if (colHeaderRow === -1 || grandTotalRow === -1) {
      await tg(`⚠️ Could not find Revenue by Product Type table in trauma dashboard`);
    } else {
      const headers = rows[colHeaderRow];
      const monthColIdx = headers.findIndex((c, idx) => idx > 0 && Number(c) === currentMonth);
      if (monthColIdx === -1) {
        await tg(`⚠️ Month ${currentMonth} column not found in trauma dashboard`);
      } else {
        const amount = Number(rows[grandTotalRow][monthColIdx]) || 0;
        const formatted = "$" + amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
        await tg(`📊 MH Trauma sales as of ${dateStr} are ${formatted}`);
      }
    }
  } catch (err) {
    await tg(`⚠️ Trauma processing error: ${err.message}`);
  }
}

async function scanGmail(accessToken) {
  const base = "https://gmail.googleapis.com/gmail/v1/users/me";
  const headers = { Authorization: `Bearer ${accessToken}` };

  async function search(q) {
    const r = await fetch(`${base}/messages?${new URLSearchParams({ q, maxResults: 50 })}`, { headers });
    const data = await r.json();
    if (!data.messages) return [];
    const emails = [];
    for (let i = 0; i < data.messages.length; i += 10) {
      const batch = data.messages.slice(i, i + 10);
      const details = await Promise.all(
        batch.map((msg) =>
          fetch(`${base}/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`, { headers }).then((r) => r.json())
        )
      );
      for (const d of details) {
        const h = d.payload?.headers || [];
        emails.push({
          id: d.id,
          subject: h.find((x) => x.name === "Subject")?.value || "",
          sender: h.find((x) => x.name === "From")?.value || "",
        });
      }
    }
    return emails;
  }

  const [promos, social] = await Promise.all([
    search("category:promotions newer_than:30d"),
    search("category:social newer_than:30d"),
  ]);
  return [
    ...promos.map((e) => ({ ...e, category: "promo" })),
    ...social.map((e) => ({ ...e, category: "social" })),
  ];
}

async function trashEmails(accessToken, ids) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  await Promise.all(
    ids.map((id) =>
      fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/trash`, { method: "POST", headers })
    )
  );
}

function extractZillowUrl(html) {
  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
  return hrefs.find((u) => /zillow\.com\/(homes|homedetails|b|mls)/i.test(u)) ||
    hrefs.find((u) => u.includes("zillow.com")) || null;
}

function extractBody(email) {
  function decode(data) {
    return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
  }
  let zillowUrl = null;
  function getPart(part) {
    if (!part) return null;
    if (part.mimeType === "text/plain" && part.body?.data) return decode(part.body.data);
    if (part.mimeType === "text/html" && part.body?.data) {
      const html = decode(part.body.data);
      if (!zillowUrl) zillowUrl = extractZillowUrl(html);
      return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
    if (part.parts) {
      for (const sub of part.parts) { const t = getPart(sub); if (t) return t; }
    }
    return null;
  }
  const text = getPart(email.payload) || email.snippet || "";
  return { text: zillowUrl ? `${text}\nZILLOW_URL: ${zillowUrl}` : text, zillowUrl };
}

function extractZipFromAddress(address) {
  const matches = [...(address || "").matchAll(/\b(\d{5})\b/g)].map((m) => m[1]);
  return matches[matches.length - 1] || null;
}

function evaluateListing(listing) {
  const zip = extractZipFromAddress(listing.address) || (listing.zip || "").trim();
  const type = (listing.type || "").toLowerCase();
  const beds = Number(listing.beds) || 0;
  const price = Number(listing.price) || 0;
  const criteria = CRITERIA[zip];
  if (!criteria) return { matches: false, reason: `ZIP ${zip || "unknown"} not in watched list` };
  if (criteria.excluded.some((ex) => type.includes(ex)))
    return { matches: false, reason: `${listing.type} excluded in ZIP ${zip}` };
  for (const rule of criteria.rules) {
    if (rule.type === "any")
      return price < rule.maxPrice
        ? { matches: true, reason: `${listing.type} in ${zip} at $${price.toLocaleString()} — under $${rule.maxPrice.toLocaleString()}` }
        : { matches: false, reason: `$${price.toLocaleString()} over $${rule.maxPrice.toLocaleString()} limit in ${zip}` };
    const bedsMatch = type.includes(rule.type) && (beds === rule.beds || (rule.beds === 5 && beds >= 5));
    if (bedsMatch)
      return price < rule.maxPrice
        ? { matches: true, reason: `${beds}BR ${listing.type} in ${zip} at $${price.toLocaleString()} — under $${rule.maxPrice.toLocaleString()}` }
        : { matches: false, reason: `$${price.toLocaleString()} over $${rule.maxPrice.toLocaleString()} limit for ${beds}BR ${listing.type} in ${zip}` };
  }
  return { matches: false, reason: `No rule for ${beds}BR ${listing.type} in ${zip}` };
}

async function extractListing(subject, body) {
  const prompt = `Extract listing details from this Zillow email. Return ONLY valid JSON, no markdown.
Subject: ${subject}
Body: ${body.substring(0, 4000)}
Rules:
- "address" must be the full street address of THIS specific property including its ZIP code
- "zip" must come from that property's street address only
- "url" should be the direct Zillow property link, or the ZILLOW_URL value if present
{"address":"full address with zip","zip":"5-digit zip","type":"single family/duplex/condo/townhome/lot/other","beds":3,"price":185000,"url":"zillow url or null"}`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 256, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await r.json();
  const text = data.content?.[0]?.text || "{}";
  try {
    const s = text.indexOf("{"), e = text.lastIndexOf("}");
    return JSON.parse(text.substring(s, e + 1));
  } catch {
    return { zip: null, type: "unknown", beds: 0, price: 0, address: "Unknown" };
  }
}

async function processListing(email, accessToken) {
  const base = "https://gmail.googleapis.com/gmail/v1/users/me";
  const headers = { Authorization: `Bearer ${accessToken}` };

  const r = await fetch(`${base}/messages/${email.id}?format=full`, { headers });
  const full = await r.json();
  const { text: body, zillowUrl } = extractBody(full);
  const listing = await extractListing(email.subject, body);
  const evaluation = evaluateListing(listing);
  const result = { ...listing, ...evaluation };

  const jsonHeaders = { ...headers, "Content-Type": "application/json" };
  const url = result.url || zillowUrl || body.match(/ZILLOW_URL: (\S+)/)?.[1] || null;

  if (result.matches) {
    // Mark as read, keep in inbox
    await fetch(`${base}/messages/${email.id}/modify`, {
      method: "POST", headers: jsonHeaders,
      body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
    });
    const price = result.price ? `$${Number(result.price).toLocaleString()}` : "Unknown";
    const msg =
      `🏠 *Investment Match!*\n\n` +
      `📍 ${result.address || "Unknown"}\n` +
      `💰 ${price}\n` +
      `🛏 ${result.beds || "?"} bedrooms\n` +
      `🏡 ${result.type || "?"}\n` +
      `📮 ZIP: ${result.zip || "?"}\n\n` +
      `✅ ${result.reason}\n\n` +
      (url ? `[View on Zillow](${url})` : "⚠️ No Zillow link found");
    await tg(msg);
    return "notified";
  } else {
    // Trash and mark as read in parallel
    await Promise.all([
      fetch(`${base}/messages/${email.id}/trash`, { method: "POST", headers }),
      fetch(`${base}/messages/${email.id}/modify`, {
        method: "POST", headers: jsonHeaders,
        body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
      }),
    ]);
    return "trashed";
  }
}

// -- Main handler --
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { message } = req.body || {};
  if (!message?.text) return res.json({ ok: true });
  if (String(message.chat.id) !== process.env.TELEGRAM_CHAT_ID) return res.json({ ok: true });

  const cmd = message.text.trim().split(" ")[0].toLowerCase();

  if (cmd !== "/clean") return res.json({ ok: true });

  await tg("🧹 Starting cleanup...");

  const accounts = (await redis.get("gmail_accounts")) || [];
  if (!accounts.length) {
    await tg("❌ No Gmail accounts found. Open the app and connect your accounts first.");
    return res.json({ ok: true });
  }

  let totalTrashed = 0, totalNotified = 0, totalListingsTrashed = 0, totalTrauma = 0;

  for (const account of accounts) {
    const token = await getAccessToken(account.refreshToken);
    if (!token) {
      await tg(`⚠️ Could not refresh token for ${account.email} — skipping.`);
      continue;
    }

    await tg(`📬 Scanning ${account.email}...`);
    const emails = await scanGmail(token);

    const isListing = (e) => {
      const addr = (e.sender.match(/<(.+?)>/) ? e.sender.match(/<(.+?)>/)[1] : e.sender).toLowerCase();
      const sub = e.subject.toLowerCase();
      return addr.includes("zillow") && (sub.includes("new listing") || sub.includes("price cut"));
    };

    const listings = emails.filter(isListing);
    const regular = emails.filter((e) => !isListing(e));

    if (regular.length) {
      await trashEmails(token, regular.map((e) => e.id));
      totalTrashed += regular.length;
    }

    for (const listing of listings) {
      const action = await processListing(listing, token);
      if (action === "notified") totalNotified++;
      else totalListingsTrashed++;
    }
  }

  // Scan IMAP account (Hostinger)
  await tg(`📬 Scanning ${process.env.HOSTINGER_EMAIL}...`);
  const imapEmails = await scanImap();
  const imapListings = imapEmails.filter((e) => e.category === "listing");
  const imapTrauma = imapEmails.filter((e) => e.category === "trauma");
  const imapRegular = imapEmails.filter((e) => e.category === "inbox");

  // Trash regular IMAP inbox emails
  if (imapRegular.length) {
    await trashImapEmails(imapRegular.map((e) => e.id));
    totalTrashed += imapRegular.length;
  }

  // Process IMAP Zillow listings
  for (const listing of imapListings) {
    const action = await processImapListing(listing);
    if (action === "notified") totalNotified++;
    else totalListingsTrashed++;
  }

  // Process trauma dashboard emails
  for (const email of imapTrauma) {
    await processTraumaEmail(email);
    totalTrauma++;
  }

  const summary =
    `✅ *Cleanup complete!*\n\n` +
    `🗑 ${totalTrashed} emails trashed\n` +
    `🏠 ${totalNotified} listings matched & sent\n` +
    `🗑 ${totalListingsTrashed} listings trashed\n` +
    `📊 ${totalTrauma} trauma dashboard${totalTrauma !== 1 ? "s" : ""} processed`;
  await tg(summary);
  res.json({ ok: true });
}
