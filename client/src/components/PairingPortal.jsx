import { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import { useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";

async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export function PairingPortal() {
  const [step, setStep] = useState("select");
  const [selectedServer, setSelectedServer] = useState(1);
  const [selectedMethod, setSelectedMethod] = useState("qr");
  const [sessionId, setSessionId] = useState(null);
  const [qrCode, setQrCode] = useState(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [pairingCode, setPairingCode] = useState(null);
  const [generatedSessionId, setGeneratedSessionId] = useState(null);
  const [statusText, setStatusText] = useState("Initializing...");
  const [toast, setToast] = useState(null);
  const socketRef = useRef(null);

  const showToast = (msg, type = "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const startSession = useMutation({
    mutationFn: (data) =>
      apiFetch("/api/pairing/start", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: (data) => {
      setSessionId(data.sessionId);
      setStep("pairing");
      setStatusText(selectedMethod === "qr" ? "Waiting for QR Code..." : "Enter your phone number");
    },
    onError: () => showToast("Could not start pairing session. Please try again."),
  });

  const requestCode = useMutation({
    mutationFn: ({ sessionId, phone }) =>
      apiFetch(`/api/pairing/${sessionId}/phone`, {
        method: "POST",
        body: JSON.stringify({ phone }),
      }),
    onSuccess: (data) => {
      setPairingCode(data.code);
      setStatusText("Enter this code in WhatsApp");
    },
    onError: () => {
      showToast("Could not request pairing code. Check the number.");
      setStatusText("Failed. Try again.");
    },
  });

  const deleteSession = useMutation({
    mutationFn: (sid) =>
      apiFetch(`/api/pairing/${sid}`, { method: "DELETE" }),
  });

  const handleReset = () => {
    if (sessionId) deleteSession.mutate(sessionId);
    if (socketRef.current) socketRef.current.disconnect();
    setStep("select");
    setSessionId(null);
    setQrCode(null);
    setPairingCode(null);
    setGeneratedSessionId(null);
    setPhoneNumber("");
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Copied to clipboard!", "success");
    } catch {}
  };

  useEffect(() => {
    if (step === "pairing" && sessionId) {
      const socket = io({ path: "/socket.io/", transports: ["websocket", "polling"] });
      socketRef.current = socket;

      socket.on("connect", () => socket.emit("session:join", sessionId));

      socket.on("session:qr", ({ qr }) => {
        setQrCode(qr);
        setStatusText("Scan QR code with WhatsApp");
      });

      socket.on("session:status", ({ status }) => {
        if (status === "connecting") setStatusText("Connecting device...");
        if (status === "timeout") {
          showToast("Session timed out. Please try again.");
          handleReset();
        }
        if (status === "failed") {
          showToast("Connection failed. Please try again.");
          handleReset();
        }
      });

      socket.on("session:connected", ({ generatedSessionId }) => {
        setGeneratedSessionId(generatedSessionId);
        setStep("success");
      });

      return () => socket.disconnect();
    }
  }, [step, sessionId]);

  return (
    <div
      style={{ background: "#080810", minHeight: "100dvh" }}
      className="flex flex-col items-center justify-center text-slate-100 relative overflow-hidden font-sans"
    >
      {/* Background glows */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          style={{
            position: "absolute", top: "15%", left: "15%",
            width: 600, height: 600,
            background: "radial-gradient(circle, rgba(139,92,246,0.15) 0%, transparent 70%)",
            filter: "blur(40px)", animation: "pulse-glow 4s ease-in-out infinite",
          }}
        />
        <div
          style={{
            position: "absolute", bottom: "15%", right: "15%",
            width: 400, height: 400,
            background: "radial-gradient(circle, rgba(6,182,212,0.08) 0%, transparent 70%)",
            filter: "blur(40px)",
          }}
        />
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            style={{
              position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
              background: toast.type === "success" ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
              border: `1px solid ${toast.type === "success" ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`,
              padding: "12px 24px", borderRadius: 12, color: "#fff", zIndex: 100,
              backdropFilter: "blur(10px)", fontSize: 14,
            }}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="z-10 w-full max-w-md px-4 py-8">
        {/* Logo */}
        <div className="text-center mb-10">
          <div style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 64, height: 64, borderRadius: 16,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "0 0 30px rgba(139,92,246,0.3)",
            marginBottom: 16,
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(167,139,250,1)" strokeWidth="2">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
          <h1 style={{
            fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em",
            background: "linear-gradient(135deg, #fff 0%, #c4b5fd 100%)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            filter: "drop-shadow(0 0 20px rgba(139,92,246,0.4))",
          }}>BOTIFY X</h1>
          <p style={{ color: "rgba(196,181,253,0.5)", fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", marginTop: 6 }}>
            WhatsApp Pairing Portal
          </p>
        </div>

        <AnimatePresence mode="wait">
          {/* STEP 1: Select */}
          {step === "select" && (
            <motion.div
              key="select"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              style={{
                background: "rgba(18,18,26,0.85)",
                backdropFilter: "blur(20px)",
                border: "1px solid rgba(139,92,246,0.2)",
                borderRadius: 24,
                padding: 28,
                boxShadow: "0 20px 60px rgba(139,92,246,0.1)",
              }}
            >
              {/* Server selector */}
              <div style={{ marginBottom: 24 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "rgba(196,181,253,0.6)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 12 }}>
                  Target Server
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  {[1, 2, 3].map((s) => (
                    <button
                      key={s}
                      data-testid={`button-server-${s}`}
                      onClick={() => setSelectedServer(s)}
                      style={{
                        padding: "14px 8px",
                        borderRadius: 14,
                        border: selectedServer === s ? "1px solid rgba(139,92,246,0.7)" : "1px solid rgba(255,255,255,0.08)",
                        background: selectedServer === s ? "rgba(139,92,246,0.15)" : "rgba(255,255,255,0.04)",
                        color: selectedServer === s ? "#e9d5ff" : "#94a3b8",
                        cursor: "pointer",
                        display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                        transition: "all 0.2s",
                        boxShadow: selectedServer === s ? "0 0 20px rgba(139,92,246,0.25)" : "none",
                      }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                        <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                        <line x1="6" y1="6" x2="6.01" y2="6" />
                        <line x1="6" y1="18" x2="6.01" y2="18" />
                      </svg>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>Server {s}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Method selector */}
              <div style={{ marginBottom: 28 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "rgba(196,181,253,0.6)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 12 }}>
                  Connection Protocol
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {[
                    { value: "qr", label: "QR Code", icon: (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="5" height="5" /><rect x="16" y="3" width="5" height="5" />
                        <rect x="3" y="16" width="5" height="5" /><path d="M21 16h-3a2 2 0 0 0-2 2v3" />
                        <path d="M21 21v.01" /><path d="M12 7v3a2 2 0 0 1-2 2H7" />
                        <path d="M3 12h.01" /><path d="M12 3h.01" /><path d="M12 16v.01" /><path d="M16 12h1" />
                      </svg>
                    )},
                    { value: "phone", label: "Phone Number", icon: (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                        <line x1="12" y1="18" x2="12.01" y2="18" />
                      </svg>
                    )},
                  ].map(({ value, label, icon }) => (
                    <button
                      key={value}
                      data-testid={`button-method-${value}`}
                      onClick={() => setSelectedMethod(value)}
                      style={{
                        padding: "18px 12px",
                        borderRadius: 14,
                        border: selectedMethod === value ? "1px solid rgba(139,92,246,0.7)" : "1px solid rgba(255,255,255,0.08)",
                        background: selectedMethod === value ? "rgba(139,92,246,0.15)" : "rgba(255,255,255,0.04)",
                        color: selectedMethod === value ? "#e9d5ff" : "#94a3b8",
                        cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                        transition: "all 0.2s",
                        boxShadow: selectedMethod === value ? "0 0 20px rgba(139,92,246,0.25)" : "none",
                      }}
                    >
                      {icon}
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <button
                data-testid="button-start-pairing"
                onClick={() => startSession.mutate({ server: selectedServer, method: selectedMethod })}
                disabled={startSession.isPending}
                style={{
                  width: "100%", padding: "16px", borderRadius: 14,
                  background: "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)",
                  border: "none", color: "#fff", fontWeight: 700, fontSize: 14,
                  letterSpacing: "0.05em", cursor: "pointer",
                  boxShadow: "0 0 30px rgba(139,92,246,0.4)",
                  transition: "all 0.2s", opacity: startSession.isPending ? 0.6 : 1,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}
              >
                {startSession.isPending ? (
                  <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>...</span>
                ) : "INITIALIZE UPLINK"}
              </button>
            </motion.div>
          )}

          {/* STEP 2: Pairing */}
          {step === "pairing" && (
            <motion.div
              key="pairing"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.04 }}
              style={{
                background: "rgba(18,18,26,0.85)",
                backdropFilter: "blur(20px)",
                border: "1px solid rgba(139,92,246,0.2)",
                borderRadius: 24,
                padding: 32,
                boxShadow: "0 20px 60px rgba(139,92,246,0.1)",
                display: "flex", flexDirection: "column", alignItems: "center",
              }}
            >
              <div style={{ textAlign: "center", marginBottom: 24, width: "100%" }}>
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "6px 16px", borderRadius: 999,
                  background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.2)",
                  color: "#c4b5fd", fontSize: 12, fontFamily: "Space Mono, monospace",
                }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: "#8b5cf6", animation: "pulse-glow 1.5s ease-in-out infinite",
                  }} />
                  {statusText}
                </div>
              </div>

              {selectedMethod === "qr" && (
                <div style={{
                  width: 256, height: 256,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 20,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  position: "relative", overflow: "hidden",
                }}>
                  {!qrCode ? (
                    <div style={{ textAlign: "center", color: "rgba(139,92,246,0.5)" }}>
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ animation: "pulse-glow 2s ease-in-out infinite" }}>
                        <rect x="3" y="3" width="5" height="5" /><rect x="16" y="3" width="5" height="5" />
                        <rect x="3" y="16" width="5" height="5" /><path d="M21 16h-3a2 2 0 0 0-2 2v3" />
                        <path d="M21 21v.01" /><path d="M12 7v3a2 2 0 0 1-2 2H7" />
                      </svg>
                      <p style={{ marginTop: 12, fontSize: 13 }}>Generating QR...</p>
                    </div>
                  ) : (
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qrCode)}&size=240x240&color=ffffff&bgcolor=080810`}
                      alt="WhatsApp Pairing QR Code"
                      style={{ width: 220, height: 220, borderRadius: 12 }}
                    />
                  )}
                  <div style={{
                    position: "absolute", inset: 0,
                    background: "linear-gradient(to bottom, transparent, rgba(139,92,246,0.1), transparent)",
                    height: 4, animation: "scan 2.5s ease-in-out infinite",
                    pointerEvents: "none",
                  }} />
                </div>
              )}

              {selectedMethod === "phone" && (
                <div style={{ width: "100%" }}>
                  {!pairingCode ? (
                    <form onSubmit={(e) => { e.preventDefault(); if (sessionId && phoneNumber) requestCode.mutate({ sessionId, phone: phoneNumber }); }}>
                      <input
                        data-testid="input-phone"
                        type="tel"
                        placeholder="+1 234 567 8900"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        style={{
                          width: "100%", padding: "14px 16px",
                          background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)",
                          borderRadius: 14, color: "#fff", fontSize: 18,
                          fontFamily: "Space Mono, monospace", textAlign: "center",
                          outline: "none", marginBottom: 12, transition: "border-color 0.2s",
                        }}
                        onFocus={(e) => e.target.style.borderColor = "rgba(139,92,246,0.6)"}
                        onBlur={(e) => e.target.style.borderColor = "rgba(255,255,255,0.1)"}
                      />
                      <button
                        type="submit"
                        data-testid="button-request-code"
                        disabled={requestCode.isPending || !phoneNumber}
                        style={{
                          width: "100%", padding: "13px",
                          borderRadius: 14, border: "1px solid rgba(139,92,246,0.5)",
                          background: "rgba(139,92,246,0.15)", color: "#c4b5fd",
                          fontWeight: 600, cursor: "pointer",
                          opacity: (requestCode.isPending || !phoneNumber) ? 0.5 : 1,
                          transition: "all 0.2s",
                        }}
                      >
                        {requestCode.isPending ? "Requesting..." : "Request Code"}
                      </button>
                    </form>
                  ) : (
                    <div style={{ textAlign: "center" }}>
                      <div style={{
                        background: "rgba(0,0,0,0.5)", border: "1px solid rgba(139,92,246,0.3)",
                        borderRadius: 16, padding: "28px 24px", marginBottom: 16,
                      }}>
                        <div style={{
                          fontSize: 40, fontFamily: "Space Mono, monospace",
                          fontWeight: 700, letterSpacing: "0.2em", color: "#fff",
                          textShadow: "0 0 20px rgba(255,255,255,0.3)",
                        }}>
                          {pairingCode}
                        </div>
                      </div>
                      <p style={{ color: "#94a3b8", fontSize: 13 }}>
                        Enter this code in WhatsApp to complete pairing
                      </p>
                    </div>
                  )}
                </div>
              )}

              <button
                data-testid="button-cancel-pairing"
                onClick={handleReset}
                style={{
                  marginTop: 28, background: "none", border: "none",
                  color: "#64748b", fontSize: 13, cursor: "pointer",
                  transition: "color 0.2s",
                }}
                onMouseEnter={(e) => e.target.style.color = "#e2e8f0"}
                onMouseLeave={(e) => e.target.style.color = "#64748b"}
              >
                Abort Session
              </button>
            </motion.div>
          )}

          {/* STEP 3: Success */}
          {step === "success" && generatedSessionId && (
            <motion.div
              key="success"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                background: "rgba(18,18,26,0.85)",
                backdropFilter: "blur(20px)",
                border: "1px solid rgba(34,197,94,0.2)",
                borderRadius: 24,
                padding: 32,
                boxShadow: "0 20px 60px rgba(34,197,94,0.08)",
                textAlign: "center",
              }}
            >
              <div style={{
                width: 64, height: 64, borderRadius: "50%",
                background: "rgba(34,197,94,0.15)",
                border: "1px solid rgba(34,197,94,0.3)",
                boxShadow: "0 0 30px rgba(34,197,94,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 auto 20px",
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>

              <h2 style={{ fontSize: 22, fontWeight: 700, color: "#fff", marginBottom: 8 }}>
                Connection Established
              </h2>
              <p style={{ color: "#94a3b8", fontSize: 14, marginBottom: 28 }}>
                Your session identity has been securely generated.
              </p>

              <div style={{
                background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 14, padding: "16px 20px", marginBottom: 28,
                display: "flex", alignItems: "center", gap: 12, textAlign: "left",
              }}>
                <span style={{
                  fontFamily: "Space Mono, monospace", fontSize: 12,
                  color: "#c4b5fd", flex: 1, wordBreak: "break-all",
                }}>
                  {generatedSessionId}
                </span>
                <button
                  data-testid="button-copy-session"
                  onClick={() => copyToClipboard(generatedSessionId)}
                  title="Copy to clipboard"
                  style={{
                    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 10, padding: 10, cursor: "pointer", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "background 0.2s",
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.1)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </button>
              </div>

              <button
                data-testid="button-new-session"
                onClick={handleReset}
                style={{
                  width: "100%", padding: "14px",
                  borderRadius: 14, border: "1px solid rgba(255,255,255,0.1)",
                  background: "rgba(255,255,255,0.04)", color: "#e2e8f0",
                  fontWeight: 600, cursor: "pointer", fontSize: 14,
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.08)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
              >
                Start New Session
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <p style={{ textAlign: "center", marginTop: 24, color: "rgba(100,116,139,0.5)", fontSize: 11 }}>
          BOTIFY X &copy; {new Date().getFullYear()} — Secure WhatsApp Pairing
        </p>
      </div>
    </div>
  );
}
