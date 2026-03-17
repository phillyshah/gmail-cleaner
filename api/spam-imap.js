import { withImap } from "./_lib/imap.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { uids } = req.body;
  if (!uids?.length) return res.status(400).json({ error: "Missing uids" });

  try {
    await withImap(async (client) => {
      await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
      const mailboxes = await client.list();
      const spam = mailboxes.find(
        (m) => m.specialUse === "\\Junk" || /spam|junk/i.test(m.name)
      );
      if (spam) await client.messageMove(uids, spam.path, { uid: true });
      else await client.messageFlagsAdd(uids, ["\\Junk", "\\Deleted"], { uid: true });
    });
    res.json({ marked: uids.length, errors: 0 });
  } catch (err) {
    res.json({ marked: 0, errors: uids.length, error: err.message });
  }
}
