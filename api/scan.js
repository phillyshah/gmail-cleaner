export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { accessToken } = req.body;
  if (!accessToken) return res.status(400).json({ error: "No access token" });

  const headers = { Authorization: `Bearer ${accessToken}` };
  const base = "https://gmail.googleapis.com/gmail/v1/users/me";

  async function searchEmails(query) {
    const r = await fetch(
      `${base}/messages?${new URLSearchParams({ q: query, maxResults: 50 })}`,
      { headers }
    );
    const data = await r.json();
    if (!data.messages) return [];

    const emails = [];
    for (let i = 0; i < data.messages.length; i += 10) {
      const batch = data.messages.slice(i, i + 10);
      const details = await Promise.all(
        batch.map((msg) =>
          fetch(
            `${base}/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
            { headers }
          ).then((r) => r.json())
        )
      );
      for (const detail of details) {
        const h = detail.payload?.headers || [];
        emails.push({
          id: detail.id,
          subject: h.find((x) => x.name === "Subject")?.value || "(no subject)",
          sender: h.find((x) => x.name === "From")?.value || "(unknown)",
        });
      }
    }
    return emails;
  }

  try {
    const [promotions, social] = await Promise.all([
      searchEmails("category:promotions newer_than:30d"),
      searchEmails("category:social newer_than:30d"),
    ]);
    res.json({ promotions, social });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
