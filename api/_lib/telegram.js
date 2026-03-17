export async function sendTelegram(text, opts = {}) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: opts.parseMode || "Markdown",
      disable_web_page_preview: opts.disablePreview ?? false,
    }),
  });
}
