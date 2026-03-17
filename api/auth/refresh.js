export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { refresh_token } = req.body;
  if (!refresh_token) return res.status(400).json({ error: "Missing refresh_token" });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token,
      client_id: process.env.VITE_GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });

  const tokens = await response.json();
  if (!response.ok) return res.status(400).json({ error: tokens.error_description || "Refresh failed" });

  res.json({
    access_token: tokens.access_token,
    expires_in: tokens.expires_in,
  });
}
