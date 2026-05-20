import { Browsers } from "@whiskeysockets/baileys";

export function getBrowserForServer(server) {
  switch (server) {
    case 1:
      return Browsers.macOS("Safari");
    case 2:
      return Browsers.ubuntu("Edge");
    case 3:
    default:
      return Browsers.ubuntu("Chrome");
  }
}
