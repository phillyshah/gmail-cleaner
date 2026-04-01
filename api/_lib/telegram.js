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

export async function sendTelegramDocument(buffer, filename, caption) {
  const form = new FormData();
  form.append("chat_id", process.env.TELEGRAM_CHAT_ID);
  form.append("document", new Blob([buffer]), filename);
  if (caption) form.append("caption", caption);
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendDocument`, {
    method: "POST",
    body: form,
  });
}
