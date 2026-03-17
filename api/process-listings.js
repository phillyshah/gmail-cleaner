// Per-zip investment criteria
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
    rules: [
      { type: "any", maxPrice: 200000 },
    ],
  },
};

const WATCHED_ZIPS = Object.keys(CRITERIA);

function buildCriteriaPrompt() {
  return Object.entries(CRITERIA).map(([zip, c]) => {
    const rulesText = c.rules.map((r) =>
      r.type === "any"
        ? `  - Any property type: under $${r.maxPrice.toLocaleString()}`
        : `  - ${r.type} ${r.beds ? `${r.beds}BR` : ""}: under $${r.maxPrice.toLocaleString()}`
    ).join("\n");
    return `ZIP ${zip}:\n${rulesText}\n  Excluded: ${c.excluded.join(", ")}`;
  }).join("\n\n");
}

function extractZillowUrl(html) {
  // Pull all hrefs from anchor tags, find the first Zillow property link
  const hrefMatches = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
  const zillow = hrefMatches.find((u) =>
    /zillow\.com\/(homes|homedetails|b|mls)[^"'\s]*/i.test(u)
  );
  // Zillow often wraps links through a redirect — return raw URL, Claude can surface it
  return zillow || hrefMatches.find((u) => u.includes("zillow.com")) || null;
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
      for (const sub of part.parts) {
        const t = getPart(sub);
        if (t) return t;
      }
    }
    return null;
  }
  const text = getPart(email.payload) || email.snippet || "";
  // Append extracted URL so Claude can find it even if not in visible text
  return zillowUrl ? `${text}\n\nZILLOW_URL: ${zillowUrl}` : text;
}

async function extractListing(subject, body) {
  const prompt = `Extract listing details from this Zillow email. Return ONLY valid JSON, no markdown.

Subject: ${subject}
Body: ${body.substring(0, 4000)}

Rules:
- "address" must be the full street address of THIS specific property including its ZIP code
- "zip" must be extracted from that property's street address only — not from any other part of the email
- "url" should be the direct Zillow property link if present

{
  "address": "full street address including zip, e.g. 123 Main St, Pittsburgh, PA 15228",
  "zip": "5-digit zip from the property address only",
  "type": "single family / duplex / condo / townhome / lot / land / other",
  "beds": 3,
  "price": 185000,
  "url": "zillow url if found or null"
}`;

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
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  const text = data.content?.[0]?.text || "{}";
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    return JSON.parse(text.substring(start, end + 1));
  } catch {
    return { zip: null, type: "unknown", beds: 0, price: 0, address: "Unknown" };
  }
}

function extractZipFromAddress(address) {
  // Pull ZIP directly from the address string — trust this over Claude's zip field
  const match = (address || "").match(/\b(\d{5})\b/g);
  // Return the last 5-digit number in the address (ZIP is always at the end)
  return match ? match[match.length - 1] : null;
}

function evaluateListing(listing) {
  // Always derive ZIP from the address string — never trust Claude's zip field alone
  const zip = extractZipFromAddress(listing.address) || (listing.zip || "").trim();
  const type = (listing.type || "").toLowerCase();
  const beds = Number(listing.beds) || 0;
  const price = Number(listing.price) || 0;

  const criteria = CRITERIA[zip];
  if (!criteria) {
    return { matches: false, reason: `ZIP ${zip || "unknown"} is not in watched list` };
  }

  // Check exclusions for this zip
  const excluded = criteria.excluded.some((ex) => type.includes(ex));
  if (excluded) {
    return { matches: false, reason: `${listing.type} is excluded in ZIP ${zip}` };
  }

  // Evaluate each rule
  for (const rule of criteria.rules) {
    if (rule.type === "any") {
      if (price < rule.maxPrice) {
        return { matches: true, reason: `${listing.type} in ${zip} at $${price.toLocaleString()} — under $${rule.maxPrice.toLocaleString()} limit` };
      } else {
        return { matches: false, reason: `$${price.toLocaleString()} exceeds $${rule.maxPrice.toLocaleString()} limit for ZIP ${zip}` };
      }
    }
    if (type.includes(rule.type) && beds === rule.beds) {
      if (price < rule.maxPrice) {
        return { matches: true, reason: `${beds}BR ${listing.type} in ${zip} at $${price.toLocaleString()} — under $${rule.maxPrice.toLocaleString()} limit` };
      } else {
        return { matches: false, reason: `$${price.toLocaleString()} exceeds $${rule.maxPrice.toLocaleString()} limit for ${beds}BR ${listing.type} in ${zip}` };
      }
    }
    // Handle 5BR+ for duplexes
    if (type.includes(rule.type) && rule.beds === 5 && beds >= 5) {
      if (price < rule.maxPrice) {
        return { matches: true, reason: `${beds}BR ${listing.type} in ${zip} at $${price.toLocaleString()} — under $${rule.maxPrice.toLocaleString()} limit` };
      } else {
        return { matches: false, reason: `$${price.toLocaleString()} exceeds $${rule.maxPrice.toLocaleString()} limit for ${beds}BR ${listing.type} in ${zip}` };
      }
    }
  }

  return { matches: false, reason: `No matching rule for ${beds}BR ${listing.type} in ZIP ${zip}` };
}

async function analyzeListing(subject, body) {
  const listing = await extractListing(subject, body);
  const evaluation = evaluateListing(listing);
  return { ...listing, ...evaluation };
}

async function sendTelegram(listing) {
  const price = listing.price ? `$${Number(listing.price).toLocaleString()}` : "Unknown";
  // Extract URL from body fallback if Claude didn't pull it
  const url = listing.url ||
    (listing._body || "").match(/ZILLOW_URL: (\S+)/)?.[1] || null;
  const msg =
    `🏠 *Investment Match!*\n\n` +
    `📍 ${listing.address || "Unknown address"}\n` +
    `💰 ${price}\n` +
    `🛏 ${listing.beds || "?"} bedrooms\n` +
    `🏡 ${listing.type || "Unknown type"}\n` +
    `📮 ZIP: ${listing.zip || "?"}\n\n` +
    `✅ ${listing.reason}\n\n` +
    (url ? `[View on Zillow](${url})` : "⚠️ No Zillow link found");

  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: msg,
      parse_mode: "Markdown",
      disable_web_page_preview: false,
    }),
  });
}

async function markAsRead(id, accessToken) {
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
  await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/modify`, {
    method: "POST", headers,
    body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
  });
}

async function trashEmail(id, accessToken) {
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
  await Promise.all([
    fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/trash`, { method: "POST", headers }),
    fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/modify`, {
      method: "POST", headers,
      body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
    }),
  ]);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { accessToken, emails } = req.body;
  if (!accessToken || !emails?.length) return res.status(400).json({ error: "Missing params" });

  const results = [];

  for (const email of emails) {
    try {
      const r = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${email.id}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const full = await r.json();
      const body = extractBody(full);
      const analysis = await analyzeListing(email.subject, body);

      await markAsRead(email.id, accessToken);
      if (analysis.matches) {
        await sendTelegram({ ...analysis, _body: body });
        results.push({ id: email.id, action: "notified", ...analysis });
      } else {
        await trashEmail(email.id, accessToken);
        results.push({ id: email.id, action: "trashed", ...analysis });
      }
    } catch (err) {
      results.push({ id: email.id, action: "error", reason: err.message });
    }
  }

  res.json({ results });
}
