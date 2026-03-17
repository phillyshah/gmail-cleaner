import { useState, useCallback, useRef, useEffect, useMemo } from "react";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES = "https://www.googleapis.com/auth/gmail.modify";
const PREFS_KEY = "inbox-zero-prefs";
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

// -- Token cache (avoids re-auth on every visit) --
const TOKEN_CACHE_KEY = "gmail_token_cache";

function getCachedToken() {
  try {
    const d = JSON.parse(localStorage.getItem(TOKEN_CACHE_KEY) || "{}");
    // Keep using token if it has more than 2 minutes left
    if (d.token && d.expiresAt && d.expiresAt > Date.now() + 120_000) return d.token;
  } catch {}
  return null;
}

function cacheToken(token, expiresIn = 3600) {
  localStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify({
    token,
    expiresAt: Date.now() + expiresIn * 1000,
  }));
}

function clearTokenCache() {
  localStorage.removeItem(TOKEN_CACHE_KEY);
  localStorage.removeItem("gmail_connected");
}

// -- Google OAuth --
function useGoogleAuth() {
  const [accessToken, setAccessToken] = useState(() => getCachedToken());
  const clientRef = useRef(null);

  useEffect(() => {
    // Token already loaded from cache — no need to touch Google
    if (getCachedToken()) return;

    const interval = setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        clearInterval(interval);
        clientRef.current = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: SCOPES,
          callback: (response) => {
            if (response.access_token) {
              cacheToken(response.access_token, response.expires_in);
              localStorage.setItem("gmail_connected", "1");
              setAccessToken(response.access_token);
            }
          },
          error_callback: () => {},
        });
      }
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const signIn = () => clientRef.current?.requestAccessToken({ prompt: "select_account" });
  const signOut = () => {
    if (accessToken) window.google.accounts.oauth2.revoke(accessToken);
    clearTokenCache();
    setAccessToken(null);
  };

  return { accessToken, signIn, signOut };
}

// -- Global CSS (Apple design language) --
const globalCSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
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

  /* Cards */
  .iz-card {
    background: #1c1c1e;
    border-radius: 16px;
    overflow: hidden;
    margin-bottom: 12px;
  }

  .iz-card-row {
    display: flex;
    align-items: center;
    padding: 14px 16px;
    gap: 12px;
    border-bottom: 1px solid rgba(84,84,88,0.3);
    min-height: 52px;
    cursor: pointer;
    transition: background 0.1s ease;
    user-select: none;
  }
  .iz-card-row:last-child { border-bottom: none; }
  .iz-card-row:active { background: rgba(255,255,255,0.05); }

  /* Checkbox */
  .iz-check {
    width: 24px; height: 24px; flex-shrink: 0;
    border-radius: 50%;
    border: 2px solid rgba(255,255,255,0.2);
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s ease;
  }
  .iz-check.on-trash { background: #ff453a; border-color: #ff453a; }
  .iz-check.on-spam  { background: #ff9f0a; border-color: #ff9f0a; }
  .iz-check.on-safe  { border-color: rgba(48,209,88,0.4); }

  /* Email info */
  .iz-row-info { flex: 1; min-width: 0; }
  .iz-row-sender {
    font-size: 14px; font-weight: 500; color: #fff;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    margin-bottom: 2px;
  }
  .iz-row-subject {
    font-size: 12px; color: #8e8e93;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  /* Pill badges */
  .iz-pill {
    font-size: 10px; font-weight: 600; letter-spacing: 0.3px;
    padding: 3px 8px; border-radius: 20px; flex-shrink: 0;
    text-transform: uppercase;
  }
  .iz-pill-promo  { background: rgba(255,159,10,0.15); color: #ff9f0a; }
  .iz-pill-social { background: rgba(10,132,255,0.15); color: #0a84ff; }

  /* Section header inside card */
  .iz-section-hdr {
    padding: 10px 16px 6px;
    font-size: 11px; font-weight: 600; letter-spacing: 0.5px;
    text-transform: uppercase; color: #8e8e93;
    display: flex; justify-content: space-between; align-items: center;
  }
  .iz-section-tap {
    font-size: 11px; font-weight: 500; color: #0a84ff;
    cursor: pointer; letter-spacing: 0;
    text-transform: none;
  }
  .iz-section-tap:hover { opacity: 0.7; }

  /* Stat row */
  .iz-stats {
    display: grid; grid-template-columns: repeat(3, 1fr);
    gap: 10px; margin-bottom: 16px;
  }
  .iz-stat-box {
    background: #1c1c1e; border-radius: 14px;
    padding: 14px 12px;
  }
  .iz-stat-lbl {
    font-size: 11px; font-weight: 500; color: #8e8e93;
    margin-bottom: 4px; letter-spacing: 0.2px;
  }
  .iz-stat-val {
    font-size: 26px; font-weight: 700; letter-spacing: -0.5px;
  }

  /* Buttons */
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

  .iz-btn-primary { background: #0a84ff; color: #fff; }
  .iz-btn-red     { background: #ff453a; color: #fff; }
  .iz-btn-orange  { background: #ff9f0a; color: #fff; }
  .iz-btn-green   { background: #30d158; color: #fff; }
  .iz-btn-secondary { background: #2c2c2e; color: #fff; }
  .iz-btn-google  { background: #fff; color: #000; }
  .iz-btn-google:hover:not(:disabled) { background: #f5f5f7 !important; }

  /* Log */
  .iz-log-entry { font-size: 12px; color: #8e8e93; line-height: 1.9; }
  .iz-log-entry.active { color: #0a84ff; }

  /* Sticky bar */
  .iz-sticky {
    position: fixed; bottom: 0; left: 0; right: 0;
    z-index: 100;
    background: rgba(0,0,0,0.85);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-top: 1px solid rgba(84,84,88,0.3);
    padding: 12px 20px max(env(safe-area-inset-bottom), 16px);
  }
  .iz-sticky-inner {
    max-width: 430px; margin: 0 auto;
    display: flex; flex-direction: column; gap: 8px;
  }

  /* Status dot */
  .iz-dot {
    width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
    display: inline-block;
  }
`;

// -- Subcomponents --
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
      border: `2px solid rgba(255,255,255,0.2)`, borderTopColor: color,
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

function EmailRow({ email, checked, onToggle, trashCount, isSafe }) {
  const isFrequent = trashCount >= AUTO_TRASH_THRESHOLD;
  const name = email.sender.replace(/<[^>]+>/, "").replace(/"/g, "").trim() || extractEmail(email.sender);

  return (
    <div className="iz-card-row" onClick={onToggle} role="checkbox" aria-checked={checked}>
      <div className={`iz-check${checked ? (isSafe ? " on-safe" : " on-trash") : (isSafe ? " on-safe" : "")}`}>
        {checked && <CheckIcon color={isSafe ? "#30d158" : "#fff"} />}
      </div>
      <div className="iz-row-info">
        <div className="iz-row-sender">{name}</div>
        <div className="iz-row-subject">{email.subject}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
        <span className={`iz-pill iz-pill-${email.category}`}>{email.category}</span>
        {isFrequent && <span style={{ fontSize: 10, color: "#ff9f0a" }}>×{trashCount}</span>}
        {isSafe && !checked && <span style={{ fontSize: 10, color: "#30d158" }}>safe</span>}
      </div>
    </div>
  );
}

// -- Main --
export default function GmailCleaner() {
  const { accessToken, signIn, signOut } = useGoogleAuth();
  const [phase, setPhase] = useState("idle");
  const [emails, setEmails] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [cleanResult, setCleanResult] = useState(null);
  const [logs, setLogs] = useState([]);
  const logRef = useRef(null);

  const addLog = useCallback((msg) => {
    setLogs((p) => [...p, { text: msg, time: new Date().toLocaleTimeString() }]);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

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
    addLog("Scanning Gmail...");
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken }),
      });
      const result = await res.json();
      if (result.error) { addLog(`Error: ${result.error}`); setPhase("idle"); return; }

      const all = [
        ...(result.promotions || []).map((e) => ({ ...e, category: "promo" })),
        ...(result.social || []).map((e) => ({ ...e, category: "social" })),
      ];

      const safeSet = new Set(loadPrefs().safe);
      const initSelected = new Set(all.filter((e) => !safeSet.has(extractEmail(e.sender))).map((e) => e.id));

      setEmails(all);
      setSelected(initSelected);
      addLog(`Found ${result.promotions.length} promos, ${result.social.length} social.`);
      setPhase("review");
    } catch (err) {
      addLog(`Error: ${err.message}`);
      setPhase("idle");
    }
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

  const handleClean = async () => {
    const toTrash = emails.filter((e) => selected.has(e.id));
    const toKeep = emails.filter((e) => !selected.has(e.id));
    if (toTrash.length === 0) {
      applyChoices(toKeep, []);
      setCleanResult({ count: 0, kept: toKeep.length, action: "trash" });
      addLog("Nothing to trash — choices saved.");
      setPhase("done");
      return;
    }
    setPhase("cleaning");
    addLog(`Trashing ${toTrash.length} messages...`);
    try {
      const res = await fetch("/api/trash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, ids: toTrash.map((e) => e.id) }),
      });
      const result = await res.json();
      applyChoices(toKeep, toTrash);
      setCleanResult({ count: result.deleted, kept: toKeep.length, action: "trash" });
      addLog(`Done. ${result.deleted} trashed, ${toKeep.length} kept.`);
      setPhase("done");
    } catch (err) {
      addLog(`Error: ${err.message}`);
      setPhase("review");
    }
  };

  const handleSpam = async () => {
    const toSpam = emails.filter((e) => selected.has(e.id));
    const toKeep = emails.filter((e) => !selected.has(e.id));
    if (toSpam.length === 0) return;
    setPhase("cleaning");
    addLog(`Marking ${toSpam.length} as spam...`);
    try {
      const res = await fetch("/api/spam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, ids: toSpam.map((e) => e.id) }),
      });
      const result = await res.json();
      applyChoices(toKeep, toSpam);
      setCleanResult({ count: result.marked, kept: toKeep.length, action: "spam" });
      addLog(`Done. ${result.marked} marked as spam.`);
      setPhase("done");
    } catch (err) {
      addLog(`Error: ${err.message}`);
      setPhase("review");
    }
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

  return (
    <div className="iz-wrap">
      <style>{globalCSS}</style>

      <div className="iz-container">

        {/* Header */}
        <div style={{ marginBottom: 36 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "#8e8e93", marginBottom: 6, letterSpacing: 0.2 }}>
            Gmail
          </div>
          <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: -1, margin: "0 0 8px", lineHeight: 1.1 }}>
            Inbox Zero
          </h1>
          <p style={{ fontSize: 15, color: "#8e8e93", margin: 0, lineHeight: 1.5 }}>
            Scan, review, and clean up promotions & social emails.
          </p>
        </div>

        {/* Auth status bar */}
        {accessToken && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, fontSize: 13, color: "#8e8e93" }}>
            <span className="iz-dot" style={{ background: "#30d158" }} />
            Gmail connected
            <button
              onClick={signOut}
              style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#0a84ff", fontSize: 13, fontWeight: 500, fontFamily: "inherit", padding: 0 }}
            >
              Sign out
            </button>
          </div>
        )}

        {/* Connect / scanning / scan */}
        {!accessToken && !autoConnecting && (
          <button className="iz-btn iz-btn-google" onClick={signIn}>
            <GoogleIcon /> Sign in with Google
          </button>
        )}

        {accessToken && phase === "idle" && (
          <button className="iz-btn iz-btn-primary" onClick={handleScan}>
            Scan Inbox
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

            {/* Stats */}
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

            {/* Review emails */}
            {reviewEmails.length > 0 && (
              <div className="iz-card">
                <div className="iz-section-hdr">
                  Review — {reviewEmails.length}
                  <span className="iz-section-tap" onClick={() => toggleAll(reviewEmails)}>
                    {reviewEmails.every((e) => selected.has(e.id)) ? "Deselect all" : "Select all"}
                  </span>
                </div>
                {reviewEmails.map((e) => (
                  <EmailRow
                    key={e.id}
                    email={e}
                    checked={selected.has(e.id)}
                    onToggle={() => toggleEmail(e.id)}
                    trashCount={trashCountMap[e.id] || 0}
                  />
                ))}
              </div>
            )}

            {/* Safe senders */}
            {safeEmails.length > 0 && (
              <div className="iz-card">
                <div className="iz-section-hdr" style={{ color: "#30d158" }}>
                  Remembered Safe — {safeEmails.length}
                  <span className="iz-section-tap" onClick={() => toggleAll(safeEmails)}>
                    {safeEmails.every((e) => selected.has(e.id)) ? "Deselect all" : "Select all"}
                  </span>
                </div>
                {safeEmails.map((e) => (
                  <EmailRow
                    key={e.id}
                    email={e}
                    checked={selected.has(e.id)}
                    onToggle={() => toggleEmail(e.id)}
                    trashCount={trashCountMap[e.id] || 0}
                    isSafe
                  />
                ))}
              </div>
            )}

            {total === 0 && (
              <div className="iz-card" style={{ padding: "24px 20px", textAlign: "center" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: "#30d158" }}>Inbox is clean</div>
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

        {/* Activity log */}
        {logs.length > 0 && (
          <div className="iz-card" style={{ padding: "14px 16px", marginTop: 4 }} ref={logRef}>
            {logs.map((l, i) => (
              <div key={i} className={`iz-log-entry${i === logs.length - 1 ? " active" : ""}`}>
                <span style={{ color: "#3a3a3c" }}>{l.time}</span> {l.text}
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 40, fontSize: 12, color: "#3a3a3c", textAlign: "center" }}>
          v1.01
        </div>
      </div>

      {/* Sticky bottom bar */}
      {phase === "review" && (
        <div className="iz-sticky">
          <div className="iz-sticky-inner">
            {selCount > 0 && (
              <div style={{ display: "flex", gap: 8 }}>
                <button className="iz-btn iz-btn-orange" onClick={handleSpam} style={{ flex: 1, fontSize: 15 }}>
                  Spam {selCount}
                </button>
                <button className="iz-btn iz-btn-red" onClick={handleClean} style={{ flex: 1, fontSize: 15 }}>
                  Trash {selCount}
                </button>
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              {selCount === 0 && (
                <button className="iz-btn iz-btn-green" onClick={handleClean} style={{ flex: 1, fontSize: 15 }}>
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
            <button className="iz-btn iz-btn-primary" onClick={reset}>
              Scan Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
