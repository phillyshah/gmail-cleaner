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

      // Find trash folder
      const mailboxes = await client.list();
      const trash = mailboxes.find(
        (m) =>
          m.specialUse === "\\Trash" ||
          /trash|deleted/i.test(m.name)
      );

      if (trash) {
        await client.messageMove(uids, trash.path, { uid: true });
      } else {
        await client.messageFlagsAdd(uids, ["\\Deleted"], { uid: true });
      }
    } finally {
      lock.release();
    }

    await client.logout();
    res.json({ deleted: uids.length, errors: 0 });
  } catch (err) {
    res.json({ deleted: 0, errors: uids.length, error: err.message });
  }
}
