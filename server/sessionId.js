import { randomBytes } from "node:crypto";

export function generateBotifySessionId() {
  const part1 = randomBytes(10).toString("hex");
  const part2 = randomBytes(8).toString("hex");
  return `BOTIFY-X=${part1}-${part2}`;
}

export function generateSocketSessionId() {
  return randomBytes(16).toString("hex");
}
