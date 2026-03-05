import { useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES & CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const DIALOG_STAGES = {
  EVIDENCE:   "EVIDENCE",
  CONFIRM:    "CONFIRM",
  SIGNING:    "SIGNING",
  SUCCESS:    "SUCCESS",
  ERROR:      "ERROR",
};

const MOCK_INCIDENTS = [
  { date: "2026-02-14", agent: "SIM_AGENT_07", entropy: "94%", outcome: "TERMINATED" },
  { date: "2026-01-29", agent: "SIM_AGENT_03", entropy: "96%", outcome: "TERMINATED" },
  { date: "2025-12-11", agent: "SIM_AGENT_11", entropy: "89%", outcome: "SAFE_MODE" },
];

const LOOP_EVIDENCE = [
  { cycle: 3, entropyDelta: "+0.04", tokenDelta: "+120", flag: "RECURSIVE_CALL_PATTERN" },
  { cycle: 2, entropyDelta: "+0.06", tokenDelta: "+145", flag: "CONTEXT_WINDOW_SATURATION" },
  { cycle: 1, entropyDelta: "+0.03", tokenDelta: "+98",  flag: "ENTROPY_THRESHOLD_WARNING" },
];

// ─────────────────────────────────────────────────────────────────────────────
// MOCK API CLIENT
// Simulates the backend calls described in the Kinetic v1.1 spec.
// Replace with real fetch/axios calls in production.
// ─────────────────────────────────────────────────────────────────────────────

const api = {
  initiateKill: async (agentId, preState) => {
    await new Promise(r => setTimeout(r, 600));
    return {
      approvalToken: Array.from({ length: 64 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join(""),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
  },

  confirmKill: async (agentId, approvalToken) => {
    await new Promise(r => setTimeout(r, 1800));
    if (Math.random() < 0.05) throw new Error("SIGNING_SERVICE_UNAVAILABLE");
    const makeId = (prefix) =>
      prefix + "_" + Array.from({ length: 32 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join("");
    const approvalId = makeId("evt");
    return {
      approvalEvent: {
        event_id:          approvalId,
        action:            "approve_kill",
        signature_verified: true,
        timestamp:         new Date().toISOString(),
      },
      executionEvent: {
        event_id:          makeId("evt"),
        action:            "kill_agent",
        approval_event_id: approvalId,
        signature_verified: true,
        timestamp:         new Date().toISOString(),
      },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

/** Pulsing status dot */
const StatusDot = ({ color = "red", pulse = true }) => (
  <span className="relative inline-flex h-2.5 w-2.5">
    {pulse && (
      <span
        className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60`}
        style={{ backgroundColor: color }}
      />
    )}
    <span
      className="relative inline-flex rounded-full h-2.5 w-2.5"
      style={{ backgroundColor: color }}
    />
  </span>
);

/** Monospace data label + value row */
const DataRow = ({ label, value, valueColor = "#e2e8f0", mono = true, tight = false }) => (
  <div className={`flex justify-between items-baseline ${tight ? "py-0.5" : "py-1"}`}>
    <span style={{ fontFamily: "monospace", fontSize: 11, color: "#64748b", letterSpacing: "0.08em" }}>
      {label}
    </span>
    <span
      style={{
        fontFamily: mono ? "monospace" : "'DM Sans', sans-serif",
        fontSize: mono ? 12 : 13,
        color: valueColor,
        fontWeight: 600,
      }}
    >
      {value}
    </span>
  </div>
);

/** Entropy bar with threshold markers */
const EntropyBar = ({ value }) => {
  const pct     = Math.round(value * 100);
  const isCrit  = value >= 0.85;
  const isWarn  = value >= 0.65;
  const barColor = isCrit ? "#ef4444" : isWarn ? "#f59e0b" : "#10b981";

  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <span style={{ fontFamily: "monospace", fontSize: 10, color: "#64748b", letterSpacing: "0.08em" }}>
          ENTROPY LEVEL
        </span>
        <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: barColor }}>
          {pct}%
          <span style={{ fontSize: 9, marginLeft: 6, color: "#94a3b8", fontWeight: 400 }}>
            {isCrit ? "CRITICAL" : isWarn ? "ELEVATED" : "NORMAL"}
          </span>
        </span>
      </div>

      {/* Track */}
      <div
        style={{
          position: "relative",
          height: 10,
          borderRadius: 3,
          background: "#0f172a",
          border: "1px solid #1e293b",
          overflow: "visible",
        }}
      >
        {/* Fill */}
        <div
          style={{
            position: "absolute",
            left: 0, top: 0, bottom: 0,
            width: `${pct}%`,
            borderRadius: 3,
            background: isCrit
              ? "linear-gradient(90deg, #7f1d1d, #ef4444)"
              : isWarn
              ? "linear-gradient(90deg, #78350f, #f59e0b)"
              : "#10b981",
            boxShadow: isCrit ? `0 0 8px ${barColor}55` : "none",
            transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)",
          }}
        />
        {/* 80% warning marker */}
        <div
          style={{
            position: "absolute",
            left: "80%",
            top: -3, bottom: -3,
            width: 1,
            background: "#f59e0b",
            opacity: 0.6,
          }}
        />
        {/* 85% kill marker */}
        <div
          style={{
            position: "absolute",
            left: "85%",
            top: -5, bottom: -5,
            width: 1,
            background: "#ef4444",
          }}
        />
      </div>

      <div className="flex justify-between mt-1">
        <span style={{ fontFamily: "monospace", fontSize: 9, color: "#334155" }}>0%</span>
        <span style={{ fontFamily: "monospace", fontSize: 9, color: "#78350f" }}>80% warn</span>
        <span style={{ fontFamily: "monospace", fontSize: 9, color: "#7f1d1d" }}>85% kill</span>
        <span style={{ fontFamily: "monospace", fontSize: 9, color: "#334155" }}>100%</span>
      </div>
    </div>
  );
};

/** Scrolling terminal log lines */
const TerminalLog = ({ lines, height = 96 }) => {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);

  return (
    <div
      ref={ref}
      style={{
        height,
        overflowY: "auto",
        background: "#020b12",
        border: "1px solid #0f2236",
        borderRadius: 6,
        padding: "8px 12px",
        fontFamily: "monospace",
        fontSize: 11,
        lineHeight: 1.7,
      }}
    >
      {lines.map((line, i) => (
        <div key={i} style={{ color: line.color || "#4ade80" }}>
          <span style={{ color: "#1e4d2b", userSelect: "none" }}>
            {String(i + 1).padStart(2, "0")} &gt;{" "}
          </span>
          {line.text}
        </div>
      ))}
      <div style={{ color: "#4ade80", animation: "blink 1s step-end infinite" }}>█</div>
    </div>
  );
};

/** Signed event receipt card */
const SignedEventCard = ({ event, label, index }) => (
  <div
    style={{
      background: "#020d0a",
      border: "1px solid #14532d",
      borderRadius: 8,
      padding: "12px 14px",
      animationDelay: `${index * 120}ms`,
    }}
    className="animate-fadeIn"
  >
    <div className="flex justify-between items-center mb-2">
      <span style={{ fontFamily: "monospace", fontSize: 10, color: "#4ade80", letterSpacing: "0.1em" }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: "monospace",
          fontSize: 9,
          background: "#052e16",
          color: "#4ade80",
          border: "1px solid #166534",
          borderRadius: 3,
          padding: "2px 7px",
          letterSpacing: "0.08em",
        }}
      >
        ✓ RSA-SHA256 SIGNED
      </span>
    </div>
    <div style={{ fontFamily: "monospace", fontSize: 10, color: "#1e4d2b", marginBottom: 3 }}>
      {event.event_id}
    </div>
    <div style={{ fontFamily: "monospace", fontSize: 10, color: "#166534", wordBreak: "break-all" }}>
      ts: {event.timestamp}
    </div>
    {event.approval_event_id && (
      <div style={{ fontFamily: "monospace", fontSize: 10, color: "#134e4a", marginTop: 2 }}>
        linked: {event.approval_event_id.slice(0, 24)}…
      </div>
    )}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// STAGE: EVIDENCE PANEL
// ─────────────────────────────────────────────────────────────────────────────

const EvidenceStage = ({ agent, onProceed, onCancel }) => {
  const [termLines, setTermLines] = useState([]);

  // Simulate loop detection log streaming in
  useEffect(() => {
    const lines = [
      { text: `AGENT ${agent.id} — LOOP DETECTION INITIATED`, color: "#f59e0b" },
      { text: `entropy_monitor: baseline 0.41 → current ${(agent.entropy).toFixed(2)}`, color: "#94a3b8" },
      { text: `cycle_3: recursive_call_depth=7, token_delta=+120`, color: "#f87171" },
      { text: `cycle_3: flag=RECURSIVE_CALL_PATTERN [SEVERITY: HIGH]`, color: "#ef4444" },
      { text: `cycle_2: context_saturation=0.94, token_delta=+145`, color: "#f87171" },
      { text: `cycle_1: entropy_threshold_warning triggered at 0.80`, color: "#f59e0b" },
      { text: `kill_switch: threshold=0.85 — EXCEEDED`, color: "#ef4444" },
      { text: `awaiting_human_approval…`, color: "#60a5fa" },
    ];
    let i = 0;
    const interval = setInterval(() => {
      if (i < lines.length) {
        setTermLines(prev => [...prev, lines[i++]]);
      } else {
        clearInterval(interval);
      }
    }, 220);
    return () => clearInterval(interval);
  }, [agent.id, agent.entropy]);

  return (
    <div>
      {/* Loop evidence table */}
      <div className="mb-4">
        <div
          style={{
            fontFamily: "monospace",
            fontSize: 10,
            color: "#64748b",
            letterSpacing: "0.12em",
            marginBottom: 8,
          }}
        >
          LOOP DETECTION EVIDENCE — LAST {LOOP_EVIDENCE.length} CYCLES
        </div>
        <div
          style={{
            border: "1px solid #1e293b",
            borderRadius: 6,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr 2fr",
              background: "#0a1120",
              padding: "6px 12px",
            }}
          >
            {["CYCLE", "Δ ENTROPY", "Δ TOKENS", "FLAG"].map(h => (
              <span
                key={h}
                style={{ fontFamily: "monospace", fontSize: 9, color: "#475569", letterSpacing: "0.1em" }}
              >
                {h}
              </span>
            ))}
          </div>
          {LOOP_EVIDENCE.map((row, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr 2fr",
                padding: "7px 12px",
                background: i % 2 === 0 ? "#060d1a" : "#080f1e",
                borderTop: "1px solid #0f172a",
              }}
            >
              <span style={{ fontFamily: "monospace", fontSize: 11, color: "#94a3b8" }}>
                {row.cycle}
              </span>
              <span style={{ fontFamily: "monospace", fontSize: 11, color: "#f87171" }}>
                {row.entropyDelta}
              </span>
              <span style={{ fontFamily: "monospace", fontSize: 11, color: "#f59e0b" }}>
                {row.tokenDelta}
              </span>
              <span
                style={{
                  fontFamily: "monospace",
                  fontSize: 9,
                  color: "#f87171",
                  background: "#2d0a0a",
                  borderRadius: 3,
                  padding: "1px 5px",
                  letterSpacing: "0.04em",
                  display: "inline-block",
                }}
              >
                {row.flag}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Terminal output */}
      <div className="mb-4">
        <div
          style={{
            fontFamily: "monospace",
            fontSize: 10,
            color: "#64748b",
            letterSpacing: "0.12em",
            marginBottom: 6,
          }}
        >
          SYSTEM LOG OUTPUT
        </div>
        <TerminalLog lines={termLines} height={108} />
      </div>

      {/* Prior incidents */}
      <div className="mb-5">
        <div
          style={{
            fontFamily: "monospace",
            fontSize: 10,
            color: "#64748b",
            letterSpacing: "0.12em",
            marginBottom: 8,
          }}
        >
          PRIOR INCIDENTS — SAME PATTERN
        </div>
        <div className="space-y-1.5">
          {MOCK_INCIDENTS.map((inc, i) => (
            <div
              key={i}
              className="flex justify-between items-center"
              style={{
                background: "#0a1120",
                border: "1px solid #1e293b",
                borderRadius: 5,
                padding: "6px 12px",
              }}
            >
              <span style={{ fontFamily: "monospace", fontSize: 11, color: "#64748b" }}>{inc.date}</span>
              <span style={{ fontFamily: "monospace", fontSize: 11, color: "#94a3b8" }}>{inc.agent}</span>
              <span style={{ fontFamily: "monospace", fontSize: 11, color: "#f87171" }}>{inc.entropy}</span>
              <span
                style={{
                  fontFamily: "monospace",
                  fontSize: 9,
                  color: "#4ade80",
                  background: "#052e16",
                  border: "1px solid #166534",
                  borderRadius: 3,
                  padding: "1px 6px",
                }}
              >
                {inc.outcome}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onCancel}
          style={{
            flex: 1,
            padding: "10px 0",
            background: "transparent",
            border: "1px solid #1e293b",
            borderRadius: 7,
            color: "#64748b",
            fontFamily: "monospace",
            fontSize: 12,
            letterSpacing: "0.08em",
            cursor: "pointer",
            transition: "all 0.15s",
          }}
          onMouseEnter={e => {
            e.target.style.borderColor = "#334155";
            e.target.style.color = "#94a3b8";
          }}
          onMouseLeave={e => {
            e.target.style.borderColor = "#1e293b";
            e.target.style.color = "#64748b";
          }}
        >
          DISMISS
        </button>
        <button
          onClick={onProceed}
          style={{
            flex: 2,
            padding: "10px 0",
            background: "linear-gradient(135deg, #7f1d1d, #991b1b)",
            border: "1px solid #dc2626",
            borderRadius: 7,
            color: "#fca5a5",
            fontFamily: "monospace",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.1em",
            cursor: "pointer",
            transition: "all 0.15s",
            boxShadow: "0 0 12px #ef444422",
          }}
          onMouseEnter={e => {
            e.target.style.boxShadow = "0 0 20px #ef444444";
            e.target.style.background = "linear-gradient(135deg, #991b1b, #b91c1c)";
          }}
          onMouseLeave={e => {
            e.target.style.boxShadow = "0 0 12px #ef444422";
            e.target.style.background = "linear-gradient(135deg, #7f1d1d, #991b1b)";
          }}
        >
          PROCEED TO CONFIRMATION →
        </button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// STAGE: CONFIRMATION
// ─────────────────────────────────────────────────────────────────────────────

const ConfirmStage = ({ agent, onConfirm, onBack, isLoading, error }) => {
  const [inputValue, setInputValue] = useState("");
  const [touched, setTouched]       = useState(false);
  const inputRef                    = useRef(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 80);
  }, []);

  const isMatch    = inputValue.trim() === agent.id;
  const showError  = touched && inputValue && !isMatch;

  const handleSubmit = () => {
    setTouched(true);
    if (isMatch) onConfirm();
  };

  const handleKey = (e) => {
    if (e.key === "Enter") handleSubmit();
  };

  return (
    <div>
      {/* Agent data grid */}
      <div
        style={{
          background: "#060d1a",
          border: "1px solid #1e293b",
          borderRadius: 10,
          padding: "16px 18px",
          marginBottom: 20,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "12px 24px",
          }}
        >
          <div>
            <DataRow label="AGENT ID" value={agent.id} valueColor="#f1f5f9" />
            <DataRow label="SESSION" value={agent.sessionId} valueColor="#94a3b8" />
            <DataRow label="OWNER" value={agent.owner} valueColor="#94a3b8" />
          </div>
          <div>
            <DataRow
              label="ENTROPY"
              value={`${Math.round(agent.entropy * 100)}%`}
              valueColor={agent.entropy >= 0.85 ? "#ef4444" : "#f59e0b"}
            />
            <DataRow
              label="TOKENS AT RISK"
              value={agent.tokens.toLocaleString()}
              valueColor="#fbbf24"
            />
            <DataRow label="KILL REASON" value="ENTROPY_THRESHOLD" valueColor="#f87171" />
          </div>
        </div>

        {/* Entropy bar */}
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #0f172a" }}>
          <EntropyBar value={agent.entropy} />
        </div>
      </div>

      {/* Warning statement */}
      <div
        style={{
          background: "#1c0505",
          border: "1px solid #7f1d1d",
          borderRadius: 8,
          padding: "12px 14px",
          marginBottom: 20,
        }}
      >
        <p style={{ fontFamily: "monospace", fontSize: 12, color: "#fca5a5", lineHeight: 1.7, margin: 0 }}>
          ⚠ This action will permanently terminate agent <strong>{agent.id}</strong>.
          {" "}The termination event will be cryptographically signed, immutably logged,
          and cannot be reversed. Both an approval event and an execution event will be
          written to the audit log and linked by cryptographic reference.
        </p>
      </div>

      {/* Agent ID confirmation input */}
      <div style={{ marginBottom: 6 }}>
        <label
          style={{
            fontFamily: "monospace",
            fontSize: 11,
            color: "#64748b",
            letterSpacing: "0.08em",
            display: "block",
            marginBottom: 8,
          }}
        >
          TYPE AGENT ID TO CONFIRM TERMINATION
        </label>
        <div style={{ position: "relative" }}>
          <input
            ref={inputRef}
            value={inputValue}
            onChange={e => { setInputValue(e.target.value); setTouched(true); }}
            onKeyDown={handleKey}
            placeholder={agent.id}
            spellCheck={false}
            autoComplete="off"
            style={{
              width: "100%",
              padding: "10px 14px",
              background: "#0a1120",
              border: `1px solid ${showError ? "#ef4444" : isMatch ? "#22c55e" : "#1e293b"}`,
              borderRadius: 7,
              fontFamily: "monospace",
              fontSize: 14,
              color: isMatch ? "#4ade80" : showError ? "#f87171" : "#e2e8f0",
              outline: "none",
              letterSpacing: "0.06em",
              transition: "border-color 0.2s, color 0.2s",
              boxSizing: "border-box",
              boxShadow: isMatch ? "0 0 8px #22c55e22" : showError ? "0 0 8px #ef444422" : "none",
            }}
          />
          {isMatch && (
            <span
              style={{
                position: "absolute",
                right: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: "#4ade80",
                fontFamily: "monospace",
                fontSize: 11,
              }}
            >
              ✓ MATCH
            </span>
          )}
        </div>
        {showError && (
          <p
            style={{
              fontFamily: "monospace",
              fontSize: 11,
              color: "#ef4444",
              margin: "5px 0 0",
            }}
          >
            Agent ID mismatch. Type exactly: {agent.id}
          </p>
        )}
      </div>

      {/* API error */}
      {error && (
        <div
          style={{
            background: "#1c0505",
            border: "1px solid #7f1d1d",
            borderRadius: 6,
            padding: "10px 12px",
            marginTop: 12,
            marginBottom: 4,
          }}
        >
          <span style={{ fontFamily: "monospace", fontSize: 11, color: "#f87171" }}>
            ERROR: {error}
          </span>
        </div>
      )}

      <div className="flex gap-3 mt-5">
        <button
          onClick={onBack}
          disabled={isLoading}
          style={{
            flex: 1,
            padding: "10px 0",
            background: "transparent",
            border: "1px solid #1e293b",
            borderRadius: 7,
            color: "#64748b",
            fontFamily: "monospace",
            fontSize: 12,
            letterSpacing: "0.08em",
            cursor: isLoading ? "not-allowed" : "pointer",
            opacity: isLoading ? 0.4 : 1,
          }}
        >
          ← BACK
        </button>
        <button
          onClick={handleSubmit}
          disabled={!isMatch || isLoading}
          style={{
            flex: 2,
            padding: "10px 0",
            background: !isMatch || isLoading
              ? "#1a0808"
              : "linear-gradient(135deg, #7f1d1d, #dc2626)",
            border: `1px solid ${!isMatch || isLoading ? "#2d1010" : "#ef4444"}`,
            borderRadius: 7,
            color: !isMatch || isLoading ? "#4b1515" : "#fca5a5",
            fontFamily: "monospace",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.1em",
            cursor: !isMatch || isLoading ? "not-allowed" : "pointer",
            transition: "all 0.2s",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          {isLoading ? (
            <>
              <span
                style={{
                  display: "inline-block",
                  width: 12,
                  height: 12,
                  border: "2px solid #7f1d1d",
                  borderTop: "2px solid #f87171",
                  borderRadius: "50%",
                  animation: "spin 0.7s linear infinite",
                }}
              />
              INITIATING…
            </>
          ) : (
            "CONFIRM KILL AGENT"
          )}
        </button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// STAGE: SIGNING / LOADING
// ─────────────────────────────────────────────────────────────────────────────

const SigningStage = () => {
  const [step, setStep] = useState(0);

  const steps = [
    { label: "Generating approval token…",         color: "#60a5fa" },
    { label: "Constructing canonical JSON payload…", color: "#60a5fa" },
    { label: "Computing SHA-256 payload hash…",    color: "#a78bfa" },
    { label: "Signing with RSA-2048/SHA-256…",     color: "#a78bfa" },
    { label: "Writing approval event to audit log…", color: "#4ade80" },
    { label: "Executing agent termination…",        color: "#f87171" },
    { label: "Signing execution event…",            color: "#a78bfa" },
    { label: "Linking approval → execution chain…", color: "#4ade80" },
  ];

  useEffect(() => {
    if (step >= steps.length) return;
    const t = setTimeout(() => setStep(s => s + 1), 220);
    return () => clearTimeout(t);
  }, [step]);

  return (
    <div style={{ padding: "12px 0" }}>
      <div className="flex flex-col items-center mb-8">
        {/* Animated ring */}
        <div style={{ position: "relative", width: 80, height: 80, marginBottom: 20 }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              border: "2px solid #1e293b",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              border: "2px solid transparent",
              borderTopColor: "#3b82f6",
              borderRightColor: "#8b5cf6",
              animation: "spin 1s linear infinite",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 8,
              borderRadius: "50%",
              border: "1px solid #1e293b",
              borderTopColor: "#ef4444",
              animation: "spin 0.6s linear infinite reverse",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "monospace",
              fontSize: 10,
              color: "#3b82f6",
              letterSpacing: "0.02em",
            }}
          >
            RSA
          </div>
        </div>
        <div style={{ fontFamily: "monospace", fontSize: 13, color: "#94a3b8", letterSpacing: "0.08em" }}>
          CRYPTOGRAPHIC SIGNING IN PROGRESS
        </div>
        <div style={{ fontFamily: "monospace", fontSize: 10, color: "#334155", marginTop: 4 }}>
          DO NOT CLOSE THIS WINDOW
        </div>
      </div>

      {/* Step progress */}
      <div className="space-y-2">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-3">
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: i < step ? "#052e16" : i === step ? "#1e3a5f" : "#0f172a",
                border: `1px solid ${i < step ? "#166534" : i === step ? "#1d4ed8" : "#1e293b"}`,
                transition: "all 0.3s",
              }}
            >
              {i < step ? (
                <span style={{ color: "#4ade80", fontSize: 9 }}>✓</span>
              ) : i === step ? (
                <span
                  style={{
                    display: "block",
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "#60a5fa",
                    animation: "pulse 0.8s ease-in-out infinite",
                  }}
                />
              ) : null}
            </div>
            <span
              style={{
                fontFamily: "monospace",
                fontSize: 11,
                color: i < step ? "#4ade80" : i === step ? "#60a5fa" : "#334155",
                transition: "color 0.3s",
              }}
            >
              {s.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// STAGE: SUCCESS
// ─────────────────────────────────────────────────────────────────────────────

const SuccessStage = ({ result, agent, onClose }) => (
  <div>
    {/* Hero */}
    <div className="flex flex-col items-center py-4 mb-6">
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: "50%",
          background: "radial-gradient(circle, #052e16, #020d0a)",
          border: "2px solid #16a34a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 16,
          boxShadow: "0 0 24px #16a34a33",
        }}
      >
        <span style={{ fontSize: 28 }}>✓</span>
      </div>
      <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 700, color: "#4ade80", letterSpacing: "0.08em" }}>
        AGENT TERMINATED
      </div>
      <div style={{ fontFamily: "monospace", fontSize: 11, color: "#334155", marginTop: 4 }}>
        {agent.id} — all processes halted
      </div>
    </div>

    {/* Signed events */}
    <div
      style={{
        fontFamily: "monospace",
        fontSize: 10,
        color: "#64748b",
        letterSpacing: "0.12em",
        marginBottom: 10,
      }}
    >
      CRYPTOGRAPHIC AUDIT TRAIL CREATED
    </div>
    <div className="space-y-2 mb-6">
      <SignedEventCard event={result.approvalEvent}  label="01 › APPROVAL EVENT"  index={0} />
      <SignedEventCard event={result.executionEvent} label="02 › EXECUTION EVENT" index={1} />
    </div>

    {/* Chain link indicator */}
    <div
      style={{
        background: "#0a1120",
        border: "1px solid #1e293b",
        borderRadius: 7,
        padding: "10px 14px",
        marginBottom: 20,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <span style={{ fontFamily: "monospace", fontSize: 10, color: "#475569" }}>
        CRYPTOGRAPHIC CHAIN VERIFIED
      </span>
      <span style={{ fontFamily: "monospace", fontSize: 10, color: "#4ade80" }}>
        ● IMMUTABLE · RSA-SHA256 · LINKED
      </span>
    </div>

    <button
      onClick={onClose}
      style={{
        width: "100%",
        padding: "11px 0",
        background: "#0d1526",
        border: "1px solid #1e293b",
        borderRadius: 7,
        color: "#94a3b8",
        fontFamily: "monospace",
        fontSize: 12,
        letterSpacing: "0.08em",
        cursor: "pointer",
      }}
    >
      CLOSE · VIEW AUDIT LOG
    </button>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT: KillSwitchApprovalDialog
// ─────────────────────────────────────────────────────────────────────────────

/**
 * KillSwitchApprovalDialog
 *
 * Full approval workflow for agent termination. Implements the three-stage
 * flow defined in the Kinetic v1.1 spec:
 *   1. EVIDENCE  — shows loop detection data and prior incidents
 *   2. CONFIRM   — requires agent ID entry + backend token issuance
 *   3. SIGNING   — displays RSA signing progress
 *   4. SUCCESS   — shows dual signed events and audit chain
 *
 * @param {Object}   props
 * @param {Object}   props.agent      - Agent object: { id, entropy, tokens, sessionId, owner }
 * @param {Function} props.onSuccess  - Called with { approvalEvent, executionEvent } on completion
 * @param {Function} props.onClose    - Called when dialog is dismissed
 * @param {boolean}  props.open       - Controls dialog visibility
 */
export function KillSwitchApprovalDialog({ agent, onSuccess, onClose, open }) {
  const [stage,    setStage]    = useState(DIALOG_STAGES.EVIDENCE);
  const [isLoading, setLoading] = useState(false);
  const [error,    setError]    = useState(null);
  const [result,   setResult]   = useState(null);
  const [token,    setToken]    = useState(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setStage(DIALOG_STAGES.EVIDENCE);
      setLoading(false);
      setError(null);
      setResult(null);
      setToken(null);
    }
  }, [open]);

  // Close on Escape key
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape" && stage !== DIALOG_STAGES.SIGNING) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [stage, onClose]);

  const handleProceedToConfirm = () => setStage(DIALOG_STAGES.CONFIRM);

  const handleConfirm = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Step 1: Get approval token from backend
      const { approvalToken } = await api.initiateKill(agent.id, {
        entropy:     agent.entropy,
        tokens_used: agent.tokens,
        status:      "active",
      });
      setToken(approvalToken);

      // Step 2: Show signing animation
      setStage(DIALOG_STAGES.SIGNING);

      // Step 3: Execute kill with approval token
      const killResult = await api.confirmKill(agent.id, approvalToken);
      setResult(killResult);
      setStage(DIALOG_STAGES.SUCCESS);
      onSuccess?.(killResult);
    } catch (err) {
      setError(err.message || "An unexpected error occurred. Please try again.");
      setStage(DIALOG_STAGES.CONFIRM);
    } finally {
      setLoading(false);
    }
  }, [agent, onSuccess]);

  if (!open || !agent) return null;

  const STAGE_TITLES = {
    [DIALOG_STAGES.EVIDENCE]: { title: "LOOP DETECTED",         sub: `Agent ${agent.id} has exceeded the entropy kill threshold` },
    [DIALOG_STAGES.CONFIRM]:  { title: "CONFIRM TERMINATION",   sub: "This action requires explicit human approval and will be audit-logged" },
    [DIALOG_STAGES.SIGNING]:  { title: "CREATING AUDIT RECORD", sub: "Cryptographic signing in progress — please wait" },
    [DIALOG_STAGES.SUCCESS]:  { title: "TERMINATION COMPLETE",  sub: "Agent has been halted and the audit chain has been sealed" },
    [DIALOG_STAGES.ERROR]:    { title: "ERROR",                  sub: "An error occurred during the termination process" },
  };

  const { title, sub } = STAGE_TITLES[stage];
  const isDestructive   = stage === DIALOG_STAGES.EVIDENCE || stage === DIALOG_STAGES.CONFIRM;
  const canClose        = stage !== DIALOG_STAGES.SIGNING;

  // Step indicator (1-based, visible for stages 1-3 only)
  const STAGE_ORDER = [DIALOG_STAGES.EVIDENCE, DIALOG_STAGES.CONFIRM, DIALOG_STAGES.SIGNING];
  const currentStep = STAGE_ORDER.indexOf(stage);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&display=swap');
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes blink   { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes fadeIn  { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes slideUp { from{opacity:0;transform:translateY(24px) scale(0.98)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes scanline{
          0%   { transform: translateY(-100%); }
          100% { transform: translateY(100vh); }
        }
        .animate-fadeIn  { animation: fadeIn  0.35s ease forwards; opacity: 0; }
        .animate-slideUp { animation: slideUp 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards; }
        .dialog-scroll::-webkit-scrollbar       { width: 4px; }
        .dialog-scroll::-webkit-scrollbar-track { background: #0a1120; }
        .dialog-scroll::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 2px; }
      `}</style>

      {/* Backdrop */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 50,
          background: "rgba(2, 6, 23, 0.88)",
          backdropFilter: "blur(6px) saturate(0.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}
        onClick={canClose ? onClose : undefined}
      >
        {/* Dialog */}
        <div
          className="animate-slideUp"
          style={{
            position: "relative",
            width: "100%",
            maxWidth: 520,
            maxHeight: "92vh",
            background: "#0a1120",
            borderRadius: 14,
            border: `1px solid ${isDestructive ? "#7f1d1d" : "#1e293b"}`,
            boxShadow: isDestructive
              ? "0 0 0 1px #7f1d1d22, 0 32px 80px -8px rgba(0,0,0,0.8), 0 0 60px #ef444411"
              : "0 0 0 1px #1e293b, 0 32px 80px -8px rgba(0,0,0,0.8)",
            overflow: "hidden",
            fontFamily: "'DM Mono', monospace",
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Scanline texture overlay */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.08) 2px, rgba(0,0,0,0.08) 4px)",
              pointerEvents: "none",
              zIndex: 0,
              borderRadius: 14,
            }}
          />

          {/* Critical stripe (top edge glow) */}
          {isDestructive && (
            <div
              style={{
                position: "absolute",
                top: 0, left: 0, right: 0,
                height: 2,
                background: "linear-gradient(90deg, transparent, #ef4444, #ef4444, transparent)",
                zIndex: 1,
              }}
            />
          )}

          {/* Header */}
          <div
            style={{
              position: "relative",
              zIndex: 1,
              padding: "18px 22px 16px",
              borderBottom: "1px solid #0f172a",
              background: isDestructive
                ? "linear-gradient(180deg, #1c0505 0%, transparent 100%)"
                : "transparent",
            }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <StatusDot color={isDestructive ? "#ef4444" : "#4ade80"} pulse={isDestructive} />
                <div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: isDestructive ? "#fca5a5" : "#f1f5f9",
                      letterSpacing: "0.08em",
                    }}
                  >
                    {title}
                  </div>
                  <div style={{ fontSize: 10, color: "#475569", marginTop: 2, letterSpacing: "0.04em" }}>
                    {sub}
                  </div>
                </div>
              </div>

              {canClose && (
                <button
                  onClick={onClose}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#334155",
                    cursor: "pointer",
                    padding: 4,
                    fontSize: 18,
                    lineHeight: 1,
                    flexShrink: 0,
                    transition: "color 0.15s",
                  }}
                  onMouseEnter={e => e.target.style.color = "#94a3b8"}
                  onMouseLeave={e => e.target.style.color = "#334155"}
                  aria-label="Close dialog"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Step progress indicator */}
            {currentStep >= 0 && (
              <div className="flex items-center gap-2 mt-4">
                {[0, 1, 2].map(i => (
                  <div key={i} className="flex items-center gap-2" style={{ flex: i < 2 ? "1" : "0" }}>
                    <div
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: "50%",
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 9,
                        fontFamily: "monospace",
                        background: i < currentStep ? "#052e16" : i === currentStep ? "#2d0a0a" : "#0a1120",
                        border: `1px solid ${i < currentStep ? "#166534" : i === currentStep ? "#7f1d1d" : "#1e293b"}`,
                        color: i < currentStep ? "#4ade80" : i === currentStep ? "#fca5a5" : "#334155",
                        transition: "all 0.3s",
                      }}
                    >
                      {i < currentStep ? "✓" : i + 1}
                    </div>
                    {i < 2 && (
                      <div
                        style={{
                          flex: 1,
                          height: 1,
                          background: i < currentStep ? "#166534" : "#0f172a",
                          transition: "background 0.3s",
                        }}
                      />
                    )}
                  </div>
                ))}
                <div style={{ marginLeft: 8, fontSize: 9, color: "#334155", letterSpacing: "0.06em" }}>
                  {["EVIDENCE", "CONFIRM", "SIGN"][currentStep]}
                </div>
              </div>
            )}
          </div>

          {/* Body */}
          <div
            className="dialog-scroll"
            style={{
              position: "relative",
              zIndex: 1,
              padding: "20px 22px",
              overflowY: "auto",
              maxHeight: "calc(92vh - 140px)",
            }}
          >
            {stage === DIALOG_STAGES.EVIDENCE && (
              <EvidenceStage
                agent={agent}
                onProceed={handleProceedToConfirm}
                onCancel={onClose}
              />
            )}
            {stage === DIALOG_STAGES.CONFIRM && (
              <ConfirmStage
                agent={agent}
                onConfirm={handleConfirm}
                onBack={() => setStage(DIALOG_STAGES.EVIDENCE)}
                isLoading={isLoading}
                error={error}
              />
            )}
            {stage === DIALOG_STAGES.SIGNING && <SigningStage />}
            {stage === DIALOG_STAGES.SUCCESS && (
              <SuccessStage result={result} agent={agent} onClose={onClose} />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DEMO / PREVIEW WRAPPER
// ─────────────────────────────────────────────────────────────────────────────

const DEMO_AGENTS = [
  {
    id: "SIM_AGENT_01",
    entropy: 0.95,
    tokens: 1500,
    sessionId: "sess_apkt748a",
    owner: "frederic@kinetic.io",
  },
  {
    id: "SIM_AGENT_04",
    entropy: 0.87,
    tokens: 820,
    sessionId: "sess_bqlu859b",
    owner: "aria@kinetic.io",
  },
];

export default function KillSwitchDemo() {
  const [open,          setOpen]    = useState(false);
  const [selectedAgent, setAgent]   = useState(DEMO_AGENTS[0]);
  const [lastResult,    setResult]  = useState(null);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#020b12",
        fontFamily: "'DM Mono', monospace",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        gap: 24,
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
        @keyframes spin  { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes fadeIn  { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes slideUp { from{opacity:0;transform:translateY(24px) scale(0.98)} to{opacity:1;transform:translateY(0) scale(1)} }
        .animate-fadeIn  { animation: fadeIn  0.35s ease forwards; opacity: 0; }
        .animate-slideUp { animation: slideUp 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards; }
        .dialog-scroll::-webkit-scrollbar       { width: 4px; }
        .dialog-scroll::-webkit-scrollbar-track { background: #0a1120; }
        .dialog-scroll::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 2px; }
      `}</style>

      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: "#334155", letterSpacing: "0.2em", marginBottom: 8 }}>
          KINETIC v1.1 · ENTERPRISE SECURITY
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#f1f5f9", letterSpacing: "0.04em" }}>
          Kill-Switch Approval Dialog
        </div>
        <div style={{ fontSize: 11, color: "#475569", marginTop: 6 }}>
          Select an agent and trigger the approval workflow
        </div>
      </div>

      {/* Agent selector cards */}
      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          justifyContent: "center",
          width: "100%",
          maxWidth: 560,
        }}
      >
        {DEMO_AGENTS.map(agent => {
          const isSelected = selectedAgent.id === agent.id;
          const ec = agent.entropy >= 0.85 ? "#ef4444" : "#f59e0b";
          return (
            <button
              key={agent.id}
              onClick={() => setAgent(agent)}
              style={{
                flex: "1 1 220px",
                padding: "14px 16px",
                background: isSelected ? "#0d1a2d" : "#060d1a",
                border: `1px solid ${isSelected ? "#1d4ed8" : "#1e293b"}`,
                borderRadius: 10,
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.15s",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9", marginBottom: 6 }}>
                {agent.id}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 10, color: "#64748b" }}>ENTROPY</span>
                <span style={{ fontSize: 11, color: ec, fontWeight: 700 }}>
                  {Math.round(agent.entropy * 100)}%
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                <span style={{ fontSize: 10, color: "#64748b" }}>TOKENS</span>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>
                  {agent.tokens.toLocaleString()}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Trigger button */}
      <button
        onClick={() => { setOpen(true); setResult(null); }}
        style={{
          padding: "13px 40px",
          background: "linear-gradient(135deg, #7f1d1d, #dc2626)",
          border: "1px solid #ef4444",
          borderRadius: 8,
          color: "#fca5a5",
          fontFamily: "'DM Mono', monospace",
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: "0.12em",
          cursor: "pointer",
          boxShadow: "0 0 24px #ef444433",
          transition: "all 0.2s",
        }}
        onMouseEnter={e => e.currentTarget.style.boxShadow = "0 0 36px #ef444455"}
        onMouseLeave={e => e.currentTarget.style.boxShadow = "0 0 24px #ef444433"}
      >
        ⚡ INITIATE KILL · {selectedAgent.id}
      </button>

      {/* Last result badge */}
      {lastResult && (
        <div
          style={{
            padding: "10px 18px",
            background: "#020d0a",
            border: "1px solid #14532d",
            borderRadius: 8,
            fontFamily: "monospace",
            fontSize: 11,
            color: "#4ade80",
            textAlign: "center",
          }}
        >
          ✓ Last operation: approval {lastResult.approvalEvent.event_id.slice(0, 20)}…
          <br />
          <span style={{ color: "#166534" }}>
            execution {lastResult.executionEvent.event_id.slice(0, 20)}…
          </span>
        </div>
      )}

      {/* The dialog */}
      <KillSwitchApprovalDialog
        open={open}
        agent={selectedAgent}
        onClose={() => setOpen(false)}
        onSuccess={(r) => { setResult(r); setTimeout(() => setOpen(false), 2800); }}
      />
    </div>
  );
}
