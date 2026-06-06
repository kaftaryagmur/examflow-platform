import { sessionKey } from "../config/appConfig";

export function readStoredSession() {
  const raw = window.localStorage.getItem(sessionKey);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    window.localStorage.removeItem(sessionKey);
    return null;
  }
}
