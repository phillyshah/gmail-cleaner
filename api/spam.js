import { modifyMessage } from "./_lib/gmail.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { accessToken, ids } = req.body;
  if (!accessToken || !ids) return res.status(400).json({ error: "Missing params" });

  let marked = 0, errors = 0;
  await Promise.all(
    ids.map(async (id) => {
      const r = await modifyMessage(accessToken, id, {
        addLabelIds: ["SPAM"],
        removeLabelIds: ["INBOX"],
      });
      if (r.ok) marked++;
      else errors++;
    })
  );

  res.json({ marked, errors });
}
