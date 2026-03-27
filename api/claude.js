import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

async function handleClassify(req, res) {
  const { accountId, senders } = req.body;
  if (!accountId || !Array.isArray(senders) || !senders.length) {
    return res.status(400).json({ error: "accountId and senders[] required" });
  }

  // Check Redis cache for all senders in parallel
  const cacheKeys = senders.map((s) => `classifier:${accountId}:${s.email}`);
  const cached = await Promise.all(cacheKeys.map((k) => redis.get(k)));

  const classifications = {};
  const uncached = [];

  for (let i = 0; i < senders.length; i++) {
    if (cached[i]) {
      classifications[senders[i].email] = cached[i];
    } else {
      uncached.push(senders[i]);
    }
  }

  // Classify uncached senders via Claude Haiku (batch in single prompt)
  if (uncached.length) {
    const senderLines = uncached
      .map(
        (s, i) =>
          `${i + 1}. ${s.email} (name: "${s.name}") - Subject: "${s.subject}" - Snippet: "${(s.snippet || "").slice(0, 120)}"`
      )
      .join("\n");

    const prompt = `Classify these email senders. For each, return:
- category: one of newsletter, transactional, human, vendor, marketing, notification, other
- confidence: 0 to 1
- suggested_action: one of trash, spam, keep
- reason: one sentence

Return ONLY valid JSON with no extra text. Format: {"email@addr": {"category":"...","confidence":0.9,"suggested_action":"...","reason":"..."}}

Senders:
${senderLines}`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await r.json();
    const text = data.content?.[0]?.text || "{}";

    // Robust JSON extraction (match pattern from listings.js)
    let parsed = {};
    try {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start !== -1 && end !== -1) {
        parsed = JSON.parse(text.slice(start, end + 1));
      }
    } catch {
      // If parse fails, we just skip AI results for this batch
    }

    // Cache each new classification in Redis and merge into results
    const storeOps = [];
    for (const s of uncached) {
      const cls = parsed[s.email];
      if (cls && cls.category && cls.suggested_action) {
        classifications[s.email] = cls;
        storeOps.push(
          redis.set(`classifier:${accountId}:${s.email}`, cls, { ex: 2592000 })
        );
        storeOps.push(
          redis.sadd(`seen_senders:${accountId}`, s.email)
        );
      }
    }
    await Promise.all(storeOps);
  }

  res.json({ classifications });
}

async function handleProxy(req, res) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "mcp-client-2025-04-04",
    },
    body: JSON.stringify(req.body),
  });

  const data = await response.json();
  return res.status(response.status).json(data);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (req.body.action === "classify") {
      return handleClassify(req, res);
    }
    return handleProxy(req, res);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
