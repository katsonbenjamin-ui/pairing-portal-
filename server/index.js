import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import {
  createSession,
  getSession,
  deleteSession,
  requestPhoneCode,
  initSocketIO,
} from "./sessionManager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const CLIENT_DIST = path.resolve(__dirname, "../client/dist");

const app = express();
const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: { origin: "*" },
  path: "/socket.io/",
});

initSocketIO(io);

app.use(cors({ origin: "*" }));
app.use(express.json());

io.on("connection", (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  socket.on("session:join", (sessionId) => {
    if (typeof sessionId === "string" && sessionId.length > 0) {
      socket.join(`session:${sessionId}`);
      console.log(`[Socket] ${socket.id} joined session:${sessionId}`);
    }
  });

  socket.on("session:leave", (sessionId) => {
    if (typeof sessionId === "string") {
      socket.leave(`session:${sessionId}`);
    }
  });

  socket.on("disconnect", (reason) => {
    console.log(`[Socket] Disconnected: ${socket.id} (${reason})`);
  });
});

app.post("/api/pairing/start", async (req, res) => {
  const { server, method } = req.body;

  if (![1, 2, 3].includes(server)) {
    return res.status(400).json({ error: "Invalid server. Must be 1, 2, or 3." });
  }
  if (!["qr", "phone"].includes(method)) {
    return res.status(400).json({ error: "Invalid method. Must be 'qr' or 'phone'." });
  }

  try {
    const sessionId = await createSession(server, method);
    res.json({ sessionId, method, server });
  } catch (err) {
    console.error("[API] Failed to start session:", err.message);
    res.status(500).json({ error: "Failed to start pairing session." });
  }
});

app.post("/api/pairing/:sessionId/phone", async (req, res) => {
  const { sessionId } = req.params;
  const { phone } = req.body;

  if (!phone || typeof phone !== "string") {
    return res.status(400).json({ error: "Phone number is required." });
  }

  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: "Session not found." });
  }

  try {
    const code = await requestPhoneCode(sessionId, phone);
    res.json({ code });
  } catch (err) {
    console.error(`[API] Phone code failed for ${sessionId}:`, err.message);
    res.status(500).json({ error: "Failed to generate pairing code." });
  }
});

app.get("/api/pairing/:sessionId/status", (req, res) => {
  const { sessionId } = req.params;
  const session = getSession(sessionId);

  if (!session) {
    return res.status(404).json({ error: "Session not found." });
  }

  res.json({
    status: session.status,
    qr: session.qr ?? null,
    generatedSessionId: session.generatedSessionId ?? null,
  });
});

app.delete("/api/pairing/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const deleted = deleteSession(sessionId);

  if (!deleted) {
    return res.status(404).json({ error: "Session not found." });
  }

  res.json({ success: true });
});

app.get("/api/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

if (existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, "index.html"));
  });
} else {
  app.get("/", (_req, res) => {
    res.json({ message: "BOTIFY X API running. Build the client first: npm run build" });
  });
}

httpServer.listen(PORT, () => {
  console.log(`[Server] BOTIFY X Pairing Portal running on port ${PORT}`);
});
