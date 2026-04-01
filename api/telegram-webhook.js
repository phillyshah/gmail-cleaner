import { Redis } from "@upstash/redis";
import { withImap } from "./_lib/imap.js";
import { sendTelegram, sendTelegramDocument } from "./_lib/telegram.js";
import { getAccessToken, searchGmail, trashMessage, markAsRead, getFullMessage, modifyMessage, getOrCreateLabel } from "./_lib/gmail.js";
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
    since.setDate(since.getDate() - 7);
    const uids = await client.search({ since, unseen: true }, { uid: true });
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
  if (struct.part && (mime.includes("sheet") || mime.includes("excel") || (mime === "application/octet-stream" && name.match(/\.xlsx?$/)))) {
    return { part: struct.part, filename: struct.parameters?.name || struct.disposition?.parameters?.filename || "trauma-dashboard.xlsx" };
  }
  if (struct.childNodes) { for (const c of struct.childNodes) { const f = findExcelPart(c); if (f) return f; } }
  return null;
}

async function processTraumaEmail(email) {
  await withImap(async (client) => {
    let buffer = null, filename = "trauma-dashboard.xlsx", emailDate = email.date ? new Date(email.date) : new Date();
    for await (const msg of client.fetch([email.id], { envelope: true, bodyStructure: true }, { uid: true })) {
      emailDate = msg.envelope.date || emailDate;
      const result = findExcelPart(msg.bodyStructure);
      if (result) {
        filename = result.filename;
        const dl = await client.download(email.id, result.part, { uid: true });
        const chunks = []; for await (const chunk of dl.content) chunks.push(chunk);
        buffer = Buffer.concat(chunks);
      }
    }
    await client.messageFlagsAdd([email.id], ["\\Seen"], { uid: true });

    if (!buffer) { await sendTelegram("⚠️ No Excel attachment found in trauma dashboard email"); return; }

    const dateStr = new Date(emailDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    await sendTelegramDocument(buffer, filename, `Trauma Dashboard — ${dateStr}`);
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

async function labelGmailEmails(accessToken, ids) {
  const labelId = await getOrCreateLabel(accessToken, "telegram");
  await Promise.all(
    ids.map((id) =>
      modifyMessage(accessToken, id, { addLabelIds: [labelId], removeLabelIds: ["UNREAD"] })
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

  let totalLabeled = 0, totalNotified = 0, totalListingsTrashed = 0, totalTrauma = 0;

  try {
    // Scan all Gmail accounts in parallel
    const accountResults = await Promise.all(
      accounts.map(async (account) => {
        const token = await getAccessToken(account.refreshToken);
        if (!token) return { account, token: null, emails: [] };
        const emails = await searchGmail(token, "is:unread newer_than:7d");
        // Tag listings based on sender/subject
        const tagged = emails.map((e) => {
          if (isListing(e)) return { ...e, category: "listing" };
          return { ...e, category: "inbox" };
        });
        return { account, token, emails: tagged };
      })
    );

    for (const { account, token, emails } of accountResults) {
      if (!token) {
        await sendTelegram(`⚠️ Could not refresh token for ${account.email} — skipping.`);
        continue;
      }

      const listings = emails.filter(isListing);
      const rest = emails.filter((e) => !isListing(e));

      // Mark read and trash non-listing emails
      if (rest.length) {
        await Promise.all(
          rest.map((e) => Promise.all([markAsRead(token, e.id), trashMessage(token, e.id)]))
        );
        totalLabeled += rest.length;
      }

      // Analyze each listing through Claude
      for (const listing of listings) {
        try {
          const action = await processGmailListing(listing, token);
          if (action === "notified") totalNotified++;
          else totalListingsTrashed++;
        } catch (err) {
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

    // Trash regular IMAP inbox emails (mark read + trash, not spam)
    if (imapSpam.length) {
      await trashImapEmails(imapSpam.map((e) => e.id));
    }

    // Trash IMAP listings (mark read + trash)
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
  } catch (err) {
    await sendTelegram(`❌ Error during cleanup: ${err.message}`);
  }

  await sendTelegram(
    `✅ *Cleanup complete!*\n\n` +
    `🏷 ${totalLabeled} emails tagged for review\n` +
    `🏠 ${totalNotified} listings matched & sent\n` +
    `🗑 ${totalListingsTrashed} listings trashed\n` +
    `📊 ${totalTrauma} trauma dashboard${totalTrauma !== 1 ? "s" : ""} processed`
  );
}
