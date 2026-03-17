import { useState, useCallback, useRef, useEffect, useMemo } from "react";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES = "https://www.googleapis.com/auth/gmail.modify";
const PREFS_KEY = "inbox-zero-prefs";
const AUTO_TRASH_THRESHOLD = 3;

// -- Prefs (localStorage learning) --
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

// -- Google OAuth --
function useGoogleAuth() {
  const [accessToken, setAccessToken] = useState(null);
  const clientRef = useRef(null);

  useEffect(() => {
    const interval = setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        clearInterval(interval);
        clientRef.current = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: SCOPES,
          callback: (response) => {
            if (response.access_token) setAccessToken(response.access_token);
          },
        });
      }
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const signIn = () => clientRef.current?.requestAccessToken();
  const signOut = () => {
    if (accessToken) window.google.accounts.oauth2.revoke(accessToken);
    setAccessToken(null);
  };

  return { accessToken, signIn, signOut };
}

// -- Global CSS --
const globalCSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Space+Grotesk:wght@700&display=swap');
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

  *, *::before, *::after { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }

  .iz-wrap {
    min-height: 100vh;
    background: #0a0a0a;
    color: #e8e4de;
    font-family: 'JetBrains Mono', 'SF Mono', monospace;
  }

  .iz-container {
    max-width: 680px;
    margin: 0 auto;
    padding: 28px 16px 120px;
    position: relative;
    z-index: 1;
  }
  @media (min-width: 600px) {
    .iz-container { padding: 48px 24px 140px; }
  }

  .iz-grain {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    opacity: 0.03; pointer-events: none; z-index: 0;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  }

  .iz-btn {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    width: 100%; min-height: 52px;
    background: #ff4d00; color: #0a0a0a;
    border: none; padding: 14px 24px;
    font-size: 11px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase;
    cursor: pointer; font-family: 'JetBrains Mono', monospace;
    transition: background 0.15s ease, color 0.15s ease;
  }
  .iz-btn:hover:not(:disabled) { background: #ff6a2a; }
  .iz-btn:active:not(:disabled) { background: #e04400; }
  .iz-btn:disabled { background: #222; color: #555; cursor: not-allowed; }
  .iz-btn-google { background: #fff; color: #111; }
  .iz-btn-google:hover { background: #f0f0f0 !important; }
  .iz-btn-outline { background: transparent; color: #ff4d00; border: 1px solid #ff4d00; }
  .iz-btn-outline:hover:not(:disabled) { background: #ff4d00 !important; color: #0a0a0a !important; }
  .iz-btn-ghost { background: #1a1a1a; color: #666; }
  .iz-btn-ghost:hover:not(:disabled) { color: #999 !important; background: #1a1a1a !important; }
  .iz-btn-success { background: #0d1a00; color: #8aff42; border: 1px solid #1a2e00; }
  .iz-btn-success:hover:not(:disabled) { background: #122200 !important; }

  .iz-card {
    background: #111; border: 1px solid #1e1e1e;
    padding: 16px; margin-bottom: 12px;
  }
  @media (min-width: 600px) { .iz-card { padding: 20px 24px; } }

  .iz-card-label {
    font-size: 10px; letter-spacing: 3px; text-transform: uppercase;
    color: #ff4d00; display: block; margin-bottom: 12px;
  }

  .iz-email-row {
    display: flex; align-items: center;
    padding: 10px 0; border-bottom: 1px solid #151515;
    gap: 12px; min-height: 52px;
    cursor: pointer; user-select: none;
    transition: background 0.1s ease;
  }
  .iz-email-row:last-child { border-bottom: none; }
  .iz-email-row:active { background: #141414; margin: 0 -16px; padding: 10px 16px; }

  .iz-checkbox {
    width: 22px; height: 22px; flex-shrink: 0;
    border: 2px solid #333; border-radius: 3px;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s ease;
  }
  .iz-checkbox.checked { background: #ff4d00; border-color: #ff4d00; }
  .iz-checkbox.safe { border-color: #1a4000; }

  .iz-email-info { flex: 1; min-width: 0; }
  .iz-email-sender {
    font-size: 12px; color: #888;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    margin-bottom: 2px;
  }
  .iz-email-subject {
    font-size: 11px; color: #555;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  .iz-stats {
    display: grid; grid-template-columns: repeat(3, 1fr);
    gap: 8px; margin-bottom: 16px;
  }
  .iz-stat-box {
    background: #111; border: 1px solid #1e1e1e;
    padding: 12px;
  }
  .iz-stat-label {
    font-size: 9px; letter-spacing: 2px; text-transform: uppercase;
    color: #555; margin-bottom: 4px; display: block;
  }
  .iz-stat-value {
    font-size: 24px; font-weight: 700; font-family: 'Space Grotesk', sans-serif;
  }

  .iz-select-all {
    font-size: 10px; letter-spacing: 2px; text-transform: uppercase;
    color: #444; cursor: pointer; padding: 4px 0;
    transition: color 0.15s;
  }
  .iz-select-all:hover { color: #888; }

  .iz-sticky {
    position: fixed; bottom: 0; left: 0; right: 0;
    background: #0a0a0a; border-top: 1px solid #1e1e1e;
    padding: 14px 16px;
    z-index: 100;
  }
  .iz-sticky-inner {
    max-width: 680px; margin: 0 auto;
    display: flex; gap: 10px;
  }

  .iz-log-line { color: #444; transition: color 0.3s ease; line-height: 1.8; }
  .iz-log-line.active { color: #ff4d00; }

  .iz-badge {
    font-size: 9px; padding: 2px 6px; letter-spacing: 1px;
    text-transform: uppercase; flex-shrink: 0;
  }
  .iz-badge-promo { background: #1a0f00; color: #ff8c42; border: 1px solid #2a1800; }
  .iz-badge-social { background: #0f0f1a; color: #6b8afd; border: 1px solid #1a1a2e; }

  .iz-section-row {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 8px;
  }
`;

// -- Components --
function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

function Spinner() {
  return (
    <span style={{
      display: "inline-block", width: 14, height: 14,
      border: "2px solid #444", borderTopColor: "#ff4d00",
      borderRadius: "50%", animation: "spin 0.8s linear infinite",
    }} />
  );
}

function EmailRow({ email, checked, onToggle, trashCount, isSafe }) {
  const isFrequent = trashCount >= AUTO_TRASH_THRESHOLD;
  const displayName = email.sender.replace(/<[^>]+>/, "").trim() || email.sender;

  return (
    <div className="iz-email-row" onClick={onToggle} role="checkbox" aria-checked={checked}>
      <div className={`iz-checkbox${checked ? " checked" : ""}${isSafe ? " safe" : ""}`}>
        {checked && (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M2 6L5 9L10 3" stroke="#0a0a0a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </div>
      <div className="iz-email-info">
        <div className="iz-email-sender">{displayName}</div>
        <div className="iz-email-subject">{email.subject}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
        <span className={`iz-badge iz-badge-${email.category}`}>{email.category}</span>
        {isFrequent && <span style={{ fontSize: 9, color: "#ff6a2a", letterSpacing: 1 }}>×{trashCount}</span>}
        {isSafe && <span style={{ fontSize: 9, color: "#3a8000", letterSpacing: 1 }}>safe</span>}
      </div>
    </div>
  );
}

// -- Main --
export default function GmailCleaner() {
  const { accessToken, signIn, signOut } = useGoogleAuth();
  const [phase, setPhase] = useState("idle"); // idle | scanning | review | cleaning | done
  const [emails, setEmails] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [cleanResult, setCleanResult] = useState(null);
  const [logs, setLogs] = useState([]);
  const logRef = useRef(null);

  const addLog = useCallback((msg) => {
    setLogs((prev) => [...prev, { text: msg, time: new Date().toLocaleTimeString() }]);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // Group emails using saved prefs
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

    // Sort: frequent-trash first, then unknown
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
      if (result.error) {
        addLog(`Error: ${result.error}`);
        setPhase("idle");
        return;
      }

      const all = [
        ...(result.promotions || []).map((e) => ({ ...e, category: "promo" })),
        ...(result.social || []).map((e) => ({ ...e, category: "social" })),
      ];

      const prefs = loadPrefs();
      const safeSet = new Set(prefs.safe);
      const initSelected = new Set(
        all.filter((e) => !safeSet.has(extractEmail(e.sender))).map((e) => e.id)
      );

      setEmails(all);
      setSelected(initSelected);
      addLog(`Found ${result.promotions.length} promos, ${result.social.length} social. Tap to review.`);
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

  const toggleAll = (emailList, forceState) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = emailList.every((e) => prev.has(e.id));
      emailList.forEach((e) => {
        if (forceState !== undefined ? forceState : allOn) next.delete(e.id);
        else next.add(e.id);
      });
      return next;
    });
  };

  const handleClean = async () => {
    const toTrash = emails.filter((e) => selected.has(e.id));
    const toKeep = emails.filter((e) => !selected.has(e.id));

    if (toTrash.length === 0) {
      applyChoices(toKeep, []);
      setCleanResult({ deleted: 0 });
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
      setCleanResult({ ...result, kept: toKeep.length });
      addLog(`Done. ${result.deleted} trashed, ${toKeep.length} kept.`);
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

  const totalCount = emails.length;
  const selectedCount = selected.size;
  const keptCount = totalCount - selectedCount;

  return (
    <div className="iz-wrap">
      <style>{globalCSS}</style>
      <div className="iz-grain" aria-hidden="true" />

      <div className="iz-container">
        {/* Header */}
        <div style={{ marginBottom: 28, borderBottom: "1px solid #1e1e1e", paddingBottom: 24 }}>
          <div style={{ fontSize: 10, letterSpacing: 4, textTransform: "uppercase", color: "#555", marginBottom: 8 }}>
            Gmail Maintenance
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "#ff4d00", letterSpacing: -1, fontFamily: "'Space Grotesk', sans-serif", margin: "0 0 8px" }}>
            INBOX ZERO
          </h1>
          <div style={{ fontSize: 12, color: "#555", lineHeight: 1.5 }}>
            Scan → review → trash. Learns your preferences over time.
          </div>
        </div>

        {/* Auth status */}
        {accessToken && (
          <div style={{ fontSize: 11, color: "#555", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#8aff42", flexShrink: 0, display: "inline-block" }} />
            Gmail connected
            <button onClick={signOut} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#333", fontSize: 11, fontFamily: "inherit", padding: 0 }}>
              disconnect
            </button>
          </div>
        )}

        {/* Connect */}
        {!accessToken && (
          <button className="iz-btn iz-btn-google" onClick={signIn}>
            <GoogleIcon /> Connect Gmail
          </button>
        )}

        {/* Scan */}
        {accessToken && phase === "idle" && (
          <button className="iz-btn" onClick={handleScan}>Scan Inbox</button>
        )}

        {(phase === "scanning" || phase === "cleaning") && (
          <button className="iz-btn" disabled>
            <Spinner /> {phase === "scanning" ? "Scanning..." : "Cleaning..."}
          </button>
        )}

        {/* Review */}
        {phase === "review" && (
          <div style={{ animation: "fadeIn 0.35s ease" }}>
            {/* Stats */}
            <div className="iz-stats">
              <div className="iz-stat-box">
                <span className="iz-stat-label">Found</span>
                <div className="iz-stat-value">{totalCount}</div>
              </div>
              <div className="iz-stat-box">
                <span className="iz-stat-label">Trash</span>
                <div className="iz-stat-value" style={{ color: "#ff4d00" }}>{selectedCount}</div>
              </div>
              <div className="iz-stat-box">
                <span className="iz-stat-label">Keep</span>
                <div className="iz-stat-value" style={{ color: "#8aff42" }}>{keptCount}</div>
              </div>
            </div>

            {/* Review list */}
            {reviewEmails.length > 0 && (
              <div className="iz-card">
                <div className="iz-section-row">
                  <span className="iz-card-label" style={{ marginBottom: 0 }}>Review ({reviewEmails.length})</span>
                  <span className="iz-select-all" onClick={() => toggleAll(reviewEmails)}>
                    {reviewEmails.every((e) => selected.has(e.id)) ? "Uncheck all" : "Check all"}
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

            {/* Safe / remembered */}
            {safeEmails.length > 0 && (
              <div className="iz-card">
                <div className="iz-section-row">
                  <span className="iz-card-label" style={{ marginBottom: 0, color: "#3a8000" }}>
                    Remembered safe ({safeEmails.length})
                  </span>
                  <span className="iz-select-all" onClick={() => toggleAll(safeEmails)}>
                    {safeEmails.every((e) => selected.has(e.id)) ? "Uncheck all" : "Check all"}
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

            {totalCount === 0 && (
              <div style={{ background: "#0d1a00", border: "1px solid #1a2e00", padding: "20px 24px", color: "#8aff42", fontSize: 13 }}>
                ✓ Inbox is already clean!
              </div>
            )}
          </div>
        )}

        {/* Done */}
        {phase === "done" && cleanResult && (
          <div style={{ background: "#0d1a00", border: "1px solid #1a2e00", padding: "20px 24px", color: "#8aff42", fontSize: 13, lineHeight: 1.6, animation: "fadeIn 0.35s ease" }}>
            ✓ Trashed {cleanResult.deleted} messages.
            {cleanResult.kept > 0 && (
              <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>
                Remembered {cleanResult.kept} safe sender{cleanResult.kept !== 1 ? "s" : ""} for next time.
              </div>
            )}
          </div>
        )}

        {/* Activity log */}
        {logs.length > 0 && (
          <div className="iz-card" style={{ marginTop: 24 }} ref={logRef}>
            <span className="iz-card-label">Activity Log</span>
            <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
              {logs.map((l, i) => (
                <div key={i} className={`iz-log-line${i === logs.length - 1 ? " active" : ""}`}>
                  <span style={{ color: "#333" }}>{l.time}</span> → {l.text}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: 48, fontSize: 10, color: "#2a2a2a", letterSpacing: 2, textTransform: "uppercase" }}>
          Gmail Cleanup · v3.0
        </div>
      </div>

      {/* Sticky bottom bar */}
      {phase === "review" && (
        <div className="iz-sticky">
          <div className="iz-sticky-inner">
            <button className="iz-btn iz-btn-outline" onClick={reset} style={{ flex: "0 0 72px", minHeight: 50 }}>
              Cancel
            </button>
            <button className="iz-btn" onClick={handleClean} style={{ flex: 1, minHeight: 50 }}>
              {selectedCount > 0 ? `Trash ${selectedCount}` : "Done (keep all)"}
            </button>
          </div>
        </div>
      )}

      {phase === "done" && (
        <div className="iz-sticky">
          <div className="iz-sticky-inner">
            <button className="iz-btn iz-btn-success" onClick={reset} style={{ flex: 1 }}>
              Run Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
