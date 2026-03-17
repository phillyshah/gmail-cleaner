import { useState, useCallback, useRef, useEffect, useMemo } from "react";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES = "https://www.googleapis.com/auth/gmail.modify";
const PREFS_KEY = "inbox-zero-prefs";
const ACCOUNTS_KEY = "gmail_accounts";
const AUTO_TRASH_THRESHOLD = 3;
const IMAP_ACCOUNT = "andybot@phillyshah.com";

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
    return data.access_token || null;
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

// -- Icons --
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
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [listingPhase, setListingPhase] = useState("idle");
  const [listingResults, setListingResults] = useState([]);
  const [traumaPhase, setTraumaPhase] = useState("idle");
  const [traumaResults, setTraumaResults] = useState([]);
  const logRef = useRef(null);

  const addLog = useCallback((msg) => {
    setLogs((p) => [...p, { text: msg, time: new Date().toLocaleTimeString() }]);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    setSelectedAccounts([...accounts.map((a) => a.email), IMAP_ACCOUNT]);
  }, [accounts]);

  const toggleAccountSelection = (email) => {
    setSelectedAccounts((prev) =>
      prev.includes(email)
        ? prev.length > 1 ? prev.filter((e) => e !== email) : prev
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
    const scanImap = selectedAccounts.includes(IMAP_ACCOUNT);

    // Scan all accounts + IMAP in parallel
    const scanPromises = toScan.map(async (account) => {
      addLog(`Scanning ${account.email}…`);
      const token = await getValidToken(account);
      if (!token) { addLog(`Skipped — token expired for ${account.email}`); return []; }
      try {
        const res = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: token }),
        });
        const result = await res.json();
        if (result.error) { addLog(`Error: ${result.error}`); return []; }
        addLog(`${account.email}: ${result.promotions.length} promos, ${result.social.length} social.`);
        return [
          ...(result.promotions || []).map((e) => ({ ...e, category: "promo", account: account.email, source: "gmail" })),
          ...(result.social || []).map((e) => ({ ...e, category: "social", account: account.email, source: "gmail" })),
        ];
      } catch (err) {
        addLog(`Error (${account.email}): ${err.message}`);
        return [];
      }
    });

    if (scanImap) {
      addLog(`Scanning ${IMAP_ACCOUNT} (IMAP)…`);
      scanPromises.push(
        fetch("/api/scan-imap", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
          .then((r) => r.json())
          .then((result) => {
            if (result.error) { addLog(`IMAP error: ${result.error}`); return []; }
            addLog(`${IMAP_ACCOUNT}: ${result.emails.length} emails.`);
            return result.emails || [];
          })
          .catch((err) => { addLog(`IMAP error: ${err.message}`); return []; })
      );
    }

    const results = await Promise.all(scanPromises);
    const all = results.flat();

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
    const imapEmails = toAct.filter((e) => e.source === "imap");
    const gmailEmails = toAct.filter((e) => e.source !== "imap");

    // Process IMAP and Gmail in parallel
    const promises = [];

    if (imapEmails.length > 0) {
      const endpoint = action === "spam" ? "/api/spam-imap" : "/api/trash-imap";
      promises.push(
        fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uids: imapEmails.map((e) => e.id) }),
        })
          .then((r) => r.json())
          .then((result) => { totalDone += result.deleted || result.marked || imapEmails.length; })
          .catch((err) => addLog(`IMAP error: ${err.message}`))
      );
    }

    const byAccount = {};
    gmailEmails.forEach((e) => {
      if (!byAccount[e.account]) byAccount[e.account] = [];
      byAccount[e.account].push(e.id);
    });

    const gmailEndpoint = action === "spam" ? "/api/spam" : "/api/trash";
    for (const [accountEmail, ids] of Object.entries(byAccount)) {
      const account = accounts.find((a) => a.email === accountEmail);
      if (!account) continue;
      promises.push(
        (async () => {
          const token = await getValidToken(account);
          if (!token) return;
          try {
            const res = await fetch(gmailEndpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ accessToken: token, ids }),
            });
            const result = await res.json();
            totalDone += result.deleted || result.marked || ids.length;
          } catch (err) {
            addLog(`Error (${accountEmail}): ${err.message}`);
          }
        })()
      );
    }

    await Promise.all(promises);
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
    const processedIds = new Set(allResults.map((r) => r.id));
    setEmails((prev) => prev.filter((e) => !processedIds.has(e.id)));
  };

  const processTrauma = async () => {
    if (!traumaEmails.length) return;
    setTraumaPhase("processing");
    addLog(`Processing ${traumaEmails.length} trauma dashboard email${traumaEmails.length > 1 ? "s" : ""}…`);

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

        {/* Account selector chips */}
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
                  Zillow Listings — {listingEmails.length}
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
                  Trauma Dashboard — {traumaEmails.length}
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
                  Trauma Processed
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
                  Listings Processed
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

        <div style={{ marginTop: 40, fontSize: 13, color: "#55556a", textAlign: "center" }}>v1.0</div>
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
