import { ImapFlow } from "imapflow";

function imapClient() {
  return new ImapFlow({
    host: process.env.HOSTINGER_IMAP_HOST || "imap.hostinger.com",
    port: 993,
    secure: true,
    auth: {
      user: process.env.HOSTINGER_EMAIL,
      pass: process.env.HOSTINGER_PASSWORD,
    },
    logger: false,
    tls: { rejectUnauthorized: false },
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const client = imapClient();
  const emails = [];

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      const since = new Date();
      since.setDate(since.getDate() - 30);

      const uids = await client.search({ since }, { uid: true });
      if (uids.length > 0) {
        const batch = uids.slice(-50).reverse();
        for await (const msg of client.fetch(batch, { envelope: true, flags: true }, { uid: true })) {
          const from = msg.envelope.from?.[0];
          const sender = from
            ? `${from.name ? from.name + " " : ""}<${from.address}>`.trim()
            : "Unknown";
          const subjectLower = (msg.envelope.subject || "").toLowerCase();
          const senderLower = sender.toLowerCase();
          const isListing =
            senderLower.includes("zillow") &&
            (subjectLower.includes("new listing") || subjectLower.includes("price cut"));

          emails.push({
            id: String(msg.uid),
            subject: msg.envelope.subject || "(no subject)",
            sender,
            category: isListing ? "listing" : "inbox",
            source: "imap",
            account: process.env.HOSTINGER_EMAIL,
            unread: !msg.flags.has("\\Seen"),
          });
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();
    res.json({ emails });
  } catch (err) {
    res.json({ emails: [], error: err.message });
  }
}
