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

  const { uids } = req.body;
  if (!uids?.length) return res.status(400).json({ error: "Missing uids" });

  const client = imapClient();

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      // Mark as read first
      await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });

      // Find spam/junk folder
      const mailboxes = await client.list();
      const spam = mailboxes.find(
        (m) =>
          m.specialUse === "\\Junk" ||
          /spam|junk/i.test(m.name)
      );

      if (spam) {
        await client.messageMove(uids, spam.path, { uid: true });
      } else {
        // Fallback: add Junk flag and delete from inbox
        await client.messageFlagsAdd(uids, ["\\Junk", "\\Deleted"], { uid: true });
      }
    } finally {
      lock.release();
    }

    await client.logout();
    res.json({ marked: uids.length, errors: 0 });
  } catch (err) {
    res.json({ marked: 0, errors: uids.length, error: err.message });
  }
}
