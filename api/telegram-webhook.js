import { Redis } from "@upstash/redis";
import * as XLSX from "xlsx";
import { withImap } from "./_lib/imap.js";
import { sendTelegram } from "./_lib/telegram.js";
import { getAccessToken, searchGmail, trashMessage, markAsRead, getFullMessage, modifyMessage } from "./_lib/gmail.js";
import { extractBody, extractListing, evaluateListing, formatListingTelegram } from "./_lib/listings.js";

export const config = { maxDuration: 60 };

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

function isListing(email) {
  const addr = (email.sender.match(/<(.+?)>/) ? email.sender.match(/<(.+?)>/)[1] : email.sender).toLowerCase();
  const sub = email.subject.toLowerCase();
  return (addr.includes("zillow") && (sub.includes("new listing") || sub.includes("price cut"))) || addr.includes("newwestern.com");
}

async function scanImap() {
  return withImap(async (client) => {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const uids = await client.search({ since }, { uid: true });
    if (!uids.length) return [];

    const emails = [];
    for await (const msg of client.fetch(uids.slice(-50).reverse(), { envelope: true, flags: true }, { uid: true })) {
      const from = msg.envelope.from?.[0];
      const sender = from ? `${from.name ? from.name + " " : ""}<${from.address}>` : "Unknown";
      const sub = (msg.envelope.subject || "").toLowerCase();
      const snd = sender.toLowerCase();
      const category = sub.includes("trauma dashboard") ? "trauma"
        : ((snd.includes("zillow") && (sub.includes("new listing") || sub.includes("price cut"))) || snd.includes("newwestern.com")) ? "listing"
        : "inbox";
      emails.push({
        id: String(msg.uid), subject: msg.envelope.subject || "(no subject)",
        sender, date: msg.envelope.date ? new Date(msg.envelope.date).toISOString() : null,
        category, source: "imap",
      });
    }
    return emails;
  });
}

async function spamImapEmails(uids) {
  await withImap(async (client) => {
    await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
    const mailboxes = await client.list();
    const spam = mailboxes.find((m) => m.specialUse === "\\Junk" || /spam|junk/i.test(m.name));
    if (spam) await client.messageMove(uids, spam.path, { uid: true });
    else await client.messageFlagsAdd(uids, ["\\Junk", "\\Deleted"], { uid: true });
  });
}

async function trashImapEmails(uids) {
  await withImap(async (client) => {
    await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
    const mailboxes = await client.list();
    const trash = mailboxes.find((m) => m.specialUse === "\\Trash" || /trash|deleted/i.test(m.name));
    if (trash) await client.messageMove(uids, trash.path, { uid: true });
    else await client.messageFlagsAdd(uids, ["\\Deleted"], { uid: true });
  });
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
  await withImap(async (client) => {
    let buffer = null, emailDate = email.date ? new Date(email.date) : new Date();
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

    if (!buffer) { await sendTelegram("⚠️ No Excel attachment found in trauma dashboard email"); return; }

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
      await sendTelegram("⚠️ Could not find Revenue by Product Type table in trauma dashboard");
    } else {
      const headers = rows[colHeaderRow];
      const monthColIdx = headers.findIndex((c, idx) => idx > 0 && Number(c) === currentMonth);
      if (monthColIdx === -1) {
        await sendTelegram(`⚠️ Month ${currentMonth} column not found in trauma dashboard`);
      } else {
        const amount = Number(rows[grandTotalRow][monthColIdx]) || 0;
        const formatted = "$" + amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
        await sendTelegram(`📊 MH Trauma sales as of ${dateStr} are ${formatted}`);
      }
    }
  });
}

async function processGmailListing(email, accessToken) {
  const full = await getFullMessage(accessToken, email.id);
  const { text: body, zillowUrl } = extractBody(full);
  const listing = await extractListing(email.subject, body);
  const evaluation = evaluateListing(listing);
  const result = { ...listing, ...evaluation };
  const url = result.url || zillowUrl || body.match(/ZILLOW_URL: (\S+)/)?.[1] || null;

  if (result.matches) {
    await sendTelegram(formatListingTelegram(result, url));
  }

  // Always mark as read and trash all Zillow emails
  await Promise.all([markAsRead(accessToken, email.id), trashMessage(accessToken, email.id)]);
  return result.matches ? "notified" : "trashed";
}

async function spamGmailEmails(accessToken, ids) {
  await Promise.all(
    ids.map((id) =>
      modifyMessage(accessToken, id, { addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] })
    )
  );
}

// -- Main handler --
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // Respond to Telegram immediately to prevent retries
  res.json({ ok: true });

  const { message } = req.body || {};
  if (!message?.text) return;
  if (String(message.chat.id) !== process.env.TELEGRAM_CHAT_ID) return;

  const cmd = message.text.trim().split(" ")[0].toLowerCase();
  if (cmd !== "/clean") return;

  await sendTelegram("🧹 Starting cleanup...");

  const accounts = (await redis.get("gmail_accounts")) || [];
  if (!accounts.length) {
    await sendTelegram("❌ No Gmail accounts found. Open the app and connect your accounts first.");
    return;
  }

  let totalSpammed = 0, totalNotified = 0, totalListingsTrashed = 0, totalTrauma = 0;

  // Scan all Gmail accounts in parallel
  const accountResults = await Promise.all(
    accounts.map(async (account) => {
      const token = await getAccessToken(account.refreshToken);
      if (!token) return { account, token: null, emails: [] };
      const [promos, social] = await Promise.all([
        searchGmail(token, "category:promotions newer_than:30d"),
        searchGmail(token, "category:social newer_than:30d"),
      ]);
      return {
        account, token,
        emails: [
          ...promos.map((e) => ({ ...e, category: "promo" })),
          ...social.map((e) => ({ ...e, category: "social" })),
        ],
      };
    })
  );

  for (const { account, token, emails } of accountResults) {
    if (!token) {
      await sendTelegram(`⚠️ Could not refresh token for ${account.email} — skipping.`);
      continue;
    }

    const listings = emails.filter(isListing);
    const spam = emails.filter((e) => !isListing(e));

    // Mark all promo/social as spam (not just trash — keep inbox clean)
    if (spam.length) {
      await spamGmailEmails(token, spam.map((e) => e.id));
      totalSpammed += spam.length;
    }

    // Analyze each Zillow listing through Claude
    for (const listing of listings) {
      try {
        const action = await processGmailListing(listing, token);
        if (action === "notified") totalNotified++;
        else totalListingsTrashed++;
      } catch (err) {
        // If listing analysis fails, trash it
        await trashMessage(token, listing.id).catch(() => {});
        totalListingsTrashed++;
      }
    }
  }

  // Scan IMAP account (Hostinger)
  await sendTelegram(`📬 Scanning ${process.env.HOSTINGER_EMAIL}...`);
  const imapEmails = await scanImap();
  const imapListings = imapEmails.filter((e) => e.category === "listing");
  const imapTrauma = imapEmails.filter((e) => e.category === "trauma");
  const imapSpam = imapEmails.filter((e) => e.category === "inbox");

  // Spam all regular IMAP emails
  if (imapSpam.length) {
    await spamImapEmails(imapSpam.map((e) => e.id));
    totalSpammed += imapSpam.length;
  }

  // Trash IMAP listings (can't do full body analysis via IMAP easily)
  if (imapListings.length) {
    await trashImapEmails(imapListings.map((e) => e.id));
    totalListingsTrashed += imapListings.length;
  }

  // Process trauma dashboard emails
  for (const email of imapTrauma) {
    try {
      await processTraumaEmail(email);
      totalTrauma++;
    } catch (err) {
      await sendTelegram(`⚠️ Trauma error: ${err.message}`);
    }
  }

  await sendTelegram(
    `✅ *Cleanup complete!*\n\n` +
    `🚫 ${totalSpammed} emails spammed\n` +
    `🏠 ${totalNotified} listings matched & sent\n` +
    `🗑 ${totalListingsTrashed} listings trashed\n` +
    `📊 ${totalTrauma} trauma dashboard${totalTrauma !== 1 ? "s" : ""} processed`
  );
}
