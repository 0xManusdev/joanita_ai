// Historique des discussions, enregistré dans le navigateur (localStorage).
// Pas de compte ni de base de données : chaque navigateur garde ses propres discussions.

const KEY = "joanita-conversations";
const MAX_CONVERSATIONS = 50;

export const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function loadConversations() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (!Array.isArray(list)) return [];
    // Une recherche interrompue (page fermée avant la fin) ne doit pas rester affichée « en cours »
    return list.map((c) => ({
      ...c,
      messages: (c.messages || []).map((m) =>
        m.role === "assistant" && !m.done
          ? { ...m, done: true, error: !m.content, content: m.content || "Recherche interrompue : la page a été fermée avant la fin." }
          : m),
    }));
  } catch {
    return []; // stockage indisponible (navigation privée…) ou données illisibles : on repart de zéro
  }
}

export function saveConversations(list) {
  let toSave = list.slice(0, MAX_CONVERSATIONS);
  while (toSave.length) {
    try { localStorage.setItem(KEY, JSON.stringify(toSave)); return; }
    catch { toSave = toSave.slice(0, -1); } // stockage plein : on oublie les discussions les plus anciennes
  }
  try { localStorage.removeItem(KEY); } catch { /* stockage indisponible */ }
}

// Regroupe les discussions par date de dernière activité, comme dans Gemini ou ChatGPT
export function groupByDate(list) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t = today.getTime(), day = 86_400_000;
  const groups = [["Aujourd'hui", []], ["Hier", []], ["7 derniers jours", []], ["Plus anciennes", []]];
  for (const c of list) {
    const u = c.updatedAt || 0;
    groups[u >= t ? 0 : u >= t - day ? 1 : u >= t - 7 * day ? 2 : 3][1].push(c);
  }
  return groups.filter(([, items]) => items.length);
}
