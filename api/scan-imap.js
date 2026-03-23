import { withImap } from "./_lib/imap.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const emails = await withImap(async (client) => {
      const since = new Date();
      since.setDate(since.getDate() - 1);
      const uids = await client.search({ since }, { uid: true });
      if (!uids.length) return [];

      const results = [];
      for await (const msg of client.fetch(uids.slice(-50).reverse(), { envelope: true, flags: true }, { uid: true })) {
        const from = msg.envelope.from?.[0];
        const sender = from
          ? `${from.name ? from.name + " " : ""}<${from.address}>`.trim()
          : "Unknown";
        const subjectLower = (msg.envelope.subject || "").toLowerCase();
        const senderLower = sender.toLowerCase();
        const isListing =
          (senderLower.includes("zillow") && (subjectLower.includes("new listing") || subjectLower.includes("price cut"))) ||
          senderLower.includes("newwestern.com");
        const isTrauma = subjectLower.includes("trauma dashboard");

        results.push({
          id: String(msg.uid),
          subject: msg.envelope.subject || "(no subject)",
          sender,
          date: msg.envelope.date ? new Date(msg.envelope.date).toISOString() : null,
          category: isTrauma ? "trauma" : isListing ? "listing" : "inbox",
          source: "imap",
          account: process.env.HOSTINGER_EMAIL,
          unread: !msg.flags.has("\\Seen"),
        });
      }
      return results;
    });
    res.json({ emails });
  } catch (err) {
    res.json({ emails: [], error: err.message });
  }
}
