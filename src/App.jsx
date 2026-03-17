import { useState, useCallback, useRef, useEffect } from "react";

const GMAIL_MCP = { type: "url", url: "https://gmail.mcp.claude.com/mcp", name: "gmail-mcp" };

const CLEANUP_PROMPT = `You are an email cleanup assistant. Search the user's Gmail and identify emails to clean up.
STEP 1: Search for promotional/marketing emails using query: "category:promotions is:unread" and also "category:promotions is:read" (limit to last 30 days)
STEP 2: Search for social notification emails using query: "category:social" (limit to last 30 days)
STEP 3: For each email found, note the subject, sender, and ID.
STEP 4: Provide a JSON summary of what you found.
Respond ONLY with valid JSON in this exact format, no markdown fences:
{
  "promotions": [{"id": "...", "subject": "...", "sender": "..."}],
  "social": [{"id": "...", "subject": "...", "sender": "..."}],
  "summary": "Found X promotional and Y social emails"
}
If you cannot access Gmail or get errors, respond with:
{"promotions": [], "social": [], "summary": "Error: <description>", "error": true}`;

const DELETE_PROMPT = (ids) => `Trash the following Gmail messages by their IDs. Process each one:
${ids.map(id => `- Message ID: ${id}`).join('\n')}
After processing, respond ONLY with valid JSON, no markdown:
{"deleted": ${ids.length}, "errors": 0, "details": "Successfully trashed ${ids.length} messages"}`;

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
  stat: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 0",
    borderBottom: "1px solid #1a1a1a",
  },
  statLabel: {
    fontSize: "12px",
    color: "#666",
  },
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
};

const keyframes = `
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Space+Grotesk:wght@400;700&display=swap');
`;

async function callClaude(prompt, useMcp = true) {
  const body = {
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  };
  if (useMcp) body.mcp_servers = [GMAIL_MCP];

  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  // Surface API-level errors (auth failures, bad params, etc.)
  if (data.error) {
    return { error: true, summary: `API error: ${data.error.message || JSON.stringify(data.error)}` };
  }

  const texts = (data.content || [])
    .filter(b => b.type === "text")
    .map(b => b.text);
  const full = texts.join("\n");

  try {
    const cleaned = full.replace(/```json|```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1) {
      return JSON.parse(cleaned.substring(start, end + 1));
    }
  } catch (e) {
    // ignore parse errors
  }
  return { raw: full, error: true, summary: `Could not parse response: ${full.slice(0, 200)}` };
}

export default function GmailCleaner() {
  const [phase, setPhase] = useState("idle"); // idle, scanning, scanned, cleaning, done
  const [scanResult, setScanResult] = useState(null);
  const [cleanResult, setCleanResult] = useState(null);
  const [logs, setLogs] = useState([]);
  const logRef = useRef(null);

  const addLog = useCallback((msg) => {
    setLogs(prev => [...prev, { text: msg, time: new Date().toLocaleTimeString() }]);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const handleScan = async () => {
    setPhase("scanning");
    setScanResult(null);
    setCleanResult(null);
    setLogs([]);
    addLog("Connecting to Gmail MCP...");
    addLog("Searching promotions & social categories...");
    try {
      const result = await callClaude(CLEANUP_PROMPT);
      if (result.error && !result.promotions) {
        addLog(`Error: ${result.summary || result.raw || "Unknown error"}`);
        setPhase("idle");
        return;
      }
      setScanResult(result);
      addLog(`Scan complete. Found ${(result.promotions || []).length} promotional, ${(result.social || []).length} social.`);
      setPhase("scanned");
    } catch (err) {
      addLog(`Connection error: ${err.message}`);
      setPhase("idle");
    }
  };

  const handleClean = async () => {
    if (!scanResult) return;
    setPhase("cleaning");
    const allIds = [
      ...(scanResult.promotions || []).map(e => e.id),
      ...(scanResult.social || []).map(e => e.id),
    ].filter(Boolean);

    if (allIds.length === 0) {
      addLog("Nothing to clean.");
      setPhase("done");
      setCleanResult({ deleted: 0, details: "Inbox already clean!" });
      return;
    }

    addLog(`Trashing ${allIds.length} messages...`);
    let totalDeleted = 0;
    for (let i = 0; i < allIds.length; i += 10) {
      const batch = allIds.slice(i, i + 10);
      addLog(`Processing batch ${Math.floor(i / 10) + 1}...`);
      try {
        const result = await callClaude(DELETE_PROMPT(batch));
        totalDeleted += (result.deleted || batch.length);
      } catch (e) {
        addLog(`Batch error: ${e.message}`);
      }
    }
    setCleanResult({ deleted: totalDeleted, details: `Trashed ${totalDeleted} messages.` });
    addLog(`Done. ${totalDeleted} messages moved to trash.`);
    setPhase("done");
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

        {phase === "idle" && (
          <button style={styles.btn} onClick={handleScan}
            onMouseEnter={e => { e.target.style.background = "#ff6a2a"; }}
            onMouseLeave={e => { e.target.style.background = "#ff4d00"; }}>
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
                  {(scanResult.promotions || []).slice(0, 15).map((e, i) => (
                    <div key={`p-${i}`} style={styles.emailRow}>
                      <span style={styles.badge("promo")}>promo</span>
                      <span style={styles.emailSender}>{e.sender}</span>
                      <span style={styles.emailSubject}>{e.subject}</span>
                    </div>
                  ))}
                  {(scanResult.social || []).slice(0, 15).map((e, i) => (
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
                <button style={{ ...styles.btn, ...styles.btnDanger, flex: 1 }}
                  onClick={handleClean}
                  onMouseEnter={e => { e.target.style.background = "#ff4d00"; e.target.style.color = "#0a0a0a"; }}
                  onMouseLeave={e => { e.target.style.background = "transparent"; e.target.style.color = "#ff4d00"; }}>
                  Trash {totalFound} Emails
                </button>
                <button style={{ ...styles.btn, background: "#1a1a1a", color: "#666", flex: 0.4 }}
                  onClick={reset}
                  onMouseEnter={e => { e.target.style.color = "#999"; }}
                  onMouseLeave={e => { e.target.style.color = "#666"; }}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {phase === "done" && cleanResult && (
          <div style={{ ...styles.summary, animation: "fadeIn 0.4s ease", marginTop: "16px" }}>
            ✓ {cleanResult.details}
            <div style={{ marginTop: "16px" }}>
              <button style={{ ...styles.btn, background: "#1a2e00", color: "#8aff42", border: "1px solid #2a4e00" }}
                onClick={reset}>
                Run Again
              </button>
            </div>
          </div>
        )}

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
          Gmail Cleanup · v1.0
        </div>
      </div>
    </div>
  );
}
