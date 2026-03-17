export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { accessToken, ids } = req.body;
  if (!accessToken || !ids) return res.status(400).json({ error: "Missing params" });

  const base = "https://gmail.googleapis.com/gmail/v1/users/me";
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };

  let deleted = 0;
  let errors = 0;

  await Promise.all(
    ids.map(async (id) => {
      const r = await fetch(`${base}/messages/${id}/trash`, { method: "POST", headers });
      if (r.ok) deleted++;
      else errors++;
    })
  );

  res.json({ deleted, errors });
}
