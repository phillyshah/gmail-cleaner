import { searchGmail } from "./_lib/gmail.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { accessToken } = req.body;
  if (!accessToken) return res.status(400).json({ error: "No access token" });

  try {
    const [promotions, social] = await Promise.all([
      searchGmail(accessToken, "category:promotions newer_than:30d"),
      searchGmail(accessToken, "category:social newer_than:30d"),
    ]);
    res.json({ promotions, social });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
