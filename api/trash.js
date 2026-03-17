import { trashMessage } from "./_lib/gmail.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { accessToken, ids } = req.body;
  if (!accessToken || !ids) return res.status(400).json({ error: "Missing params" });

  let deleted = 0, errors = 0;
  await Promise.all(
    ids.map(async (id) => {
      const r = await trashMessage(accessToken, id);
      if (r.ok) deleted++;
      else errors++;
    })
  );

  res.json({ deleted, errors });
}
