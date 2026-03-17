import { ImapFlow } from "imapflow";

export function createImapClient() {
  return new ImapFlow({
    host: process.env.HOSTINGER_IMAP_HOST || "imap.hostinger.com",
    port: 993,
    secure: true,
    auth: {
      user: process.env.HOSTINGER_EMAIL,
      pass: process.env.HOSTINGER_PASSWORD,
    },
    logger: false,
    tls: { rejectUnauthorized: false },
  });
}

/**
 * Run a callback with an IMAP client and mailbox lock, handling connect/disconnect.
 * Returns the callback's return value.
 */
export async function withImap(fn) {
  const client = createImapClient();
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    return await fn(client);
  } finally {
    lock.release();
    await client.logout();
  }
}
