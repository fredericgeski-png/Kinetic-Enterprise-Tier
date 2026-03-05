import { useState, useEffect, useCallback, useRef } from "react";

// ─────────────────────────────────────────────
// MOCK DATA & CONSTANTS
// ─────────────────────────────────────────────
const ROLES = ["admin", "compliance_officer", "audit_viewer", "agent_owner"];

const MOCK_CURRENT_USER = {
  email: "frederic@kinetic.io",
  role: "admin",
  name: "Frederic Moreau",
};

const MOCK_AGENTS = [
  { id: "SIM_AGENT_01", owner: "frederic@kinetic.io", status: "active", entropy: 0.95, tokens: 1500 },
  { id: "SIM_AGENT_02", owner: "aria@kinetic.io", status: "active", entropy: 0.62, tokens: 980 },
  { id: "SIM_AGENT_03", owner: "frederic@kinetic.io", status: "terminated", entropy: null, tokens: 3200 },
  { id: "SIM_AGENT_04", owner: "sam@kinetic.io", status: "active", entropy: 0.41, tokens: 440 },
];

const MOCK_AUDIT_LOGS = [
  {
    event_id: "evt_550e8400e29b41d4a716446655440000",
    timestamp: "2026-03-05T14:02:06.736Z",
    action: "kill_agent",
    agent_id: "SIM_AGENT_01",
    session_id: "sess_apkt748a",
    triggered_by: "frederic@kinetic.io",
    user_role: "admin",
    pre_state: { entropy: 0.95, tokens_used: 1500, status: "active" },
    post_state: { entropy: null, tokens_used: 1500, status: "terminated" },
    reason: "entropy_exceeded_threshold",
    execution_status: "success",
    payload_hash: "0x7f3c2e1a9b4d6c8e5a2b1c9d8e7f6a5b4c3d2e1f",
    signature: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3x7q...",
    signature_algorithm: "RSA-SHA256",
    signature_verified: true,
    immutable: true,
    blockchain_hash: "0xabcd1234ef567890abcd1234ef567890abcd1234",
    approval_event_id: "evt_approval_001",
  },
  {
    event_id: "evt_approval_001",
    timestamp: "2026-03-05T14:01:58.112Z",
    action: "approve_kill",
    agent_id: "SIM_AGENT_01",
    session_id: "sess_apkt748a",
    triggered_by: "frederic@kinetic.io",
    user_role: "admin",
    pre_state: { entropy: 0.95, tokens_used: 1500, status: "active" },
    post_state: { entropy: 0.95, tokens_used: 1500, status: "pending_kill" },
    reason: "user_confirmed_kill",
    execution_status: "success",
    payload_hash: "0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
    signature: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEB9y8r...",
    signature_algorithm: "RSA-SHA256",
    signature_verified: true,
    immutable: true,
    blockchain_hash: null,
    approval_event_id: null,
  },
  {
    event_id: "evt_660f9511f3ac52e5b827557766551111",
    timestamp: "2026-03-04T09:45:22.001Z",
    action: "safe_mode",
    agent_id: "SIM_AGENT_02",
    session_id: "sess_bqlu859b",
    triggered_by: "aria@kinetic.io",
    user_role: "agent_owner",
    pre_state: { entropy: 0.78, tokens_used: 980, status: "active" },
    post_state: { entropy: 0.78, tokens_used: 980, status: "safe_mode" },
    reason: "manual_safe_mode_activation",
    execution_status: "success",
    payload_hash: "0x9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b",
    signature: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEC6z9s...",
    signature_algorithm: "RSA-SHA256",
    signature_verified: true,
    immutable: true,
    blockchain_hash: null,
    approval_event_id: null,
  },
  {
    event_id: "evt_771a0622g4bd63f6c938668877662222",
    timestamp: "2026-03-03T16:30:11.445Z",
    action: "kill_all",
    agent_id: "ALL",
    session_id: "sess_crmv960c",
    triggered_by: "frederic@kinetic.io",
    user_role: "admin",
    pre_state: { entropy: "multiple", tokens_used: 8640, status: "active" },
    post_state: { entropy: null, tokens_used: 8640, status: "terminated" },
    reason: "emergency_shutdown",
    execution_status: "success",
    payload_hash: "0x3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e",
    signature: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQED7a0t...",
    signature_algorithm: "RSA-SHA256",
    signature_verified: false,
    immutable: true,
    blockchain_hash: "0xdead0000beef1111dead0000beef1111dead0000",
    approval_event_id: "evt_approval_003",
  },
];

const COMPLIANCE_FRAMEWORKS = [
  {
    id: "soc2",
    name: "SOC 2 Type II",
    status: "verified",
    lastAudit: "2026-01-15",
    nextAudit: "2027-01-15",
    certNumber: "SOC2-2026-KIN-00142",
    scope: "Security, Availability, Confidentiality",
  },
  {
    id: "gdpr",
    name: "GDPR",
    status: "verified",
    lastAudit: "2025-11-20",
    nextAudit: "2026-11-20",
    certNumber: "GDPR-EU-2025-KIN-0087",
    scope: "EU Data Residency & Processing",
  },
  {
    id: "hipaa",
    name: "HIPAA",
    status: "pending",
    lastAudit: "2025-06-01",
    nextAudit: "2026-06-01",
    certNumber: null,
    scope: "PHI Handling & Access Controls",
  },
  {
    id: "iso27001",
    name: "ISO 27001",
    status: "verified",
    lastAudit: "2025-09-10",
    nextAudit: "2026-09-10",
    certNumber: "ISO27001-2025-KIN-0339",
    scope: "Information Security Management",
  },
];

const ENCRYPTION_STATUS = {
  at_rest: { status: "enabled", algorithm: "AES-256-GCM", keyRotation: "90 days" },
  in_transit: { status: "enabled", protocol: "TLS 1.3", hsts: true },
  signing: { status: "enabled", algorithm: "RSA-2048/SHA-256", keyRotation: "365 days" },
  backup: { status: "enabled", frequency: "daily", retention: "7 years", drTested: "2026-02-01" },
};

const DATA_RESIDENCY = [
  { region: "EU (Frankfurt)", dataTypes: ["User PII", "Agent Logs"], status: "compliant" },
  { region: "US East (N. Virginia)", dataTypes: ["Audit Logs", "Telemetry"], status: "compliant" },
  { region: "APAC (Singapore)", dataTypes: ["Session Data"], status: "review" },
];

// ─────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────
const formatTimestamp = (iso) => {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "medium" });
};

const truncateHash = (hash) => hash ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : "—";

const entropyColor = (e) => {
  if (e === null || e === undefined) return "#64748b";
  if (e >= 0.85) return "#ef4444";
  if (e >= 0.65) return "#f59e0b";
  return "#10b981";
};

const entropyLabel = (e) => {
  if (e === null || e === undefined) return "—";
  if (e >= 0.85) return "CRITICAL";
  if (e >= 0.65) return "HIGH";
  return "NORMAL";
};

const simulateRSASign = (payload) => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let sig = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA";
  const seed = payload.length + payload.charCodeAt(0);
  for (let i = 0; i < 64; i++) sig += chars[(seed * (i + 7) * 31) % chars.length];
  return sig + "==";
};

const simulateHash = (str) => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return "0x" + Math.abs(h).toString(16).padStart(8, "0") + Math.abs(h * 31).toString(16).padStart(8, "0");
};

const generateUUID = () => {
  return "evt_" + "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx".replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16)
  );
};

// ─────────────────────────────────────────────
// ICON COMPONENTS (inline SVG)
// ─────────────────────────────────────────────
const Icon = ({ name, size = 16, color = "currentColor" }) => {
  const icons = {
    shield: <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"/>,
    key: <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"/>,
    clipboard: <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/>,
    alert: <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>,
    check: <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/>,
    x: <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>,
    eye: <><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></>,
    download: <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/>,
    user: <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/>,
    lock: <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>,
    globe: <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"/>,
    server: <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 17.25v.75a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25v-.75m19.5 0A2.25 2.25 0 0021.75 15v-.75m-19.5 2.25A2.25 2.25 0 002.25 15v-.75m19.5 0v-9A2.25 2.25 0 0019.5 3h-15A2.25 2.25 0 002.25 6v9m19.5 0h-19.5"/>,
    chain: <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"/>,
    database: <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 2.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"/>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.75">
      {icons[name]}
    </svg>
  );
};

// ─────────────────────────────────────────────
// MODULE 1: AUDIT LOG VIEWER
// ─────────────────────────────────────────────
const AuditLogViewer = ({ logs, onSelectEvent }) => {
  const [filter, setFilter] = useState({ action: "all", agent: "", verified: "all" });
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 10;

  const filtered = logs.filter((l) => {
    if (filter.action !== "all" && l.action !== filter.action) return false;
    if (filter.agent && !l.agent_id.toLowerCase().includes(filter.agent.toLowerCase())) return false;
    if (filter.verified === "verified" && !l.signature_verified) return false;
    if (filter.verified === "failed" && l.signature_verified) return false;
    return true;
  });

  const paged = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const handleExport = () => {
    const json = JSON.stringify(filtered, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kinetic-audit-export-${Date.now()}.json`;
    a.click();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Filters */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={filter.action}
          onChange={(e) => { setFilter((f) => ({ ...f, action: e.target.value })); setPage(0); }}
          style={styles.select}
        >
          <option value="all">All Actions</option>
          <option value="kill_agent">kill_agent</option>
          <option value="kill_all">kill_all</option>
          <option value="safe_mode">safe_mode</option>
          <option value="approve_kill">approve_kill</option>
        </select>
        <input
          placeholder="Filter by Agent ID…"
          value={filter.agent}
          onChange={(e) => { setFilter((f) => ({ ...f, agent: e.target.value })); setPage(0); }}
          style={styles.input}
        />
        <select
          value={filter.verified}
          onChange={(e) => { setFilter((f) => ({ ...f, verified: e.target.value })); setPage(0); }}
          style={styles.select}
        >
          <option value="all">All Signatures</option>
          <option value="verified">✓ Verified</option>
          <option value="failed">✗ Failed</option>
        </select>
        <button onClick={handleExport} style={styles.btnSecondary}>
          <Icon name="download" size={14} /> Export JSON
        </button>
        <span style={{ marginLeft: "auto", color: "#94a3b8", fontSize: 12 }}>
          {filtered.length} events
        </span>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid #1e293b" }}>
        <table style={styles.table}>
          <thead>
            <tr style={styles.thead}>
              {["Timestamp", "Event ID", "Action", "Agent", "Triggered By", "Pre→Post Entropy", "Sig"].map((h) => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((log, i) => (
              <tr
                key={log.event_id}
                style={{ ...styles.tr, background: i % 2 === 0 ? "#0d1526" : "#0a1120" }}
                onClick={() => onSelectEvent(log)}
              >
                <td style={styles.td}><span style={{ fontFamily: "monospace", fontSize: 11, color: "#94a3b8" }}>{formatTimestamp(log.timestamp)}</span></td>
                <td style={styles.td}><span style={{ fontFamily: "monospace", fontSize: 11, color: "#60a5fa" }}>{log.event_id.slice(0, 16)}…</span></td>
                <td style={styles.td}>
                  <span style={{ ...styles.badge, background: log.action.includes("kill") ? "#7f1d1d" : "#1e3a5f", color: log.action.includes("kill") ? "#fca5a5" : "#93c5fd" }}>
                    {log.action}
                  </span>
                </td>
                <td style={styles.td}><span style={{ fontFamily: "monospace", fontSize: 12 }}>{log.agent_id}</span></td>
                <td style={styles.td}><span style={{ fontSize: 12, color: "#cbd5e1" }}>{log.triggered_by}</span></td>
                <td style={styles.td}>
                  <span style={{ fontSize: 12, color: entropyColor(log.pre_state?.entropy) }}>
                    {log.pre_state?.entropy != null ? (log.pre_state.entropy * 100).toFixed(0) + "%" : "—"}
                  </span>
                  <span style={{ color: "#475569", margin: "0 4px" }}>→</span>
                  <span style={{ fontSize: 12, color: "#64748b" }}>
                    {log.post_state?.entropy != null ? (log.post_state.entropy * 100).toFixed(0) + "%" : "null"}
                  </span>
                </td>
                <td style={styles.td}>
                  {log.signature_verified
                    ? <span style={{ color: "#10b981", display: "flex", alignItems: "center", gap: 3 }}><Icon name="check" size={13} color="#10b981" /> OK</span>
                    : <span style={{ color: "#ef4444", display: "flex", alignItems: "center", gap: 3 }}><Icon name="x" size={13} color="#ef4444" /> FAIL</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          {Array.from({ length: totalPages }, (_, i) => (
            <button key={i} onClick={() => setPage(i)} style={{ ...styles.btnSecondary, background: page === i ? "#2563eb" : "#1e293b", minWidth: 32 }}>
              {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────
// MODULE 2: EVENT DETAILS MODAL (Cryptographic)
// ─────────────────────────────────────────────
const EventDetailsModal = ({ event, onClose }) => {
  if (!event) return null;
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ color: "#f1f5f9", fontSize: 16, fontWeight: 600, letterSpacing: "0.05em" }}>
            <Icon name="key" size={16} color="#60a5fa" /> &nbsp;EVENT CRYPTOGRAPHIC DETAILS
          </h2>
          <button onClick={onClose} style={{ ...styles.btnIcon, color: "#94a3b8" }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <InfoRow label="Event ID" value={event.event_id} mono />
          <InfoRow label="Timestamp (UTC)" value={event.timestamp} mono />
          <InfoRow label="Action" value={event.action} badge badgeColor={event.action.includes("kill") ? "#7f1d1d" : "#1e3a5f"} />
          <InfoRow label="Agent" value={event.agent_id} mono />
          <InfoRow label="Session" value={event.session_id} mono />
          <InfoRow label="Triggered By" value={`${event.triggered_by} (${event.user_role})`} />

          <div style={styles.divider} />

          <div style={styles.stateGrid}>
            <StateBox label="PRE-STATE" state={event.pre_state} />
            <div style={{ display: "flex", alignItems: "center", color: "#475569", fontSize: 20 }}>→</div>
            <StateBox label="POST-STATE" state={event.post_state} />
          </div>

          <div style={styles.divider} />

          <InfoRow label="Payload Hash (SHA-256)" value={event.payload_hash} mono small />
          <InfoRow label="Signature Algorithm" value={event.signature_algorithm} mono />
          <div style={{ background: "#0a1120", borderRadius: 8, padding: 12, border: "1px solid #1e293b" }}>
            <div style={{ color: "#64748b", fontSize: 10, marginBottom: 6, letterSpacing: "0.08em" }}>RSA SIGNATURE</div>
            <div style={{ fontFamily: "monospace", fontSize: 10, color: "#7dd3fc", wordBreak: "break-all", lineHeight: 1.6 }}>
              {event.signature}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 8, background: event.signature_verified ? "#052e16" : "#450a0a", border: `1px solid ${event.signature_verified ? "#166534" : "#991b1b"}` }}>
            {event.signature_verified
              ? <><Icon name="check" size={16} color="#4ade80" /><span style={{ color: "#4ade80", fontSize: 13, fontWeight: 600 }}>SIGNATURE VERIFIED — Event has not been tampered with</span></>
              : <><Icon name="alert" size={16} color="#f87171" /><span style={{ color: "#f87171", fontSize: 13, fontWeight: 600 }}>SIGNATURE INVALID — Event may have been modified</span></>
            }
          </div>

          {event.blockchain_hash && (
            <InfoRow label="Blockchain Anchor Hash" value={event.blockchain_hash} mono small />
          )}
          {event.approval_event_id && (
            <InfoRow label="Linked Approval Event" value={event.approval_event_id} mono />
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <span style={{ ...styles.badge, background: event.immutable ? "#1c1917" : "#450a0a", color: event.immutable ? "#d6d3d1" : "#f87171", border: "1px solid #44403c" }}>
              <Icon name="lock" size={11} color={event.immutable ? "#d6d3d1" : "#f87171"} /> &nbsp;{event.immutable ? "IMMUTABLE" : "MUTABLE"}
            </span>
            {event.blockchain_hash && (
              <span style={{ ...styles.badge, background: "#1e3a5f", color: "#93c5fd", border: "1px solid #1e40af" }}>
                <Icon name="chain" size={11} color="#93c5fd" /> &nbsp;BLOCKCHAIN ANCHORED
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const InfoRow = ({ label, value, mono, badge, badgeColor, small }) => (
  <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
    <span style={{ color: "#64748b", fontSize: 11, letterSpacing: "0.06em", minWidth: 160, paddingTop: 2 }}>{label}</span>
    {badge
      ? <span style={{ ...styles.badge, background: badgeColor, color: "#e2e8f0" }}>{value}</span>
      : <span style={{ fontFamily: mono ? "monospace" : "inherit", fontSize: small ? 11 : 13, color: "#cbd5e1", wordBreak: "break-all" }}>{value}</span>
    }
  </div>
);

const StateBox = ({ label, state }) => (
  <div style={{ flex: 1, background: "#0a1120", borderRadius: 8, padding: 12, border: "1px solid #1e293b" }}>
    <div style={{ color: "#64748b", fontSize: 10, letterSpacing: "0.08em", marginBottom: 8 }}>{label}</div>
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {state && Object.entries(state).map(([k, v]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
          <span style={{ color: "#94a3b8" }}>{k}</span>
          <span style={{ fontFamily: "monospace", color: "#e2e8f0" }}>{v != null ? String(v) : "null"}</span>
        </div>
      ))}
    </div>
  </div>
);

// ─────────────────────────────────────────────
// MODULE 3: KILL-SWITCH APPROVAL DIALOG
// ─────────────────────────────────────────────
const KillSwitchApprovalDialog = ({ agent, onApprove, onCancel, newLogs, setNewLogs }) => {
  const [step, setStep] = useState("confirm"); // confirm | approved | signing | done
  const [enteredId, setEnteredId] = useState("");
  const [error, setError] = useState("");
  const [approvalEvent, setApprovalEvent] = useState(null);
  const [execEvent, setExecEvent] = useState(null);
  const csrf = useRef("csrf_" + Math.random().toString(36).slice(2));

  if (!agent) return null;

  const handleConfirm = () => {
    if (enteredId.trim() !== agent.id) {
      setError(`Agent ID mismatch. Please type "${agent.id}" exactly.`);
      return;
    }
    setStep("signing");

    // Simulate approval event creation
    setTimeout(() => {
      const preState = { entropy: agent.entropy, tokens_used: agent.tokens, status: agent.status };
      const postState = { entropy: agent.entropy, tokens_used: agent.tokens, status: "pending_kill" };
      const payload = JSON.stringify({ agent_id: agent.id, action: "approve_kill", pre: preState, post: postState, ts: new Date().toISOString() });
      const hash = simulateHash(payload);
      const sig = simulateRSASign(payload);
      const aEvt = {
        event_id: generateUUID(),
        timestamp: new Date().toISOString(),
        action: "approve_kill",
        agent_id: agent.id,
        session_id: "sess_" + Math.random().toString(36).slice(2, 10),
        triggered_by: MOCK_CURRENT_USER.email,
        user_role: MOCK_CURRENT_USER.role,
        pre_state: preState,
        post_state: postState,
        reason: "user_confirmed_kill",
        execution_status: "success",
        payload_hash: hash,
        signature: sig,
        signature_algorithm: "RSA-SHA256",
        signature_verified: true,
        immutable: true,
        blockchain_hash: null,
      };
      setApprovalEvent(aEvt);

      // Execution event
      setTimeout(() => {
        const preState2 = { entropy: agent.entropy, tokens_used: agent.tokens, status: "pending_kill" };
        const postState2 = { entropy: null, tokens_used: agent.tokens, status: "terminated" };
        const payload2 = JSON.stringify({ agent_id: agent.id, action: "kill_agent", approval_id: aEvt.event_id, ts: new Date().toISOString() });
        const hash2 = simulateHash(payload2);
        const sig2 = simulateRSASign(payload2);
        const eEvt = {
          event_id: generateUUID(),
          timestamp: new Date().toISOString(),
          action: "kill_agent",
          agent_id: agent.id,
          session_id: aEvt.session_id,
          triggered_by: MOCK_CURRENT_USER.email,
          user_role: MOCK_CURRENT_USER.role,
          pre_state: preState2,
          post_state: postState2,
          reason: "entropy_exceeded_threshold",
          execution_status: "success",
          payload_hash: hash2,
          signature: sig2,
          signature_algorithm: "RSA-SHA256",
          signature_verified: true,
          immutable: true,
          blockchain_hash: null,
          approval_event_id: aEvt.event_id,
        };
        setExecEvent(eEvt);
        setNewLogs((prev) => [eEvt, aEvt, ...prev]);
        setStep("done");
      }, 1200);
    }, 1000);
  };

  return (
    <div style={styles.overlay}>
      <div style={{ ...styles.modal, maxWidth: 540, border: "1px solid #7f1d1d" }}>
        {step === "confirm" && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#7f1d1d", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name="alert" size={20} color="#fca5a5" />
              </div>
              <div>
                <div style={{ color: "#fca5a5", fontWeight: 700, fontSize: 15 }}>KILL AGENT CONFIRMATION</div>
                <div style={{ color: "#94a3b8", fontSize: 12 }}>This action requires explicit approval and will be cryptographically logged.</div>
              </div>
            </div>

            {/* Evidence panel */}
            <div style={{ background: "#0a0f1e", border: "1px solid #1e293b", borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Metric label="Agent ID" value={agent.id} mono />
                <Metric label="Status" value={agent.status.toUpperCase()} color="#f59e0b" />
                <Metric label="Current Entropy" value={(agent.entropy * 100).toFixed(1) + "%"} color={entropyColor(agent.entropy)} />
                <Metric label="Tokens at Risk" value={agent.tokens.toLocaleString()} />
              </div>
              <div style={{ marginTop: 12 }}>
                <div style={{ color: "#64748b", fontSize: 10, marginBottom: 6 }}>ENTROPY LEVEL</div>
                <div style={{ height: 8, borderRadius: 4, background: "#1e293b", overflow: "hidden" }}>
                  <div style={{ width: `${agent.entropy * 100}%`, height: "100%", background: entropyColor(agent.entropy), borderRadius: 4, transition: "width 0.5s" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#475569", marginTop: 3 }}>
                  <span>0%</span><span style={{ color: "#f59e0b" }}>85% threshold</span><span>100%</span>
                </div>
              </div>
              <div style={{ marginTop: 12, padding: "8px 12px", background: "#450a0a", borderRadius: 6, border: "1px solid #7f1d1d" }}>
                <span style={{ color: "#fca5a5", fontSize: 12 }}>⚠ Loop detection evidence: Agent has exceeded entropy threshold for 3 consecutive cycles. Immediate termination recommended.</span>
              </div>
            </div>

            {/* Previous incidents */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: "#64748b", fontSize: 11, marginBottom: 8, letterSpacing: "0.06em" }}>PREVIOUS SIMILAR INCIDENTS</div>
              <div style={{ background: "#0a1120", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: "#94a3b8", border: "1px solid #1e293b" }}>
                <div>• 2026-02-14 — SIM_AGENT_07 killed at 94% entropy (success)</div>
                <div>• 2026-01-29 — SIM_AGENT_03 killed at 96% entropy (success)</div>
              </div>
            </div>

            {/* Confirmation input */}
            <div style={{ marginBottom: 8 }}>
              <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 6 }}>
                Type <span style={{ fontFamily: "monospace", color: "#f87171" }}>{agent.id}</span> to confirm:
              </label>
              <input
                value={enteredId}
                onChange={(e) => { setEnteredId(e.target.value); setError(""); }}
                placeholder={agent.id}
                style={{ ...styles.input, width: "100%", borderColor: error ? "#ef4444" : "#1e293b" }}
              />
              {error && <div style={{ color: "#f87171", fontSize: 11, marginTop: 4 }}>{error}</div>}
            </div>

            <input type="hidden" value={csrf.current} readOnly />
            <div style={{ color: "#475569", fontSize: 10, marginBottom: 16 }}>CSRF Token: {csrf.current.slice(0, 16)}… (anti-replay protection active)</div>

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={onCancel} style={{ ...styles.btnSecondary, flex: 1 }}>Cancel</button>
              <button onClick={handleConfirm} style={{ ...styles.btnDanger, flex: 1 }}>Confirm Kill Agent</button>
            </div>
          </>
        )}

        {step === "signing" && (
          <div style={{ textAlign: "center", padding: 32 }}>
            <div style={styles.spinner} />
            <div style={{ color: "#94a3b8", marginTop: 16 }}>Generating cryptographic signatures…</div>
            <div style={{ color: "#475569", fontSize: 12, marginTop: 8 }}>RSA-2048/SHA-256 · Writing to immutable log</div>
          </div>
        )}

        {step === "done" && approvalEvent && execEvent && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#052e16", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name="check" size={22} color="#4ade80" />
              </div>
              <div>
                <div style={{ color: "#4ade80", fontWeight: 700 }}>AGENT TERMINATED</div>
                <div style={{ color: "#94a3b8", fontSize: 12 }}>Two signed audit events created and persisted.</div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              <SignedEventSummary event={approvalEvent} label="Approval Event" />
              <SignedEventSummary event={execEvent} label="Execution Event" />
            </div>
            <button onClick={() => onApprove(agent.id)} style={styles.btnPrimary}>Close &amp; View Audit Log</button>
          </>
        )}
      </div>
    </div>
  );
};

const Metric = ({ label, value, mono, color }) => (
  <div>
    <div style={{ color: "#64748b", fontSize: 10, letterSpacing: "0.06em" }}>{label}</div>
    <div style={{ fontFamily: mono ? "monospace" : "inherit", fontSize: 14, fontWeight: 600, color: color || "#f1f5f9", marginTop: 2 }}>{value}</div>
  </div>
);

const SignedEventSummary = ({ event, label }) => (
  <div style={{ background: "#0a1120", borderRadius: 8, padding: 12, border: "1px solid #1e293b" }}>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
      <span style={{ color: "#60a5fa", fontSize: 12, fontWeight: 600 }}>{label}</span>
      <span style={{ ...styles.badge, background: "#052e16", color: "#4ade80", border: "1px solid #166534" }}>
        <Icon name="check" size={10} color="#4ade80" /> SIGNED
      </span>
    </div>
    <div style={{ fontFamily: "monospace", fontSize: 10, color: "#64748b", marginBottom: 4 }}>{event.event_id}</div>
    <div style={{ fontFamily: "monospace", fontSize: 10, color: "#7dd3fc", wordBreak: "break-all" }}>
      sig: {event.signature.slice(0, 40)}…
    </div>
  </div>
);

// ─────────────────────────────────────────────
// MODULE 4: COMPLIANCE DASHBOARD
// ─────────────────────────────────────────────
const ComplianceDashboard = () => {
  const statusConfig = {
    verified: { color: "#4ade80", bg: "#052e16", border: "#166534", label: "VERIFIED" },
    pending: { color: "#fbbf24", bg: "#451a03", border: "#92400e", label: "PENDING" },
    failed: { color: "#f87171", bg: "#450a0a", border: "#991b1b", label: "FAILED" },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Framework Cards */}
      <div>
        <SectionLabel icon="clipboard">Compliance Frameworks</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, marginTop: 12 }}>
          {COMPLIANCE_FRAMEWORKS.map((f) => {
            const cfg = statusConfig[f.status];
            return (
              <div key={f.id} style={{ background: "#0d1526", border: `1px solid ${cfg.border}`, borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9" }}>{f.name}</div>
                  <span style={{ ...styles.badge, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, fontSize: 10 }}>
                    {cfg.label}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>{f.scope}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  <div>
                    <div style={{ color: "#64748b", fontSize: 9, letterSpacing: "0.06em" }}>LAST AUDIT</div>
                    <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 2 }}>{f.lastAudit}</div>
                  </div>
                  <div>
                    <div style={{ color: "#64748b", fontSize: 9, letterSpacing: "0.06em" }}>NEXT AUDIT</div>
                    <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 2 }}>{f.nextAudit}</div>
                  </div>
                </div>
                {f.certNumber && (
                  <div style={{ marginTop: 10, padding: "4px 8px", background: "#0a1120", borderRadius: 5, fontFamily: "monospace", fontSize: 10, color: "#60a5fa" }}>
                    {f.certNumber}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Encryption Status */}
      <div>
        <SectionLabel icon="lock">Encryption & Security Status</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10, marginTop: 12 }}>
          {Object.entries(ENCRYPTION_STATUS).map(([key, val]) => (
            <div key={key} style={{ background: "#0d1526", borderRadius: 10, padding: 14, border: "1px solid #1e293b" }}>
              <div style={{ color: "#64748b", fontSize: 10, letterSpacing: "0.06em", marginBottom: 6 }}>{key.replace("_", " ").toUpperCase()}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: val.status === "enabled" ? "#4ade80" : "#ef4444" }} />
                <span style={{ color: val.status === "enabled" ? "#4ade80" : "#ef4444", fontSize: 12, fontWeight: 600 }}>{val.status.toUpperCase()}</span>
              </div>
              {Object.entries(val).filter(([k]) => k !== "status").map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                  <span style={{ color: "#64748b" }}>{k}</span>
                  <span style={{ color: "#94a3b8", fontFamily: "monospace" }}>{v}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Data Residency */}
      <div>
        <SectionLabel icon="globe">Data Residency</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          {DATA_RESIDENCY.map((r) => (
            <div key={r.region} style={{ display: "flex", alignItems: "center", gap: 16, background: "#0d1526", borderRadius: 8, padding: "12px 16px", border: "1px solid #1e293b" }}>
              <Icon name="globe" size={16} color="#60a5fa" />
              <div style={{ flex: 1 }}>
                <div style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 13 }}>{r.region}</div>
                <div style={{ color: "#64748b", fontSize: 11 }}>{r.dataTypes.join(", ")}</div>
              </div>
              <span style={{ ...styles.badge, background: r.status === "compliant" ? "#052e16" : "#451a03", color: r.status === "compliant" ? "#4ade80" : "#fbbf24", border: `1px solid ${r.status === "compliant" ? "#166534" : "#92400e"}` }}>
                {r.status.toUpperCase()}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Retention Policy */}
      <div style={{ background: "#0d1526", borderRadius: 12, padding: 18, border: "1px solid #1e293b" }}>
        <SectionLabel icon="database">Audit Log Retention Policy</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginTop: 14 }}>
          {[
            { label: "Retention Period", value: "7 years" },
            { label: "Storage Class", value: "Write-Once S3" },
            { label: "Tamper Detection", value: "Periodic Checksum" },
            { label: "Blockchain Anchor", value: "Planned v1.2" },
          ].map((item) => (
            <div key={item.label}>
              <div style={{ color: "#64748b", fontSize: 10, letterSpacing: "0.06em" }}>{item.label}</div>
              <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600, marginTop: 3 }}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// MODULE 5: RBAC MANAGER
// ─────────────────────────────────────────────
const RBACManager = () => {
  const [users, setUsers] = useState([
    { email: "frederic@kinetic.io", name: "Frederic Moreau", role: "admin" },
    { email: "aria@kinetic.io", name: "Aria Chen", role: "agent_owner" },
    { email: "sam@kinetic.io", name: "Sam Rivera", role: "audit_viewer" },
    { email: "dana@kinetic.io", name: "Dana Park", role: "compliance_officer" },
  ]);

  const rolePermissions = {
    admin: ["read_logs", "write_logs", "kill_agents", "manage_users", "compliance_reports", "key_rotation"],
    compliance_officer: ["read_logs", "compliance_reports", "export_logs"],
    audit_viewer: ["read_logs"],
    agent_owner: ["read_own_logs", "approve_own_kills"],
  };

  const roleColors = {
    admin: { color: "#c084fc", bg: "#3b0764", border: "#7c3aed" },
    compliance_officer: { color: "#60a5fa", bg: "#1e3a5f", border: "#1d4ed8" },
    audit_viewer: { color: "#4ade80", bg: "#052e16", border: "#166534" },
    agent_owner: { color: "#fbbf24", bg: "#451a03", border: "#92400e" },
  };

  const changeRole = (email, newRole) => {
    setUsers((u) => u.map((user) => user.email === email ? { ...user, role: newRole } : user));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Role Permission Matrix */}
      <div>
        <SectionLabel icon="user">Role Permissions Matrix</SectionLabel>
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table style={styles.table}>
            <thead>
              <tr style={styles.thead}>
                <th style={styles.th}>Permission</th>
                {ROLES.map((r) => <th key={r} style={styles.th}>{r}</th>)}
              </tr>
            </thead>
            <tbody>
              {["read_logs", "write_logs", "kill_agents", "manage_users", "compliance_reports", "export_logs", "read_own_logs", "approve_own_kills", "key_rotation"].map((perm, i) => (
                <tr key={perm} style={{ background: i % 2 === 0 ? "#0d1526" : "#0a1120" }}>
                  <td style={{ ...styles.td, fontFamily: "monospace", fontSize: 12 }}>{perm}</td>
                  {ROLES.map((role) => (
                    <td key={role} style={{ ...styles.td, textAlign: "center" }}>
                      {rolePermissions[role]?.includes(perm)
                        ? <span style={{ color: "#4ade80" }}>✓</span>
                        : <span style={{ color: "#374151" }}>—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* User Roles */}
      <div>
        <SectionLabel icon="user">User Role Assignments</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          {users.map((user) => {
            const cfg = roleColors[user.role];
            return (
              <div key={user.email} style={{ display: "flex", alignItems: "center", gap: 16, background: "#0d1526", borderRadius: 8, padding: "12px 16px", border: "1px solid #1e293b" }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#1e293b", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon name="user" size={18} color="#64748b" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 13 }}>{user.name}</div>
                  <div style={{ color: "#64748b", fontSize: 11 }}>{user.email}</div>
                </div>
                <select
                  value={user.role}
                  onChange={(e) => changeRole(user.email, e.target.value)}
                  style={{ ...styles.select, background: cfg.bg, color: cfg.color, borderColor: cfg.border }}
                >
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// MODULE 6: AGENT HEALTH / INTEGRATION
// ─────────────────────────────────────────────
const AgentHealthPanel = ({ onKillAgent }) => {
  return (
    <div>
      <SectionLabel icon="server">Live Agent Telemetry</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12, marginTop: 12 }}>
        {MOCK_AGENTS.map((agent) => (
          <AgentCard key={agent.id} agent={agent} onKill={() => onKillAgent(agent)} />
        ))}
      </div>
    </div>
  );
};

const AgentCard = ({ agent, onKill }) => {
  const ec = entropyColor(agent.entropy);
  const el = entropyLabel(agent.entropy);
  const isActive = agent.status === "active";

  return (
    <div style={{ background: "#0d1526", borderRadius: 12, padding: 16, border: `1px solid ${agent.entropy >= 0.85 ? "#7f1d1d" : "#1e293b"}`, transition: "border-color 0.3s" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>{agent.id}</div>
        <span style={{ ...styles.badge, background: isActive ? "#052e16" : "#1e293b", color: isActive ? "#4ade80" : "#64748b", fontSize: 10 }}>
          {agent.status.toUpperCase()}
        </span>
      </div>

      {agent.entropy !== null && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
            <span style={{ color: "#64748b", fontSize: 11 }}>Entropy</span>
            <span style={{ color: ec, fontSize: 11, fontWeight: 700 }}>{(agent.entropy * 100).toFixed(0)}% · {el}</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: "#1e293b", overflow: "hidden" }}>
            <div style={{ width: `${agent.entropy * 100}%`, height: "100%", background: ec, borderRadius: 3 }} />
          </div>
          {agent.entropy >= 0.85 && (
            <div style={{ marginTop: 6, fontSize: 11, color: "#fca5a5" }}>⚠ Kill threshold exceeded</div>
          )}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b", marginBottom: 14 }}>
        <span>Tokens</span>
        <span style={{ color: "#94a3b8" }}>{agent.tokens.toLocaleString()}</span>
      </div>

      {isActive && (
        <button
          onClick={onKill}
          disabled={!isActive}
          style={{ ...styles.btnDanger, width: "100%", fontSize: 12, padding: "7px 0", opacity: isActive ? 1 : 0.4 }}
        >
          <Icon name="x" size={13} /> Kill Agent
        </button>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────
// MODULE 7: DOCUMENTATION PANEL
// ─────────────────────────────────────────────
const DocumentationPanel = () => {
  const [expanded, setExpanded] = useState(null);
  const sections = [
    {
      id: "immutability",
      title: "Immutability Guarantees",
      icon: "lock",
      content: `Audit log entries are stored with write-once semantics enforced at the database level. PostgreSQL triggers reject any UPDATE or DELETE operations on the audit_log table. Application-level validation prevents in-memory modification. Periodic SHA-256 checksums validate log integrity. Optional blockchain anchoring (v1.2) will provide external tamper evidence.`,
    },
    {
      id: "crypto",
      title: "Cryptographic Verification",
      icon: "key",
      content: `All critical events are signed using RSA-2048/SHA-256. The private key is stored in AWS Secrets Manager and never leaves the server boundary. Signing occurs server-side immediately after event creation, before any database write. Deterministic JSON serialization (sorted keys, no whitespace) ensures consistent hashing. Key rotation is supported with backwards-compatible verification using the previous public key for historical events.`,
    },
    {
      id: "workflow",
      title: "Approval Workflow",
      icon: "clipboard",
      content: `Kill actions require explicit human approval. At 80% entropy threshold, a warning notification is sent to the agent owner. At 85% threshold, the confirmation dialog is displayed. The dialog cannot be bypassed via API or bulk operations. Two signed events are created per kill: an approval event and an execution event, cryptographically linked via the approval_event_id field. CSRF tokens prevent replay attacks.`,
    },
    {
      id: "rbac",
      title: "Role-Based Access Control",
      icon: "user",
      content: `Four roles govern access: admin (full access), compliance_officer (read logs + generate reports), audit_viewer (read-only log access), agent_owner (own agents only). Roles are enforced at both API (middleware) and UI (conditional rendering) layers. Unauthorized access returns HTTP 403. All role assignment changes are themselves audit-logged.`,
    },
    {
      id: "retention",
      title: "Retention & Compliance",
      icon: "database",
      content: `Audit logs are retained for a minimum of 7 years per compliance requirements. Logs are stored in a separate read replica to avoid operational DB performance impact. Bulk export is available in JSON and CSV formats for compliance teams. SOC 2 Type II, GDPR, and ISO 27001 certifications cover the audit subsystem. HIPAA certification is pending for v1.2.`,
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <SectionLabel icon="clipboard">Architecture & Compliance Documentation</SectionLabel>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {sections.map((s) => (
          <div key={s.id} style={{ background: "#0d1526", borderRadius: 10, border: "1px solid #1e293b", overflow: "hidden" }}>
            <button
              onClick={() => setExpanded(expanded === s.id ? null : s.id)}
              style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: "none", border: "none", cursor: "pointer", color: "#e2e8f0" }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 600, fontSize: 13 }}>
                <Icon name={s.icon} size={15} color="#60a5fa" /> {s.title}
              </span>
              <span style={{ color: "#475569", fontSize: 18 }}>{expanded === s.id ? "−" : "+"}</span>
            </button>
            {expanded === s.id && (
              <div style={{ padding: "0 16px 16px", color: "#94a3b8", fontSize: 13, lineHeight: 1.7, borderTop: "1px solid #1e293b", paddingTop: 14 }}>
                {s.content}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* API Reference */}
      <div style={{ background: "#0d1526", borderRadius: 10, padding: 16, border: "1px solid #1e293b", marginTop: 8 }}>
        <div style={{ color: "#60a5fa", fontWeight: 600, fontSize: 13, marginBottom: 12 }}>
          <Icon name="server" size={14} color="#60a5fa" /> API Endpoint Reference
        </div>
        {[
          { method: "GET", path: "/api/v1/audit-logs", desc: "Paginated audit log list (RBAC: audit_viewer+)" },
          { method: "GET", path: "/api/v1/audit-logs/:id", desc: "Single event with cryptographic proof" },
          { method: "POST", path: "/api/v1/audit-logs/export", desc: "Bulk export JSON/CSV (RBAC: compliance_officer+)" },
          { method: "GET", path: "/api/v1/audit-logs/:id/verify", desc: "Verify event signature integrity" },
          { method: "POST", path: "/api/v1/agents/:id/kill", desc: "Initiate kill with approval workflow" },
          { method: "GET", path: "/api/v1/compliance/status", desc: "Current compliance framework status" },
          { method: "POST", path: "/api/v1/crypto/rotate-keys", desc: "Initiate key rotation (RBAC: admin)" },
        ].map((ep) => (
          <div key={ep.path} style={{ display: "flex", gap: 12, padding: "6px 0", borderBottom: "1px solid #0f172a", alignItems: "center" }}>
            <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: ep.method === "GET" ? "#4ade80" : ep.method === "POST" ? "#60a5fa" : "#fbbf24", minWidth: 40 }}>
              {ep.method}
            </span>
            <span style={{ fontFamily: "monospace", fontSize: 12, color: "#e2e8f0", minWidth: 240 }}>{ep.path}</span>
            <span style={{ fontSize: 11, color: "#64748b" }}>{ep.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────
const SectionLabel = ({ icon, children }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#94a3b8", fontSize: 11, letterSpacing: "0.1em", fontWeight: 600 }}>
    <Icon name={icon} size={14} color="#60a5fa" />
    {children}
  </div>
);

// ─────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────
const styles = {
  select: {
    background: "#0d1526",
    border: "1px solid #1e293b",
    borderRadius: 6,
    color: "#e2e8f0",
    fontSize: 12,
    padding: "6px 10px",
    cursor: "pointer",
    outline: "none",
  },
  input: {
    background: "#0a1120",
    border: "1px solid #1e293b",
    borderRadius: 6,
    color: "#e2e8f0",
    fontSize: 13,
    padding: "7px 12px",
    outline: "none",
    fontFamily: "inherit",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  },
  thead: {
    background: "#0a1120",
  },
  th: {
    padding: "10px 14px",
    textAlign: "left",
    color: "#475569",
    fontSize: 10,
    letterSpacing: "0.08em",
    fontWeight: 600,
    borderBottom: "1px solid #1e293b",
    whiteSpace: "nowrap",
  },
  tr: {
    cursor: "pointer",
    transition: "background 0.15s",
  },
  td: {
    padding: "10px 14px",
    borderBottom: "1px solid #0f172a",
    color: "#e2e8f0",
    verticalAlign: "middle",
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    fontFamily: "monospace",
    whiteSpace: "nowrap",
  },
  btnPrimary: {
    background: "#2563eb",
    border: "none",
    borderRadius: 7,
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    padding: "9px 18px",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    justifyContent: "center",
  },
  btnSecondary: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: 7,
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: 500,
    padding: "7px 14px",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    justifyContent: "center",
  },
  btnDanger: {
    background: "#7f1d1d",
    border: "1px solid #991b1b",
    borderRadius: 7,
    color: "#fca5a5",
    fontSize: 13,
    fontWeight: 600,
    padding: "9px 18px",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    justifyContent: "center",
  },
  btnIcon: {
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 4,
    display: "flex",
    alignItems: "center",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.75)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
    backdropFilter: "blur(4px)",
  },
  modal: {
    background: "#0d1526",
    border: "1px solid #1e293b",
    borderRadius: 16,
    padding: 28,
    width: "100%",
    maxWidth: 640,
    maxHeight: "90vh",
    overflowY: "auto",
    boxShadow: "0 25px 60px rgba(0,0,0,0.6)",
  },
  divider: {
    height: 1,
    background: "#1e293b",
    margin: "4px 0",
  },
  stateGrid: {
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    gap: 8,
    alignItems: "center",
  },
  spinner: {
    width: 40,
    height: 40,
    border: "3px solid #1e293b",
    borderTop: "3px solid #3b82f6",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
    margin: "0 auto",
  },
};

// ─────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────
const TABS = [
  { id: "agents", label: "Agents", icon: "server", minRole: "agent_owner" },
  { id: "audit", label: "Audit Log", icon: "clipboard", minRole: "audit_viewer" },
  { id: "compliance", label: "Compliance", icon: "shield", minRole: "audit_viewer" },
  { id: "rbac", label: "Access Control", icon: "user", minRole: "admin" },
  { id: "docs", label: "Documentation", icon: "chain", minRole: "audit_viewer" },
];

const roleOrder = { admin: 4, compliance_officer: 3, audit_viewer: 2, agent_owner: 1 };
const canAccess = (userRole, minRole) => roleOrder[userRole] >= roleOrder[minRole];

export default function KineticEnterprise() {
  const [activeTab, setActiveTab] = useState("agents");
  const [currentUser, setCurrentUser] = useState(MOCK_CURRENT_USER);
  const [allLogs, setAllLogs] = useState(MOCK_AUDIT_LOGS);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [killTarget, setKillTarget] = useState(null);

  const handleKillAgent = (agent) => {
    setKillTarget(agent);
  };

  const handleApproveKill = (agentId) => {
    setKillTarget(null);
    setActiveTab("audit");
  };

  const accessibleTabs = TABS.filter((t) => canAccess(currentUser.role, t.minRole));

  return (
    <div style={{ background: "#060d1a", minHeight: "100vh", fontFamily: "'IBM Plex Mono', 'Fira Code', monospace", color: "#e2e8f0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #0a1120; }
        ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 3px; }
        select option { background: #0d1526; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>

      {/* HEADER */}
      <div style={{ background: "#08111f", borderBottom: "1px solid #1e293b", padding: "0 24px" }}>
        <div style={{ maxWidth: 1280, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
            {/* Logo */}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 32, height: 32, background: "linear-gradient(135deg, #1d4ed8, #7c3aed)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name="shield" size={18} color="#fff" />
              </div>
              <div>
                <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: 700, fontSize: 15, color: "#f1f5f9", letterSpacing: "0.02em" }}>KINETIC</div>
                <div style={{ fontSize: 9, color: "#475569", letterSpacing: "0.15em" }}>ENTERPRISE v1.1</div>
              </div>
            </div>

            {/* Stats bar */}
            <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
              {[
                { label: "AGENTS", value: MOCK_AGENTS.filter((a) => a.status === "active").length + " / " + MOCK_AGENTS.length, color: "#4ade80" },
                { label: "AUDIT EVENTS", value: allLogs.length, color: "#60a5fa" },
                { label: "COMPLIANCE", value: "3/4 ✓", color: "#a78bfa" },
              ].map((s) => (
                <div key={s.label} style={{ textAlign: "right" }}>
                  <div style={{ color: "#475569", fontSize: 9, letterSpacing: "0.1em" }}>{s.label}</div>
                  <div style={{ color: s.color, fontSize: 13, fontWeight: 700 }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* User selector */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600 }}>{currentUser.name}</div>
                <div style={{ color: "#475569", fontSize: 10 }}>{currentUser.role}</div>
              </div>
              <select
                value={currentUser.email}
                onChange={(e) => {
                  const users = [
                    { email: "frederic@kinetic.io", role: "admin", name: "Frederic Moreau" },
                    { email: "aria@kinetic.io", role: "agent_owner", name: "Aria Chen" },
                    { email: "sam@kinetic.io", role: "audit_viewer", name: "Sam Rivera" },
                    { email: "dana@kinetic.io", role: "compliance_officer", name: "Dana Park" },
                  ];
                  const u = users.find((u) => u.email === e.target.value);
                  if (u) { setCurrentUser(u); setActiveTab("agents"); }
                }}
                style={{ ...styles.select, fontSize: 11 }}
                title="Switch role (demo)"
              >
                <option value="frederic@kinetic.io">Admin View</option>
                <option value="dana@kinetic.io">Compliance Officer</option>
                <option value="sam@kinetic.io">Audit Viewer</option>
                <option value="aria@kinetic.io">Agent Owner</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Critical alert banner */}
      {MOCK_AGENTS.some((a) => a.entropy >= 0.85) && (
        <div style={{ background: "#450a0a", borderBottom: "1px solid #7f1d1d", padding: "8px 24px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", animation: "pulse 1s ease-in-out infinite" }} />
          <span style={{ color: "#fca5a5", fontSize: 12, fontWeight: 600 }}>
            CRITICAL: {MOCK_AGENTS.filter((a) => a.entropy >= 0.85).map((a) => a.id).join(", ")} — entropy threshold exceeded. Immediate action required.
          </span>
        </div>
      )}

      {/* TABS */}
      <div style={{ background: "#08111f", borderBottom: "1px solid #1e293b", padding: "0 24px" }}>
        <div style={{ maxWidth: 1280, margin: "0 auto", display: "flex", gap: 0 }}>
          {accessibleTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                background: "none",
                border: "none",
                borderBottom: activeTab === tab.id ? "2px solid #3b82f6" : "2px solid transparent",
                color: activeTab === tab.id ? "#60a5fa" : "#475569",
                fontSize: 12,
                fontWeight: 600,
                padding: "14px 18px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 7,
                letterSpacing: "0.05em",
                transition: "color 0.2s",
                fontFamily: "'IBM Plex Mono', monospace",
              }}
            >
              <Icon name={tab.icon} size={14} color={activeTab === tab.id ? "#60a5fa" : "#475569"} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 24px" }}>
        {activeTab === "agents" && (
          <AgentHealthPanel onKillAgent={handleKillAgent} />
        )}
        {activeTab === "audit" && canAccess(currentUser.role, "audit_viewer") && (
          <div>
            <SectionLabel icon="clipboard">Immutable Audit Log — {allLogs.length} signed events</SectionLabel>
            <div style={{ marginTop: 16 }}>
              <AuditLogViewer logs={allLogs} onSelectEvent={setSelectedEvent} />
            </div>
          </div>
        )}
        {activeTab === "compliance" && canAccess(currentUser.role, "audit_viewer") && (
          <ComplianceDashboard />
        )}
        {activeTab === "rbac" && canAccess(currentUser.role, "admin") && (
          <RBACManager />
        )}
        {activeTab === "docs" && canAccess(currentUser.role, "audit_viewer") && (
          <DocumentationPanel />
        )}

        {/* Access denied */}
        {!canAccess(currentUser.role, TABS.find((t) => t.id === activeTab)?.minRole || "agent_owner") && (
          <div style={{ textAlign: "center", padding: 60, color: "#475569" }}>
            <Icon name="lock" size={40} color="#1e293b" />
            <div style={{ marginTop: 16, fontSize: 16, fontWeight: 700, color: "#334155" }}>403 — Access Denied</div>
            <div style={{ marginTop: 8, fontSize: 13 }}>Your role ({currentUser.role}) does not have permission to view this section.</div>
          </div>
        )}
      </div>

      {/* MODALS */}
      {selectedEvent && (
        <EventDetailsModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
      {killTarget && (
        <KillSwitchApprovalDialog
          agent={killTarget}
          onApprove={handleApproveKill}
          onCancel={() => setKillTarget(null)}
          setNewLogs={setAllLogs}
        />
      )}
    </div>
  );
}
