import { CRITERIA } from "./criteria.js";

export function extractZillowUrl(html) {
  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
  return (
    hrefs.find((u) => /zillow\.com\/(homes|homedetails|b|mls)/i.test(u)) ||
    hrefs.find((u) => u.includes("zillow.com")) ||
    null
  );
}

export function extractBody(email) {
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
  return { text: zillowUrl ? `${text}\nZILLOW_URL: ${zillowUrl}` : text, zillowUrl };
}

export async function extractListing(subject, body) {
  const prompt = `Extract listing details from this real estate email. Return ONLY valid JSON, no markdown.
Subject: ${subject}
Body: ${body.substring(0, 4000)}
Rules:
- "address" must be the full street address of THIS specific property including its ZIP code
- "zip" must come from that property's street address only
- "price" must be the listing/sale price as a number (no $ or commas). Look for price, list price, asking price, sale price, ARV, or any dollar amount associated with the property
- "url" should be a property link if present (Zillow, New Western, or any listing URL), or the ZILLOW_URL value if present
{"address":"full address with zip","zip":"5-digit zip","type":"single family/duplex/condo/townhome/lot/other","beds":3,"price":185000,"url":"listing url or null"}`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
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
  const data = await r.json();
  const text = data.content?.[0]?.text || "{}";
  try {
    const s = text.indexOf("{"),
      e = text.lastIndexOf("}");
    return JSON.parse(text.substring(s, e + 1));
  } catch {
    return { zip: null, type: "unknown", beds: 0, price: 0, address: "Unknown" };
  }
}

export function extractZipFromAddress(address) {
  const matches = [...(address || "").matchAll(/\b(\d{5})\b/g)].map((m) => m[1]);
  return matches[matches.length - 1] || null;
}

export function evaluateListing(listing) {
  const zip = extractZipFromAddress(listing.address) || (listing.zip || "").trim();
  const type = (listing.type || "").toLowerCase();
  const beds = Number(listing.beds) || 0;
  const price = Number(listing.price) || 0;

  const criteria = CRITERIA[zip];
  if (!criteria) return { matches: false, reason: `ZIP ${zip || "unknown"} not in watched list` };
  if (criteria.excluded.some((ex) => type.includes(ex)))
    return { matches: false, reason: `${listing.type} excluded in ZIP ${zip}` };

  for (const rule of criteria.rules) {
    if (rule.type === "any") {
      return price < rule.maxPrice
        ? { matches: true, reason: `${listing.type} in ${zip} at $${price.toLocaleString()} — under $${rule.maxPrice.toLocaleString()}` }
        : { matches: false, reason: `$${price.toLocaleString()} over $${rule.maxPrice.toLocaleString()} limit in ${zip}` };
    }
    const bedsMatch = type.includes(rule.type) && (beds === rule.beds || (rule.beds === 5 && beds >= 5));
    if (bedsMatch) {
      return price < rule.maxPrice
        ? { matches: true, reason: `${beds}BR ${listing.type} in ${zip} at $${price.toLocaleString()} — under $${rule.maxPrice.toLocaleString()}` }
        : { matches: false, reason: `$${price.toLocaleString()} over $${rule.maxPrice.toLocaleString()} limit for ${beds}BR ${listing.type} in ${zip}` };
    }
  }
  return { matches: false, reason: `No rule for ${beds}BR ${listing.type} in ${zip}` };
}

export function formatListingTelegram(listing, zillowUrl) {
  const price = listing.price ? `$${Number(listing.price).toLocaleString()}` : "Unknown";
  const url = listing.url || zillowUrl || null;
  return (
    `🏠 *Investment Match!*\n\n` +
    `📍 ${listing.address || "Unknown"}\n` +
    `💰 ${price}\n` +
    `🛏 ${listing.beds || "?"} bedrooms\n` +
    `🏡 ${listing.type || "?"}\n` +
    `📮 ZIP: ${listing.zip || "?"}\n\n` +
    `✅ ${listing.reason}\n\n` +
    (url ? `[View Listing](${url})` : "⚠️ No listing link found")
  );
}
