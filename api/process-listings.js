import { getFullMessage, markAsRead, trashMessage } from "./_lib/gmail.js";
import { extractBody, extractListing, evaluateListing, formatListingTelegram } from "./_lib/listings.js";
import { sendTelegram } from "./_lib/telegram.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { accessToken, emails } = req.body;
  if (!accessToken || !emails?.length) return res.status(400).json({ error: "Missing params" });

  const results = [];

  for (const email of emails) {
    try {
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
      results.push({ id: email.id, action: result.matches ? "notified" : "trashed", ...result });
    } catch (err) {
      results.push({ id: email.id, action: "error", reason: err.message });
    }
  }

  res.json({ results });
}
