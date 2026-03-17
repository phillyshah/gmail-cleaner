import { useState, useCallback, useRef, useEffect, useMemo } from "react";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES = "https://www.googleapis.com/auth/gmail.modify";
const PREFS_KEY = "inbox-zero-prefs";
const ACCOUNTS_KEY = "gmail_accounts";
const AUTO_TRASH_THRESHOLD = 3;

// -- Prefs --
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{"safe":[],"trash":{}}');
  } catch {
    return { safe: [], trash: {} };
  }
}

function extractEmail(sender) {
  const m = sender.match(/<(.+?)>/);
  return (m ? m[1] : sender).toLowerCase().trim();
}

function applyChoices(keptEmails, trashedEmails) {
  const prefs = loadPrefs();
  const safeSet = new Set(prefs.safe);
  const trashCounts = { ...prefs.trash };
  keptEmails.forEach((e) => {
    const addr = extractEmail(e.sender);
    safeSet.add(addr);
    delete trashCounts[addr];
  });
  trashedEmails.forEach((e) => {
    const addr = extractEmail(e.sender);
    safeSet.delete(addr);
    trashCounts[addr] = (trashCounts[addr] || 0) + 1;
  });
  localStorage.setItem(PREFS_KEY, JSON.stringify({ safe: [...safeSet], trash: trashCounts }));
}

// -- Multi-account storage --
function loadAccounts() {
  try {
    // Migrate from old single-account format
    const oldRefresh = localStorage.getItem("gmail_refresh_token");
    if (oldRefresh) {
      let accessToken = null, expiresAt = null;
      try {
        const cached = JSON.parse(localStorage.getItem("gmail_token_cache") || "{}");
        accessToken = cached.token || null;
        expiresAt = cached.expiresAt || null;
      } catch {}
      const migrated = [{ email: null, refreshToken: oldRefresh, accessToken, expiresAt }];
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(migrated));
      localStorage.removeItem("gmail_refresh_token");
      localStorage.removeItem("gmail_token_cache");
      localStorage.removeItem("gmail_connected");
      return migrated;
    }
    return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveAccounts(accounts) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

async function getValidToken(account) {
  if (account.accessToken && account.expiresAt && account.expiresAt > Date.now() + 120_000) {
    return account.accessToken;
  }
  if (!account.refreshToken) return null;
  try {
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: account.refreshToken }),
    });
    const data = await res.json();
    if (data.access_token) return data.access_token;
    return null;
  } catch {
    return null;
  }
}

async function fetchProfileEmail(accessToken) {
  try {
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    return data.emailAddress || null;
  } catch {
    return null;
  }
}

// -- Multi-account hook --
function useGoogleAccounts() {
  const [accounts, setAccountsState] = useState(() => loadAccounts());
  const [initializing, setInitializing] = useState(false);

  const setAccounts = (updated) => {
    saveAccounts(updated);
    setAccountsState(updated);
  };

  useEffect(() => {
    if (accounts.length === 0) return;
    setInitializing(true);
    Promise.all(
      accounts.map(async (account) => {
        const token = await getValidToken(account);
        if (!token) return null;
        let email = account.email;
        if (!email) email = await fetchProfileEmail(token);
        return { ...account, email, accessToken: token, expiresAt: Date.now() + 3590_000 };
      })
    ).then((results) => {
      setAccounts(results.filter(Boolean));
      setInitializing(false);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addAccount = () => {
    if (!window.google?.accounts?.oauth2) return;
    const client = window.google.accounts.oauth2.initCodeClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      ux_mode: "popup",
      prompt: "select_account consent",
      callback: async (response) => {
        if (!response.code) return;
        const res = await fetch("/api/auth/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: response.code }),
        });
        const tokens = await res.json();
        if (!tokens.access_token) return;
        const email = await fetchProfileEmail(tokens.access_token);
        const current = loadAccounts();
        if (email && current.some((a) => a.email === email)) return;
        const newAccount = {
          email: email || `Account ${current.length + 1}`,
          refreshToken: tokens.refresh_token,
          accessToken: tokens.access_token,
          expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
        };
        setAccounts([...current, newAccount]);
      },
    });
    client.requestCode();
  };

  const removeAccount = (email) => setAccounts(accounts.filter((a) => a.email !== email));

  return { accounts, addAccount, removeAccount, initializing };
}

// -- CSS --
const globalCSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes slideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }

  *, *::before, *::after { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin: 0; }

  .iz-wrap {
    min-height: 100vh;
    background: #1a1a2e;
    color: #f0eeee;
    font-family: -apple-system, 'SF Pro Display', 'Inter', sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .iz-container {
    max-width: 480px;
    margin: 0 auto;
    padding: 60px 20px 180px;
  }
  @media (min-width: 600px) {
    .iz-container { padding: 80px 28px 200px; }
  }

  .iz-card { background: #252540; border-radius: 18px; overflow: hidden; margin-bottom: 14px; border: 1px solid rgba(255,255,255,0.08); }

  .iz-card-row {
    display: flex; align-items: center;
    padding: 16px 18px; gap: 14px;
    border-bottom: 1px solid rgba(255,255,255,0.07);
    min-height: 60px; cursor: pointer;
    transition: background 0.1s ease; user-select: none;
  }
  .iz-card-row:last-child { border-bottom: none; }
  .iz-card-row:active { background: rgba(255,255,255,0.06); }

  .iz-check {
    width: 28px; height: 28px; flex-shrink: 0;
    border-radius: 50%; border: 2px solid rgba(255,255,255,0.3);
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s ease;
  }
  .iz-check.on-trash { background: #ff453a; border-color: #ff453a; }
  .iz-check.on-safe  { border-color: rgba(52,211,100,0.6); }

  .iz-row-info { flex: 1; min-width: 0; }
  .iz-row-sender { font-size: 16px; font-weight: 600; color: #f0eeee; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 4px; }
  .iz-row-subject { font-size: 14px; color: #b0aec0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.4; }
  .iz-row-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; }

  .iz-pill { font-size: 11px; font-weight: 700; letter-spacing: 0.3px; padding: 4px 10px; border-radius: 20px; text-transform: uppercase; }
  .iz-pill-promo    { background: rgba(255,159,10,0.2);  color: #ffb340; }
  .iz-pill-social   { background: rgba(10,132,255,0.2);  color: #409cff; }
  .iz-pill-listing  { background: rgba(52,211,100,0.2);  color: #34d364; }
  .iz-pill-inbox    { background: rgba(255,255,255,0.1); color: #c0bdd0; }
  .iz-pill-account  { font-size: 10px; font-weight: 500; padding: 3px 8px; border-radius: 20px; background: rgba(255,255,255,0.08); color: #a0a0b8; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .iz-section-hdr {
    padding: 12px 18px 8px; font-size: 13px; font-weight: 700; letter-spacing: 0.4px;
    text-transform: uppercase; color: #a0a0b8;
    display: flex; justify-content: space-between; align-items: center;
  }
  .iz-section-tap { font-size: 14px; font-weight: 600; color: #409cff; cursor: pointer; letter-spacing: 0; text-transform: none; }
  .iz-section-tap:hover { opacity: 0.7; }

  .iz-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 18px; }
  .iz-stat-box { background: #252540; border-radius: 16px; padding: 18px 14px; border: 1px solid rgba(255,255,255,0.07); }
  .iz-stat-lbl { font-size: 13px; font-weight: 500; color: #a0a0b8; margin-bottom: 6px; }
  .iz-stat-val { font-size: 30px; font-weight: 700; letter-spacing: -0.5px; color: #f0eeee; }

  .iz-btn {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    width: 100%; border: none; cursor: pointer;
    font-family: -apple-system, 'SF Pro Display', 'Inter', sans-serif;
    font-size: 17px; font-weight: 700; letter-spacing: -0.2px;
    border-radius: 16px; padding: 18px 24px;
    transition: opacity 0.15s ease, transform 0.1s ease;
    -webkit-font-smoothing: antialiased;
  }
  .iz-btn:hover:not(:disabled) { opacity: 0.88; }
  .iz-btn:active:not(:disabled) { transform: scale(0.98); opacity: 0.75; }
  .iz-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .iz-btn-primary   { background: #409cff; color: #fff; }
  .iz-btn-red       { background: #ff453a; color: #fff; }
  .iz-btn-orange    { background: #ff9f0a; color: #fff; }
  .iz-btn-green     { background: #34d364; color: #fff; }
  .iz-btn-secondary { background: #35354f; color: #f0eeee; }
  .iz-btn-google    { background: #fff; color: #1a1a2e; }
  .iz-btn-google:hover:not(:disabled) { background: #f0eeff !important; }

  /* Account selector — always visible on idle */
  .iz-account-selector {
    display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 20px;
  }
  .iz-account-chip {
    display: flex; align-items: center; gap: 7px;
    padding: 10px 16px; border-radius: 22px; cursor: pointer;
    font-size: 15px; font-weight: 600; font-family: inherit;
    border: 2px solid rgba(255,255,255,0.18);
    background: #252540; color: #b0aec0;
    transition: all 0.15s ease; user-select: none;
  }
  .iz-account-chip.active { background: #409cff; border-color: #409cff; color: #fff; }
  .iz-account-chip:active { transform: scale(0.97); }
  .iz-account-chip-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex-shrink: 0; }

  /* Account management */
  .iz-account-row { display: flex; align-items: center; padding: 14px 18px; gap: 14px; border-bottom: 1px solid rgba(255,255,255,0.07); }
  .iz-account-row:last-child { border-bottom: none; }
  .iz-account-avatar { width: 36px; height: 36px; border-radius: 50%; background: #35354f; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 700; color: #409cff; flex-shrink: 0; }
  .iz-account-email { flex: 1; font-size: 15px; font-weight: 500; color: #f0eeee; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .iz-account-remove { background: none; border: none; cursor: pointer; color: #ff6b6b; font-size: 14px; font-weight: 600; font-family: inherit; padding: 6px 10px; border-radius: 8px; }
  .iz-account-remove:hover { background: rgba(255,69,58,0.15); }

  .iz-log-entry { font-size: 14px; color: #a0a0b8; line-height: 2; }
  .iz-log-entry.active { color: #409cff; font-weight: 500; }

  .iz-sticky {
    position: fixed; bottom: 0; left: 0; right: 0; z-index: 100;
    background: rgba(26,26,46,0.92);
    backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
    border-top: 1px solid rgba(255,255,255,0.1);
    padding: 14px 20px max(env(safe-area-inset-bottom), 18px);
  }
  .iz-sticky-inner { max-width: 480px; margin: 0 auto; display: flex; flex-direction: column; gap: 10px; }
`;

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

function Spinner({ color = "#fff" }) {
  return (
    <span style={{
      display: "inline-block", width: 18, height: 18,
      border: "2px solid rgba(255,255,255,0.2)", borderTopColor: color,
      borderRadius: "50%", animation: "spin 0.8s linear infinite",
    }} />
  );
}

function CheckIcon({ color = "#fff" }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M2 6L5 9L10 3" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function EmailRow({ email, checked, onToggle, trashCount, isSafe, showAccount }) {
  const name = email.sender.replace(/<[^>]+>/, "").replace(/"/g, "").trim() || extractEmail(email.sender);
  const accountLabel = email.account ? email.account.split("@")[0] : null;

  return (
    <div className="iz-card-row" onClick={onToggle} role="checkbox" aria-checked={checked}>
      <div className={`iz-check${checked ? " on-trash" : (isSafe ? " on-safe" : "")}`}>
        {checked && <CheckIcon />}
        {!checked && isSafe && <CheckIcon color="#30d158" />}
      </div>
      <div className="iz-row-info">
        <div className="iz-row-sender">{name}</div>
        <div className="iz-row-subject">{email.subject}</div>
      </div>
      <div className="iz-row-meta">
        <span className={`iz-pill iz-pill-${email.category}`}>{email.category}</span>
        {showAccount && accountLabel && <span className="iz-pill-account">{accountLabel}</span>}
        {trashCount >= AUTO_TRASH_THRESHOLD && <span style={{ fontSize: 10, color: "#ff9f0a" }}>×{trashCount}</span>}
        {isSafe && !checked && <span style={{ fontSize: 10, color: "#30d158" }}>safe</span>}
      </div>
    </div>
  );
}

// -- Main --
export default function GmailCleaner() {
  const { accounts, addAccount, removeAccount, initializing } = useGoogleAccounts();
  const [phase, setPhase] = useState("idle");
  const [emails, setEmails] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [cleanResult, setCleanResult] = useState(null);
  const [logs, setLogs] = useState([]);
  const [selectedAccounts, setSelectedAccounts] = useState([]); // which accounts to scan
  const [listingPhase, setListingPhase] = useState("idle"); // idle | processing | done
  const [listingResults, setListingResults] = useState([]);
  const [traumaPhase, setTraumaPhase] = useState("idle"); // idle | processing | done
  const [traumaResults, setTraumaResults] = useState([]);
  const logRef = useRef(null);

  const addLog = useCallback((msg) => {
    setLogs((p) => [...p, { text: msg, time: new Date().toLocaleTimeString() }]);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const IMAP_ACCOUNT = "andybot@phillyshah.com";

  // Default: all accounts selected (including IMAP)
  useEffect(() => {
    setSelectedAccounts([...accounts.map((a) => a.email), IMAP_ACCOUNT]);
  }, [accounts]);

  const toggleAccountSelection = (email) => {
    setSelectedAccounts((prev) =>
      prev.includes(email)
        ? prev.length > 1 ? prev.filter((e) => e !== email) : prev // keep at least one
        : [...prev, email]
    );
  };

  const { reviewEmails, safeEmails, listingEmails, traumaEmails, trashCountMap } = useMemo(() => {
    const prefs = loadPrefs();
    const safeSet = new Set(prefs.safe);
    const trashCounts = prefs.trash || {};
    const countMap = {};
    const safe = [], review = [], listings = [], trauma = [];
    emails.forEach((e) => {
      const addr = extractEmail(e.sender);
      countMap[e.id] = trashCounts[addr] || 0;
      const subjectLower = e.subject?.toLowerCase() || "";
      const isListing =
        addr.includes("zillow") &&
        (subjectLower.includes("new listing") || subjectLower.includes("price cut"));
      const isTrauma = subjectLower.includes("trauma dashboard") || e.category === "trauma";
      if (isTrauma) trauma.push(e);
      else if (isListing) listings.push(e);
      else if (safeSet.has(addr)) safe.push(e);
      else review.push(e);
    });
    review.sort((a, b) => (countMap[b.id] || 0) - (countMap[a.id] || 0));
    return { reviewEmails: review, safeEmails: safe, listingEmails: listings, traumaEmails: trauma, trashCountMap: countMap };
  }, [emails]);

  const handleScan = async () => {
    setPhase("scanning");
    setEmails([]);
    setCleanResult(null);
    setLogs([]);

    const toScan = accounts.filter((a) => selectedAccounts.includes(a.email));
    const all = [];

    for (const account of toScan) {
      addLog(`Scanning ${account.email}…`);
      const token = await getValidToken(account);
      if (!token) { addLog(`Skipped — token expired for ${account.email}`); continue; }
      try {
        const res = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: token }),
        });
        const result = await res.json();
        if (result.error) { addLog(`Error: ${result.error}`); continue; }
        all.push(
          ...(result.promotions || []).map((e) => ({ ...e, category: "promo", account: account.email, source: "gmail" })),
          ...(result.social || []).map((e) => ({ ...e, category: "social", account: account.email, source: "gmail" })),
        );
        addLog(`${account.email}: ${result.promotions.length} promos, ${result.social.length} social.`);
      } catch (err) {
        addLog(`Error (${account.email}): ${err.message}`);
      }
    }

    // Scan IMAP account
    if (selectedAccounts.includes(IMAP_ACCOUNT)) {
      addLog(`Scanning ${IMAP_ACCOUNT} (IMAP)…`);
      try {
        const res = await fetch("/api/scan-imap", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const result = await res.json();
        if (result.error) { addLog(`IMAP error: ${result.error}`); }
        else {
          all.push(...(result.emails || []));
          addLog(`${IMAP_ACCOUNT}: ${result.emails.length} emails.`);
        }
      } catch (err) {
        addLog(`IMAP error: ${err.message}`);
      }
    }

    const safeSet = new Set(loadPrefs().safe);
    const initSelected = new Set(all.filter((e) => !safeSet.has(extractEmail(e.sender))).map((e) => e.id));
    setEmails(all);
    setSelected(initSelected);
    setPhase("review");
  };

  const toggleEmail = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = (list) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = list.every((e) => prev.has(e.id));
      list.forEach((e) => (allOn ? next.delete(e.id) : next.add(e.id)));
      return next;
    });
  };

  const executeAction = async (action) => {
    const toAct = emails.filter((e) => selected.has(e.id));
    const toKeep = emails.filter((e) => !selected.has(e.id));
    if (toAct.length === 0) {
      applyChoices(toKeep, []);
      setCleanResult({ count: 0, kept: toKeep.length, action });
      setPhase("done");
      return;
    }

    setPhase("cleaning");
    addLog(`${action === "spam" ? "Marking spam" : "Trashing"} ${toAct.length} messages…`);

    let totalDone = 0;

    // Handle IMAP emails
    const imapEmails = toAct.filter((e) => e.source === "imap");
    if (imapEmails.length > 0) {
      const endpoint = action === "spam" ? "/api/spam-imap" : "/api/trash-imap";
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uids: imapEmails.map((e) => e.id) }),
        });
        const result = await res.json();
        totalDone += result.deleted || result.marked || imapEmails.length;
      } catch (err) {
        addLog(`IMAP error: ${err.message}`);
      }
    }

    // Handle Gmail emails
    const gmailEmails = toAct.filter((e) => e.source !== "imap");
    const byAccount = {};
    gmailEmails.forEach((e) => {
      if (!byAccount[e.account]) byAccount[e.account] = [];
      byAccount[e.account].push(e.id);
    });

    const endpoint = action === "spam" ? "/api/spam" : "/api/trash";
    for (const [accountEmail, ids] of Object.entries(byAccount)) {
      const account = accounts.find((a) => a.email === accountEmail);
      if (!account) continue;
      const token = await getValidToken(account);
      if (!token) continue;
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: token, ids }),
        });
        const result = await res.json();
        totalDone += result.deleted || result.marked || ids.length;
      } catch (err) {
        addLog(`Error (${accountEmail}): ${err.message}`);
      }
    }

    applyChoices(toKeep, toAct);
    setCleanResult({ count: totalDone, kept: toKeep.length, action });
    addLog(`Done. ${totalDone} ${action === "spam" ? "marked spam" : "trashed"}, ${toKeep.length} kept.`);
    setPhase("done");
  };

  const processListings = async () => {
    if (!listingEmails.length) return;
    setListingPhase("processing");
    addLog(`Analyzing ${listingEmails.length} Zillow listing${listingEmails.length > 1 ? "s" : ""}…`);

    const byAccount = {};
    listingEmails.forEach((e) => {
      if (!byAccount[e.account]) byAccount[e.account] = [];
      byAccount[e.account].push(e);
    });

    const allResults = [];
    for (const [accountEmail, emailBatch] of Object.entries(byAccount)) {
      const account = accounts.find((a) => a.email === accountEmail);
      if (!account) continue;
      const token = await getValidToken(account);
      if (!token) continue;
      try {
        const res = await fetch("/api/process-listings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: token, emails: emailBatch }),
        });
        const data = await res.json();
        allResults.push(...(data.results || []));
      } catch (err) {
        addLog(`Error processing listings (${accountEmail}): ${err.message}`);
      }
    }

    const notified = allResults.filter((r) => r.action === "notified").length;
    const trashed = allResults.filter((r) => r.action === "trashed").length;
    addLog(`Listings done: ${notified} matched (Telegram sent), ${trashed} trashed.`);
    setListingResults(allResults);
    setListingPhase("done");
    // Remove all processed listing emails (all Zillow emails go to trash after analysis)
    const processedIds = new Set(allResults.map((r) => r.id));
    setEmails((prev) => prev.filter((e) => !processedIds.has(e.id)));
  };

  const processTrauma = async () => {
    if (!traumaEmails.length) return;
    setTraumaPhase("processing");
    addLog(`Processing ${traumaEmails.length} trauma dashboard email${traumaEmails.length > 1 ? "s" : ""}…`);

    // Separate by source
    const imapTrauma = traumaEmails.filter((e) => e.source === "imap");
    const allResults = [];

    if (imapTrauma.length > 0) {
      try {
        const res = await fetch("/api/process-trauma", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emails: imapTrauma }),
        });
        const data = await res.json();
        allResults.push(...(data.results || []));
      } catch (err) {
        addLog(`Trauma processing error: ${err.message}`);
      }
    }

    const notified = allResults.filter((r) => r.action === "notified").length;
    const errors = allResults.filter((r) => r.action === "error").length;
    addLog(`Trauma done: ${notified} sent to Telegram${errors ? `, ${errors} errors` : ""}.`);
    setTraumaResults(allResults);
    setTraumaPhase("done");
    const processedIds = new Set(allResults.map((r) => r.id));
    setEmails((prev) => prev.filter((e) => !processedIds.has(e.id)));
  };

  const reset = () => {
    setPhase("idle");
    setEmails([]);
    setSelected(new Set());
    setCleanResult(null);
    setLogs([]);
    setListingPhase("idle");
    setListingResults([]);
    setTraumaPhase("idle");
    setTraumaResults([]);
  };

  const total = emails.length;
  const selCount = selected.size;
  const keptCount = total - selCount;
  const hasAccounts = accounts.length > 0;
  const showAccountBadge = accounts.length > 1;

  return (
    <div className="iz-wrap">
      <style>{globalCSS}</style>

      <div className="iz-container">

        {/* Header */}
        <div style={{ marginBottom: 36 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#a0a0b8", marginBottom: 8, letterSpacing: 0.3 }}>Gmail</div>
          <h1 style={{ fontSize: 36, fontWeight: 700, letterSpacing: -1, margin: "0 0 10px", lineHeight: 1.1, color: "#f0eeee" }}>
            Inbox Zero
          </h1>
          <p style={{ fontSize: 16, color: "#b0aec0", margin: 0, lineHeight: 1.6 }}>
            Scan, review, and clean up promotions &amp; social emails.
          </p>
        </div>

        {/* Account management */}
        {(hasAccounts || initializing) && phase === "idle" && (
          <div className="iz-card" style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 10px" }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#f0eeee" }}>Accounts</span>
              <button
                onClick={addAccount}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#0a84ff", fontSize: 13, fontWeight: 600, fontFamily: "inherit", padding: 0 }}
              >
                + Add
              </button>
            </div>
            {initializing && (
              <div style={{ padding: "12px 16px", fontSize: 13, color: "#8e8e93", display: "flex", gap: 8, alignItems: "center" }}>
                <Spinner color="#8e8e93" /> Connecting…
              </div>
            )}
            {accounts.map((account) => (
              <div className="iz-account-row" key={account.email}>
                <div className="iz-account-avatar">{(account.email || "?")[0].toUpperCase()}</div>
                <div className="iz-account-email">{account.email || "Connecting…"}</div>
                <button className="iz-account-remove" onClick={() => removeAccount(account.email)}>Remove</button>
              </div>
            ))}
          </div>
        )}

        {/* Account selector chips (only when multiple accounts) */}
        {phase === "idle" && !initializing && accounts.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#8e8e93", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 }}>
              Scan
            </div>
            <div className="iz-account-selector">
              {accounts.map((account) => {
                const isActive = selectedAccounts.includes(account.email);
                const label = account.email?.split("@")[0] || account.email;
                return (
                  <button key={account.email} className={`iz-account-chip${isActive ? " active" : ""}`}
                    onClick={() => toggleAccountSelection(account.email)}>
                    <span className="iz-account-chip-dot" />
                    {label}
                  </button>
                );
              })}
              {/* IMAP account chip */}
              <button
                className={`iz-account-chip${selectedAccounts.includes(IMAP_ACCOUNT) ? " active" : ""}`}
                onClick={() => toggleAccountSelection(IMAP_ACCOUNT)}
              >
                <span className="iz-account-chip-dot" style={{ background: "#ff9f0a" }} />
                andybot
              </button>
            </div>
          </div>
        )}

        {/* First-time connect */}
        {!hasAccounts && !initializing && (
          <button className="iz-btn iz-btn-google" onClick={addAccount}>
            <GoogleIcon /> Connect Gmail
          </button>
        )}

        {/* Scan button */}
        {hasAccounts && !initializing && phase === "idle" && (
          <button className="iz-btn iz-btn-primary" onClick={handleScan}>
            Scan {selectedAccounts.length > 1 ? `${selectedAccounts.length} Inboxes` : "Inbox"}
          </button>
        )}

        {(phase === "scanning" || phase === "cleaning") && (
          <button className="iz-btn iz-btn-primary" disabled>
            <Spinner /> {phase === "scanning" ? "Scanning…" : "Working…"}
          </button>
        )}

        {/* Review */}
        {phase === "review" && (
          <div style={{ animation: "slideUp 0.3s ease" }}>
            <div className="iz-stats">
              <div className="iz-stat-box">
                <div className="iz-stat-lbl">Found</div>
                <div className="iz-stat-val">{total}</div>
              </div>
              <div className="iz-stat-box">
                <div className="iz-stat-lbl">Selected</div>
                <div className="iz-stat-val" style={{ color: "#ff453a" }}>{selCount}</div>
              </div>
              <div className="iz-stat-box">
                <div className="iz-stat-lbl">Keeping</div>
                <div className="iz-stat-val" style={{ color: "#30d158" }}>{keptCount}</div>
              </div>
            </div>

            {listingEmails.length > 0 && listingPhase !== "done" && (
              <div className="iz-card" style={{ borderLeft: "3px solid #30d158" }}>
                <div className="iz-section-hdr" style={{ color: "#30d158" }}>
                  🏠 Zillow Listings — {listingEmails.length}
                </div>
                {listingEmails.map((e) => (
                  <div key={e.id} style={{ display: "flex", alignItems: "center", padding: "10px 16px", gap: 12, borderBottom: "1px solid rgba(84,84,88,0.3)" }}>
                    <div className="iz-row-info">
                      <div className="iz-row-sender">{e.subject}</div>
                      <div className="iz-row-subject">{e.sender}</div>
                    </div>
                    <span className="iz-pill iz-pill-listing">listing</span>
                  </div>
                ))}
                <div style={{ padding: "12px 16px" }}>
                  <button
                    className="iz-btn iz-btn-green"
                    onClick={processListings}
                    disabled={listingPhase === "processing"}
                    style={{ fontSize: 14 }}
                  >
                    {listingPhase === "processing" ? <><Spinner /> Analyzing…</> : `Analyze ${listingEmails.length} Listing${listingEmails.length > 1 ? "s" : ""}`}
                  </button>
                </div>
              </div>
            )}

            {traumaEmails.length > 0 && traumaPhase !== "done" && (
              <div className="iz-card" style={{ borderLeft: "3px solid #0a84ff" }}>
                <div className="iz-section-hdr" style={{ color: "#0a84ff" }}>
                  📊 Trauma Dashboard — {traumaEmails.length}
                </div>
                {traumaEmails.map((e) => (
                  <div key={e.id} style={{ display: "flex", alignItems: "center", padding: "10px 16px", gap: 12, borderBottom: "1px solid rgba(84,84,88,0.3)" }}>
                    <div className="iz-row-info">
                      <div className="iz-row-sender">{e.subject}</div>
                      <div className="iz-row-subject">{e.date ? new Date(e.date).toLocaleDateString() : e.sender}</div>
                    </div>
                    <span className="iz-pill" style={{ background: "rgba(10,132,255,0.15)", color: "#0a84ff" }}>xlsx</span>
                  </div>
                ))}
                <div style={{ padding: "12px 16px" }}>
                  <button className="iz-btn iz-btn-primary" onClick={processTrauma}
                    disabled={traumaPhase === "processing"} style={{ fontSize: 14 }}>
                    {traumaPhase === "processing" ? <><Spinner /> Processing…</> : `Process ${traumaEmails.length} Dashboard${traumaEmails.length > 1 ? "s" : ""}`}
                  </button>
                </div>
              </div>
            )}

            {traumaPhase === "done" && traumaResults.length > 0 && (
              <div className="iz-card" style={{ padding: "16px" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#0a84ff", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 }}>
                  📊 Trauma Processed
                </div>
                {traumaResults.map((r, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderBottom: "1px solid rgba(84,84,88,0.2)" }}>
                    <span style={{ fontSize: 16 }}>{r.action === "notified" ? "✅" : "❌"}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: r.action === "notified" ? "#30d158" : "#ff453a" }}>
                        {r.action === "notified" ? `${r.amount} as of ${r.date}` : r.error}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {listingPhase === "done" && listingResults.length > 0 && (
              <div className="iz-card" style={{ padding: "16px" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#30d158", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 }}>
                  🏠 Listings Processed
                </div>
                {listingResults.map((r, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderBottom: "1px solid rgba(84,84,88,0.2)" }}>
                    <span style={{ fontSize: 16 }}>{r.action === "notified" ? "✅" : "🗑️"}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: r.action === "notified" ? "#30d158" : "#8e8e93" }}>
                        {r.address || "Unknown address"}
                      </div>
                      <div style={{ fontSize: 12, color: "#636366" }}>{r.reason}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {reviewEmails.length > 0 && (
              <div className="iz-card">
                <div className="iz-section-hdr">
                  Review — {reviewEmails.length}
                  <span className="iz-section-tap" onClick={() => toggleAll(reviewEmails)}>
                    {reviewEmails.every((e) => selected.has(e.id)) ? "Deselect all" : "Select all"}
                  </span>
                </div>
                {reviewEmails.map((e) => (
                  <EmailRow key={e.id} email={e} checked={selected.has(e.id)}
                    onToggle={() => toggleEmail(e.id)} trashCount={trashCountMap[e.id] || 0}
                    showAccount={showAccountBadge} />
                ))}
              </div>
            )}

            {safeEmails.length > 0 && (
              <div className="iz-card">
                <div className="iz-section-hdr" style={{ color: "#30d158" }}>
                  Remembered Safe — {safeEmails.length}
                  <span className="iz-section-tap" onClick={() => toggleAll(safeEmails)}>
                    {safeEmails.every((e) => selected.has(e.id)) ? "Deselect all" : "Select all"}
                  </span>
                </div>
                {safeEmails.map((e) => (
                  <EmailRow key={e.id} email={e} checked={selected.has(e.id)}
                    onToggle={() => toggleEmail(e.id)} trashCount={trashCountMap[e.id] || 0}
                    isSafe showAccount={showAccountBadge} />
                ))}
              </div>
            )}

            {total === 0 && (
              <div className="iz-card" style={{ padding: "24px 20px", textAlign: "center" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: "#30d158" }}>All clean</div>
                <div style={{ fontSize: 13, color: "#8e8e93", marginTop: 4 }}>Nothing to clean up.</div>
              </div>
            )}
          </div>
        )}

        {/* Done */}
        {phase === "done" && cleanResult && (
          <div className="iz-card" style={{ padding: "24px 20px", animation: "slideUp 0.3s ease", textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>
              {cleanResult.action === "spam" ? "🚫" : "🗑️"}
            </div>
            <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>
              {cleanResult.action === "spam"
                ? `${cleanResult.count} marked as spam`
                : `${cleanResult.count} moved to trash`}
            </div>
            {cleanResult.kept > 0 && (
              <div style={{ fontSize: 13, color: "#8e8e93" }}>
                Remembered {cleanResult.kept} safe sender{cleanResult.kept !== 1 ? "s" : ""}.
              </div>
            )}
          </div>
        )}

        {/* Log */}
        {logs.length > 0 && (
          <div className="iz-card" style={{ padding: "14px 16px", marginTop: 4 }} ref={logRef}>
            {logs.map((l, i) => (
              <div key={i} className={`iz-log-entry${i === logs.length - 1 ? " active" : ""}`}>
                <span style={{ color: "#3a3a3c" }}>{l.time}</span> {l.text}
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 40, fontSize: 13, color: "#55556a", textAlign: "center" }}>v2.1</div>
      </div>

      {/* Sticky bottom bar */}
      {phase === "review" && (
        <div className="iz-sticky">
          <div className="iz-sticky-inner">
            {selCount > 0 && (
              <div style={{ display: "flex", gap: 8 }}>
                <button className="iz-btn iz-btn-orange" onClick={() => executeAction("spam")} style={{ flex: 1, fontSize: 15 }}>
                  Spam {selCount}
                </button>
                <button className="iz-btn iz-btn-red" onClick={() => executeAction("trash")} style={{ flex: 1, fontSize: 15 }}>
                  Trash {selCount}
                </button>
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              {selCount === 0 && (
                <button className="iz-btn iz-btn-green" onClick={() => executeAction("trash")} style={{ flex: 1, fontSize: 15 }}>
                  Keep All
                </button>
              )}
              <button className="iz-btn iz-btn-secondary" onClick={reset} style={{ flex: selCount === 0 ? "0 0 90px" : 1, fontSize: 15 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === "done" && (
        <div className="iz-sticky">
          <div className="iz-sticky-inner">
            <button className="iz-btn iz-btn-primary" onClick={reset}>Scan Again</button>
          </div>
        </div>
      )}
    </div>
  );
}
