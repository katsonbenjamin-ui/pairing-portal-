import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import path from "node:path";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { getBrowserForServer } from "./fingerprints.js";
import { generateBotifySessionId, generateSocketSessionId } from "./sessionId.js";
import { savePairedSession } from "./db.js";

const AUTH_BASE = path.resolve(process.cwd(), "auth_sessions");
const SESSION_TIMEOUT_MS = 5 * 60 * 1000;

const sessions = new Map();
let io = null;

export function initSocketIO(ioServer) {
  io = ioServer;
}

function emitToSession(sessionId, event, data) {
  if (io) {
    io.to(`session:${sessionId}`).emit(event, data);
  }
}

function getAuthDir(sessionId) {
  const dir = path.join(AUTH_BASE, sessionId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function clearSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  if (session.timeoutHandle) {
    clearTimeout(session.timeoutHandle);
  }

  if (session.socket) {
    try {
      session.socket.end(undefined);
    } catch {}
  }

  sessions.delete(sessionId);
  console.log(`[Session] Cleared: ${sessionId}`);
}

export function getSession(sessionId) {
  return sessions.get(sessionId);
}

export function deleteSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return false;

  clearSession(sessionId);

  const authDir = path.join(AUTH_BASE, sessionId);
  if (existsSync(authDir)) {
    try {
      rmSync(authDir, { recursive: true, force: true });
    } catch {}
  }

  return true;
}

export async function createSession(server, method) {
  const sessionId = generateSocketSessionId();
  const authDir = getAuthDir(sessionId);

  const timeoutHandle = setTimeout(() => {
    const session = sessions.get(sessionId);
    if (session && session.status !== "connected") {
      console.warn(`[Session] Timed out: ${sessionId}`);
      if (session.socket) {
        session.status = "timeout";
        emitToSession(sessionId, "session:status", { status: "timeout" });
        clearSession(sessionId);
      }
    }
  }, SESSION_TIMEOUT_MS);

  const session = {
    id: sessionId,
    method,
    server,
    status: method === "qr" ? "waiting_qr" : "waiting_phone",
    qr: null,
    generatedSessionId: null,
    socket: null,
    authDir,
    createdAt: Date.now(),
    timeoutHandle,
  };

  sessions.set(sessionId, session);

  startBaileysSocket(session).catch((err) => {
    console.error(`[Session] Failed to start socket for ${sessionId}:`, err.message);
    const s = sessions.get(sessionId);
    if (s) {
      s.status = "failed";
      emitToSession(sessionId, "session:status", { status: "failed" });
    }
  });

  return sessionId;
}

async function startBaileysSocket(session) {
  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useMultiFileAuthState(session.authDir);
  const browser = getBrowserForServer(session.server);

  const sock = makeWASocket({
    version,
    auth: state,
    browser,
    printQRInTerminal: false,
    getMessage: async () => undefined,
    syncFullHistory: false,
    fireInitQueries: false,
    generateHighQualityLinkPreview: false,
    markOnlineOnConnect: false,
    logger: {
      level: "silent",
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: (msg) => console.warn("[Baileys]", msg),
      error: (msg) => console.error("[Baileys]", msg),
      fatal: (msg) => console.error("[Baileys Fatal]", msg),
      child: () => ({
        level: "silent",
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        fatal: () => {},
        child: () => this,
      }),
    },
  });

  session.socket = sock;
  sessions.set(session.id, session);

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && session.method === "qr") {
      session.qr = qr;
      session.status = "waiting_qr";
      emitToSession(session.id, "session:qr", { qr });
      console.log(`[Session] QR generated for ${session.id}`);
    }

    if (connection === "open") {
      session.status = "connected";
      session.qr = null;

      if (session.timeoutHandle) {
        clearTimeout(session.timeoutHandle);
        session.timeoutHandle = null;
      }

      const botifyId = generateBotifySessionId();
      session.generatedSessionId = botifyId;

      emitToSession(session.id, "session:connected", {
        generatedSessionId: botifyId,
      });

      console.log(`[Session] Connected: ${session.id}, ID: ${botifyId}`);

      // ── Persist credentials to Postgres ──────────────────────────────────
      // This is the key step: saves auth state to shared DB so Core can
      // restore the session after Railway restarts without re-pairing.
      try {
        await savePairedSession(botifyId, session.authDir);
        console.log(`[Session] Credentials saved to DB for ${botifyId}`);
      } catch (err) {
        console.error(`[Session] Failed to save credentials to DB for ${botifyId}:`, err.message);
        // Non-fatal: user still sees session ID and can use the bot
      }

      // Send session ID to user's WhatsApp
      try {
        const jid = sock.user?.id;
        if (jid) {
          await sock.sendMessage(jid, { text: "✅ *BOTIFY X — Connection Successful!*\n\nYour session ID is:" });
          await new Promise((r) => setTimeout(r, 1000));
          await sock.sendMessage(jid, { text: botifyId });
          await new Promise((r) => setTimeout(r, 500));
          await sock.sendMessage(jid, {
            text: "📋 Copy that ID and paste it in the *Client Panel* → Attach Session ID.\nThen click *Start* to activate your bot.",
          });
          console.log(`[Session] Session ID sent to user for ${session.id}`);
        }
      } catch (err) {
        console.error(`[Session] Failed to send message for ${session.id}:`, err.message);
      }
    }

    if (connection === "close") {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;

      console.log(`[Session] Connection closed for ${session.id}, reason: ${reason}`);

      if (
        shouldReconnect &&
        session.status !== "connected" &&
        session.status !== "timeout"
      ) {
        session.status = "connecting";
        emitToSession(session.id, "session:status", { status: "connecting" });
        await startBaileysSocket(session);
      } else if (reason === DisconnectReason.loggedOut) {
        session.status = "failed";
        emitToSession(session.id, "session:status", { status: "failed" });
        clearSession(session.id);
      }
    }
  });
}

export async function requestPhoneCode(sessionId, phone) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("Session not found");
  if (!session.socket) throw new Error("Socket not ready");
  if (session.method !== "phone") throw new Error("Not a phone pairing session");

  const cleanPhone = phone.replace(/\D/g, "");
  const code = await session.socket.requestPairingCode(cleanPhone);
  session.status = "connecting";
  emitToSession(sessionId, "session:status", { status: "connecting" });

  return code;
}

export function cleanupStaleSessions() {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (
      session.status !== "connected" &&
      now - session.createdAt > SESSION_TIMEOUT_MS
    ) {
      console.log(`[Session] Cleaning stale session: ${id}`);
      clearSession(id);
    }
  }
}

setInterval(cleanupStaleSessions, 60_000);
