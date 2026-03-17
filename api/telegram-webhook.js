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

  let totalTrashed = 0, totalNotified = 0, totalListingsTrashed = 0;

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

    // Trash regular promo/social
    if (regular.length) {
      await trashEmails(token, regular.map((e) => e.id));
      totalTrashed += regular.length;
    }

    // Process Zillow listings
    for (const listing of listings) {
      const action = await processListing(listing, token);
      if (action === "notified") totalNotified++;
      else totalListingsTrashed++;
    }
  }

  const summary =
    `✅ *Cleanup complete!*\n\n` +
    `🗑 ${totalTrashed} promo/social emails trashed\n` +
    `🏠 ${totalNotified} listings matched & Telegram sent\n` +
    `🗑 ${totalListingsTrashed} listings trashed (no match)`;
  await tg(summary);
  res.json({ ok: true });
}
