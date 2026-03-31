import { searchGmail } from "./_lib/gmail.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { accessToken } = req.body;
  if (!accessToken) return res.status(400).json({ error: "No access token" });

  try {
    const emails = await searchGmail(accessToken, "is:unread newer_than:7d");
    res.json({ emails });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
