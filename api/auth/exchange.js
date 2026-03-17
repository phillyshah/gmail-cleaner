import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "Missing code" });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.VITE_GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: "postmessage",
      grant_type: "authorization_code",
    }),
  });

  const tokens = await response.json();
  if (!response.ok) return res.status(400).json({ error: tokens.error_description || "Exchange failed" });

  // Store refresh token server-side for Telegram /clean command
  if (tokens.refresh_token && tokens.access_token) {
    try {
      const profileRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const profile = await profileRes.json();
      const email = profile.emailAddress;
      if (email) {
        const accounts = (await redis.get("gmail_accounts")) || [];
        const idx = accounts.findIndex((a) => a.email === email);
        if (idx >= 0) accounts[idx].refreshToken = tokens.refresh_token;
        else accounts.push({ email, refreshToken: tokens.refresh_token });
        await redis.set("gmail_accounts", accounts);
      }
    } catch (e) {
      console.error("Redis store failed:", e.message);
    }
  }

  res.json({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: tokens.expires_in,
  });
}
