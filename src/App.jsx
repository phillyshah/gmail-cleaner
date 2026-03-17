import { useState, useCallback, useRef, useEffect } from "react";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES = "https://www.googleapis.com/auth/gmail.modify";

const styles = {
  app: {
    minHeight: "100vh",
    background: "#0a0a0a",
    color: "#e8e4de",
    fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
    padding: "0",
    position: "relative",
    overflow: "hidden",
  },
  grain: {
    position: "fixed",
    top: 0, left: 0, right: 0, bottom: 0,
    opacity: 0.03,
    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
    pointerEvents: "none",
    zIndex: 0,
  },
  container: {
    maxWidth: "680px",
    margin: "0 auto",
    padding: "48px 24px",
    position: "relative",
    zIndex: 1,
  },
  header: {
    marginBottom: "48px",
    borderBottom: "1px solid #2a2a2a",
    paddingBottom: "32px",
  },
  title: {
    fontSize: "11px",
    letterSpacing: "4px",
    textTransform: "uppercase",
    color: "#666",
    marginBottom: "12px",
  },
  heading: {
    fontSize: "32px",
    fontWeight: 700,
    color: "#ff4d00",
    letterSpacing: "-1px",
    fontFamily: "'Space Grotesk', 'Inter', sans-serif",
    margin: 0,
  },
  subtitle: {
    fontSize: "13px",
    color: "#555",
    marginTop: "8px",
    lineHeight: 1.5,
  },
  card: {
    background: "#111",
    border: "1px solid #1e1e1e",
    padding: "24px",
    marginBottom: "16px",
    position: "relative",
  },
  cardLabel: {
    fontSize: "10px",
    letterSpacing: "3px",
    textTransform: "uppercase",
    color: "#ff4d00",
    marginBottom: "16px",
    display: "block",
  },
  btn: {
    background: "#ff4d00",
    color: "#0a0a0a",
    border: "none",
    padding: "14px 32px",
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "3px",
    textTransform: "uppercase",
    cursor: "pointer",
    fontFamily: "'JetBrains Mono', monospace",
    transition: "all 0.15s ease",
    width: "100%",
  },
  btnDisabled: {
    background: "#333",
    color: "#666",
    cursor: "not-allowed",
  },
  btnDanger: {
    background: "transparent",
    color: "#ff4d00",
    border: "1px solid #ff4d00",
  },
  btnGoogle: {
    background: "#fff",
    color: "#111",
    border: "none",
    padding: "14px 32px",
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "2px",
    textTransform: "uppercase",
    cursor: "pointer",
    fontFamily: "'JetBrains Mono', monospace",
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
  },
  stat: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 0",
    borderBottom: "1px solid #1a1a1a",
  },
  statLabel: { fontSize: "12px", color: "#666" },
  statValue: {
    fontSize: "20px",
    fontWeight: 700,
    color: "#e8e4de",
    fontFamily: "'Space Grotesk', sans-serif",
  },
  emailRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: "10px 0",
    borderBottom: "1px solid #151515",
    gap: "16px",
  },
  emailSender: {
    fontSize: "12px",
    color: "#888",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "180px",
    flexShrink: 0,
  },
  emailSubject: {
    fontSize: "12px",
    color: "#555",
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  spinner: {
    display: "inline-block",
    width: "14px",
    height: "14px",
    border: "2px solid #333",
    borderTopColor: "#ff4d00",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  log: {
    fontSize: "11px",
    color: "#444",
    lineHeight: 1.8,
    fontFamily: "'JetBrains Mono', monospace",
  },
  logLine: (active) => ({
    color: active ? "#ff4d00" : "#444",
    transition: "color 0.3s ease",
  }),
  badge: (type) => ({
    fontSize: "10px",
    padding: "2px 8px",
    letterSpacing: "1px",
    textTransform: "uppercase",
    background: type === "promo" ? "#1a0f00" : "#0f0f1a",
    color: type === "promo" ? "#ff8c42" : "#6b8afd",
    border: `1px solid ${type === "promo" ? "#2a1800" : "#1a1a2e"}`,
    flexShrink: 0,
  }),
  summary: {
    background: "#0d1a00",
    border: "1px solid #1a2e00",
    padding: "20px 24px",
    marginTop: "16px",
    fontSize: "13px",
    color: "#8aff42",
    lineHeight: 1.6,
  },
  connected: {
    fontSize: "11px",
    color: "#555",
    marginBottom: "16px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  dot: (color) => ({
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    background: color,
    flexShrink: 0,
  }),
};

const keyframes = `
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Space+Grotesk:wght@400;700&display=swap');
`;

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

export default function GmailCleaner() {
  const { accessToken, signIn, signOut } = useGoogleAuth();
  const [phase, setPhase] = useState("idle");
  const [scanResult, setScanResult] = useState(null);
  const [cleanResult, setCleanResult] = useState(null);
  const [logs, setLogs] = useState([]);
  const logRef = useRef(null);

  const addLog = useCallback((msg) => {
    setLogs((prev) => [...prev, { text: msg, time: new Date().toLocaleTimeString() }]);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const handleScan = async () => {
    setPhase("scanning");
    setScanResult(null);
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
      setScanResult(result);
      addLog(`Found ${result.promotions.length} promotional, ${result.social.length} social.`);
      setPhase("scanned");
    } catch (err) {
      addLog(`Error: ${err.message}`);
      setPhase("idle");
    }
  };

  const handleClean = async () => {
    if (!scanResult) return;
    setPhase("cleaning");
    const allIds = [
      ...scanResult.promotions.map((e) => e.id),
      ...scanResult.social.map((e) => e.id),
    ];

    if (allIds.length === 0) {
      addLog("Nothing to clean.");
      setPhase("done");
      setCleanResult({ deleted: 0 });
      return;
    }

    addLog(`Trashing ${allIds.length} messages...`);
    try {
      const res = await fetch("/api/trash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, ids: allIds }),
      });
      const result = await res.json();
      setCleanResult(result);
      addLog(`Done. ${result.deleted} messages moved to trash.`);
      setPhase("done");
    } catch (err) {
      addLog(`Error: ${err.message}`);
      setPhase("idle");
    }
  };

  const reset = () => {
    setPhase("idle");
    setScanResult(null);
    setCleanResult(null);
    setLogs([]);
  };

  const promoCount = scanResult?.promotions?.length || 0;
  const socialCount = scanResult?.social?.length || 0;
  const totalFound = promoCount + socialCount;

  return (
    <div style={styles.app}>
      <style>{keyframes}</style>
      <div style={styles.grain} />
      <div style={styles.container}>
        <div style={styles.header}>
          <div style={styles.title}>Gmail Maintenance</div>
          <h1 style={styles.heading}>INBOX ZERO</h1>
          <div style={styles.subtitle}>
            Scans promotions & social notifications → previews → trashes on your command.
          </div>
        </div>

        {/* Auth state */}
        {accessToken && (
          <div style={styles.connected}>
            <span style={styles.dot("#8aff42")} />
            Gmail connected
            <span
              onClick={signOut}
              style={{ marginLeft: "auto", cursor: "pointer", color: "#444" }}
            >
              disconnect
            </span>
          </div>
        )}

        {/* Connect button */}
        {!accessToken && (
          <button style={styles.btnGoogle} onClick={signIn}>
            <svg width="16" height="16" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Connect Gmail
          </button>
        )}

        {/* Scan button */}
        {accessToken && phase === "idle" && (
          <button
            style={styles.btn}
            onClick={handleScan}
            onMouseEnter={(e) => { e.target.style.background = "#ff6a2a"; }}
            onMouseLeave={(e) => { e.target.style.background = "#ff4d00"; }}
          >
            Scan Inbox
          </button>
        )}
        {phase === "scanning" && (
          <button style={{ ...styles.btn, ...styles.btnDisabled }} disabled>
            <span style={styles.spinner} /> &nbsp; Scanning...
          </button>
        )}
        {phase === "cleaning" && (
          <button style={{ ...styles.btn, ...styles.btnDisabled }} disabled>
            <span style={styles.spinner} /> &nbsp; Cleaning...
          </button>
        )}

        {/* Results */}
        {scanResult && phase !== "idle" && (
          <div style={{ marginTop: "24px", animation: "fadeIn 0.4s ease" }}>
            <div style={styles.card}>
              <span style={styles.cardLabel}>Scan Results</span>
              <div style={styles.stat}>
                <span style={styles.statLabel}>Promotions / Marketing</span>
                <span style={styles.statValue}>{promoCount}</span>
              </div>
              <div style={{ ...styles.stat, borderBottom: "none" }}>
                <span style={styles.statLabel}>Social Notifications</span>
                <span style={styles.statValue}>{socialCount}</span>
              </div>
            </div>

            {totalFound > 0 && (
              <div style={styles.card}>
                <span style={styles.cardLabel}>Preview ({totalFound} emails)</span>
                <div style={{ maxHeight: "240px", overflowY: "auto" }}>
                  {scanResult.promotions.slice(0, 15).map((e, i) => (
                    <div key={`p-${i}`} style={styles.emailRow}>
                      <span style={styles.badge("promo")}>promo</span>
                      <span style={styles.emailSender}>{e.sender}</span>
                      <span style={styles.emailSubject}>{e.subject}</span>
                    </div>
                  ))}
                  {scanResult.social.slice(0, 15).map((e, i) => (
                    <div key={`s-${i}`} style={styles.emailRow}>
                      <span style={styles.badge("social")}>social</span>
                      <span style={styles.emailSender}>{e.sender}</span>
                      <span style={styles.emailSubject}>{e.subject}</span>
                    </div>
                  ))}
                  {totalFound > 30 && (
                    <div style={{ fontSize: "11px", color: "#444", padding: "8px 0" }}>
                      + {totalFound - 30} more...
                    </div>
                  )}
                </div>
              </div>
            )}

            {phase === "scanned" && totalFound > 0 && (
              <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
                <button
                  style={{ ...styles.btn, ...styles.btnDanger, flex: 1 }}
                  onClick={handleClean}
                  onMouseEnter={(e) => { e.target.style.background = "#ff4d00"; e.target.style.color = "#0a0a0a"; }}
                  onMouseLeave={(e) => { e.target.style.background = "transparent"; e.target.style.color = "#ff4d00"; }}
                >
                  Trash {totalFound} Emails
                </button>
                <button
                  style={{ ...styles.btn, background: "#1a1a1a", color: "#666", flex: 0.4 }}
                  onClick={reset}
                  onMouseEnter={(e) => { e.target.style.color = "#999"; }}
                  onMouseLeave={(e) => { e.target.style.color = "#666"; }}
                >
                  Cancel
                </button>
              </div>
            )}

            {phase === "scanned" && totalFound === 0 && (
              <div style={styles.summary}>
                ✓ Inbox is already clean!
                <div style={{ marginTop: "16px" }}>
                  <button style={{ ...styles.btn, background: "#1a2e00", color: "#8aff42", border: "1px solid #2a4e00" }} onClick={reset}>
                    Run Again
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Done */}
        {phase === "done" && cleanResult && (
          <div style={{ ...styles.summary, animation: "fadeIn 0.4s ease", marginTop: "16px" }}>
            ✓ Trashed {cleanResult.deleted} messages.
            <div style={{ marginTop: "16px" }}>
              <button style={{ ...styles.btn, background: "#1a2e00", color: "#8aff42", border: "1px solid #2a4e00" }} onClick={reset}>
                Run Again
              </button>
            </div>
          </div>
        )}

        {/* Log */}
        {logs.length > 0 && (
          <div style={{ ...styles.card, marginTop: "24px" }} ref={logRef}>
            <span style={styles.cardLabel}>Activity Log</span>
            <div style={styles.log}>
              {logs.map((l, i) => (
                <div key={i} style={styles.logLine(i === logs.length - 1)}>
                  <span style={{ color: "#333" }}>{l.time}</span> → {l.text}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: "48px", fontSize: "10px", color: "#333", letterSpacing: "2px", textTransform: "uppercase" }}>
          Gmail Cleanup · v2.0
        </div>
      </div>
    </div>
  );
}
