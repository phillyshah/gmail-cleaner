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
    background: #000;
    color: #fff;
    font-family: -apple-system, 'SF Pro Display', 'Inter', sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .iz-container {
    max-width: 430px;
    margin: 0 auto;
    padding: 60px 20px 160px;
  }
  @media (min-width: 600px) {
    .iz-container { padding: 80px 24px 180px; }
  }

  .iz-card { background: #1c1c1e; border-radius: 16px; overflow: hidden; margin-bottom: 12px; }

  .iz-card-row {
    display: flex; align-items: center;
    padding: 14px 16px; gap: 12px;
    border-bottom: 1px solid rgba(84,84,88,0.3);
    min-height: 52px; cursor: pointer;
    transition: background 0.1s ease; user-select: none;
  }
  .iz-card-row:last-child { border-bottom: none; }
  .iz-card-row:active { background: rgba(255,255,255,0.05); }

  .iz-check {
    width: 24px; height: 24px; flex-shrink: 0;
    border-radius: 50%; border: 2px solid rgba(255,255,255,0.2);
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s ease;
  }
  .iz-check.on-trash { background: #ff453a; border-color: #ff453a; }
  .iz-check.on-safe  { border-color: rgba(48,209,88,0.4); }

  .iz-row-info { flex: 1; min-width: 0; }
  .iz-row-sender { font-size: 14px; font-weight: 500; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px; }
  .iz-row-subject { font-size: 12px; color: #8e8e93; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .iz-row-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; flex-shrink: 0; }

  .iz-pill { font-size: 10px; font-weight: 600; letter-spacing: 0.3px; padding: 3px 8px; border-radius: 20px; text-transform: uppercase; }
  .iz-pill-promo  { background: rgba(255,159,10,0.15); color: #ff9f0a; }
  .iz-pill-social { background: rgba(10,132,255,0.15); color: #0a84ff; }
  .iz-pill-account { font-size: 9px; font-weight: 500; padding: 2px 6px; border-radius: 20px; background: rgba(255,255,255,0.07); color: #636366; max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .iz-section-hdr {
    padding: 10px 16px 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.5px;
    text-transform: uppercase; color: #8e8e93;
    display: flex; justify-content: space-between; align-items: center;
  }
  .iz-section-tap { font-size: 11px; font-weight: 500; color: #0a84ff; cursor: pointer; letter-spacing: 0; text-transform: none; }
  .iz-section-tap:hover { opacity: 0.7; }

  .iz-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }
  .iz-stat-box { background: #1c1c1e; border-radius: 14px; padding: 14px 12px; }
  .iz-stat-lbl { font-size: 11px; font-weight: 500; color: #8e8e93; margin-bottom: 4px; }
  .iz-stat-val { font-size: 26px; font-weight: 700; letter-spacing: -0.5px; }

  .iz-btn {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    width: 100%; border: none; cursor: pointer;
    font-family: -apple-system, 'SF Pro Display', 'Inter', sans-serif;
    font-size: 16px; font-weight: 600; letter-spacing: -0.2px;
    border-radius: 14px; padding: 16px 24px;
    transition: opacity 0.15s ease, transform 0.1s ease;
    -webkit-font-smoothing: antialiased;
  }
  .iz-btn:hover:not(:disabled) { opacity: 0.88; }
  .iz-btn:active:not(:disabled) { transform: scale(0.98); opacity: 0.75; }
  .iz-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .iz-btn-primary   { background: #0a84ff; color: #fff; }
  .iz-btn-red       { background: #ff453a; color: #fff; }
  .iz-btn-orange    { background: #ff9f0a; color: #fff; }
  .iz-btn-green     { background: #30d158; color: #fff; }
  .iz-btn-secondary { background: #2c2c2e; color: #fff; }
  .iz-btn-google    { background: #fff; color: #000; }
  .iz-btn-google:hover:not(:disabled) { background: #f5f5f7 !important; }

  /* Account selector */
  .iz-account-selector {
    display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px;
  }
  .iz-account-chip {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 14px; border-radius: 20px; cursor: pointer;
    font-size: 13px; font-weight: 500; font-family: inherit;
    border: 1.5px solid rgba(84,84,88,0.4);
    background: transparent; color: #8e8e93;
    transition: all 0.15s ease; user-select: none;
  }
  .iz-account-chip.active { background: #0a84ff; border-color: #0a84ff; color: #fff; }
  .iz-account-chip:active { transform: scale(0.97); }
  .iz-account-chip-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; }

  /* Account management */
  .iz-account-row { display: flex; align-items: center; padding: 12px 16px; gap: 12px; border-bottom: 1px solid rgba(84,84,88,0.3); }
  .iz-account-row:last-child { border-bottom: none; }
  .iz-account-avatar { width: 32px; height: 32px; border-radius: 50%; background: #2c2c2e; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; color: #0a84ff; flex-shrink: 0; }
  .iz-account-email { flex: 1; font-size: 14px; color: #fff; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .iz-account-remove { background: none; border: none; cursor: pointer; color: #ff453a; font-size: 13px; font-weight: 500; font-family: inherit; padding: 4px 8px; border-radius: 8px; }
  .iz-account-remove:hover { background: rgba(255,69,58,0.1); }

  .iz-log-entry { font-size: 12px; color: #8e8e93; line-height: 1.9; }
  .iz-log-entry.active { color: #0a84ff; }

  .iz-sticky {
    position: fixed; bottom: 0; left: 0; right: 0; z-index: 100;
    background: rgba(0,0,0,0.85);
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    border-top: 1px solid rgba(84,84,88,0.3);
    padding: 12px 20px max(env(safe-area-inset-bottom), 16px);
  }
  .iz-sticky-inner { max-width: 430px; margin: 0 auto; display: flex; flex-direction: column; gap: 8px; }
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
  const logRef = useRef(null);

  const addLog = useCallback((msg) => {
    setLogs((p) => [...p, { text: msg, time: new Date().toLocaleTimeString() }]);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // Default: all accounts selected
  useEffect(() => {
    setSelectedAccounts(accounts.map((a) => a.email));
  }, [accounts]);

  const toggleAccountSelection = (email) => {
    setSelectedAccounts((prev) =>
      prev.includes(email)
        ? prev.length > 1 ? prev.filter((e) => e !== email) : prev // keep at least one
        : [...prev, email]
    );
  };

  const { reviewEmails, safeEmails, trashCountMap } = useMemo(() => {
    const prefs = loadPrefs();
    const safeSet = new Set(prefs.safe);
    const trashCounts = prefs.trash || {};
    const countMap = {};
    const safe = [], review = [];
    emails.forEach((e) => {
      const addr = extractEmail(e.sender);
      countMap[e.id] = trashCounts[addr] || 0;
      if (safeSet.has(addr)) safe.push(e);
      else review.push(e);
    });
    review.sort((a, b) => (countMap[b.id] || 0) - (countMap[a.id] || 0));
    return { reviewEmails: review, safeEmails: safe, trashCountMap: countMap };
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
          ...(result.promotions || []).map((e) => ({ ...e, category: "promo", account: account.email })),
          ...(result.social || []).map((e) => ({ ...e, category: "social", account: account.email })),
        );
        addLog(`${account.email}: ${result.promotions.length} promos, ${result.social.length} social.`);
      } catch (err) {
        addLog(`Error (${account.email}): ${err.message}`);
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

    const byAccount = {};
    toAct.forEach((e) => {
      if (!byAccount[e.account]) byAccount[e.account] = [];
      byAccount[e.account].push(e.id);
    });

    let totalDone = 0;
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

  const reset = () => {
    setPhase("idle");
    setEmails([]);
    setSelected(new Set());
    setCleanResult(null);
    setLogs([]);
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
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "#8e8e93", marginBottom: 6 }}>Gmail</div>
          <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: -1, margin: "0 0 8px", lineHeight: 1.1 }}>
            Inbox Zero
          </h1>
          <p style={{ fontSize: 15, color: "#8e8e93", margin: 0, lineHeight: 1.5 }}>
            Scan, review, and clean up promotions &amp; social emails.
          </p>
        </div>

        {/* Account management */}
        {(hasAccounts || initializing) && phase === "idle" && (
          <div className="iz-card" style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 10px" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>Accounts</span>
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
        {accounts.length > 1 && phase === "idle" && !initializing && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#8e8e93", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 }}>
              Scan
            </div>
            <div className="iz-account-selector">
              {accounts.map((account) => {
                const isActive = selectedAccounts.includes(account.email);
                const label = account.email?.split("@")[0] || account.email;
                return (
                  <button
                    key={account.email}
                    className={`iz-account-chip${isActive ? " active" : ""}`}
                    onClick={() => toggleAccountSelection(account.email)}
                  >
                    <span className="iz-account-chip-dot" />
                    {label}
                  </button>
                );
              })}
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

        <div style={{ marginTop: 40, fontSize: 12, color: "#3a3a3c", textAlign: "center" }}>v2.0</div>
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
