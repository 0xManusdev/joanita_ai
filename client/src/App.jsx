import { useEffect, useRef, useState } from "react";
import ModelPicker, { modelName } from "./ModelPicker.jsx";
import Markdown, { citedNumbers } from "./Markdown.jsx";
import Sidebar from "./Sidebar.jsx";
import { loadConversations, saveConversations, newId } from "./history.js";

// L'URL de l'API est injectée AU MOMENT DU BUILD (Vercel) : changer la variable impose un redéploiement.
const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/$/, "");

const HAS_MOUSE = typeof window !== "undefined" && window.matchMedia?.("(pointer: fine)").matches;

const SUGGESTIONS = [
  "Je prépare un exposé sur l'énergie solaire en Afrique",
  "L'intelligence artificielle dans la santé",
  "Les causes de la Première Guerre mondiale",
  "La désertification au Sahel",
];

export default function App() {
  // Toutes les discussions (la plus récente en premier), enregistrées dans le navigateur
  const [conversations, setConversations] = useState(loadConversations);
  const [activeId, setActiveId] = useState(null); // null = nouvelle discussion, pas encore commencée
  const [pending, setPending] = useState(() => new Set()); // discussions dont la recherche est en cours
  const [drawerOpen, setDrawerOpen] = useState(false); // panneau des discussions (téléphone)
  const [input, setInput] = useState("");
  const [models, setModels] = useState([]);
  const [model, setModel] = useState("");
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const controllers = useRef(new Map()); // id de discussion → requête en cours (pour l'annuler)

  const active = conversations.find((c) => c.id === activeId);
  const messages = active?.messages ?? [];
  const loading = activeId !== null && pending.has(activeId);

  // Sauvegarde dans le navigateur (regroupée : pas à chaque morceau de texte reçu)
  const latest = useRef(conversations);
  latest.current = conversations;
  useEffect(() => {
    const t = setTimeout(() => saveConversations(conversations), 400);
    return () => clearTimeout(t);
  }, [conversations]);
  useEffect(() => {
    const flush = () => saveConversations(latest.current); // la page se ferme : on sauvegarde tout de suite
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  // Met à jour une discussion et la remonte en tête de liste
  const updateConversation = (id, patch) => setConversations((prev) => {
    const i = prev.findIndex((c) => c.id === id);
    if (i === -1) return prev; // supprimée entre-temps
    return [{ ...prev[i], ...patch(prev[i]), updatedAt: Date.now() }, ...prev.slice(0, i), ...prev.slice(i + 1)];
  });

  // Nouvelle discussion : l'ancienne reste dans l'historique (et sa recherche continue si elle est en cours)
  function newChat() {
    setActiveId(null);
    setInput("");
    setDrawerOpen(false);
    if (HAS_MOUSE) inputRef.current?.focus();
  }

  function openChat(id) {
    setActiveId(id);
    setInput("");
    setDrawerOpen(false);
  }

  // Supprimer une discussion arrête aussi sa recherche en cours (le serveur arrête alors l'agent)
  function deleteChat(id) {
    controllers.current.get(id)?.abort();
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (id === activeId) setActiveId(null);
  }

  // Échap ferme le panneau des discussions sur téléphone
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setDrawerOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // Au chargement : le serveur renvoie les modèles autorisés ET disponibles pour la clé RodiumAI
  useEffect(() => {
    fetch(`${API_URL}/api/health`)
      .then((r) => r.json())
      .then((d) => {
        const list = d.models ?? []; // [{ id: "google/gemma-4-31b", name: "Gemma 4 31B" }, …]
        let saved = null;
        try { saved = localStorage.getItem("joanita-model"); } catch {}
        setModels(list);
        setModel(list.some((m) => m.id === saved) ? saved : d.model ?? "");
      })
      .catch(() => {}); // API injoignable : l'erreur s'affichera à l'envoi de la question
  }, []);

  function chooseModel(m) {
    setModel(m);
    try { localStorage.setItem("joanita-model", m); } catch {}
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" }); // changement de discussion : directement en bas
  }, [activeId]);

  async function send(text) {
    const question = text.trim();
    if (!question || loading) return;
    // Première question d'une nouvelle discussion : on la crée, avec la question comme titre
    let id = activeId;
    if (id === null) {
      id = newId();
      const now = Date.now();
      setConversations((prev) => [{ id, title: question.slice(0, 80), createdAt: now, updatedAt: now, messages: [] }, ...prev]);
      setActiveId(id);
    }
    const history = [...messages, { role: "user", content: question }];
    // La réponse en cours de construction : texte, étapes de l'agent, sources
    const answer = { role: "assistant", content: "", steps: [], sources: [] };
    const controller = new AbortController();
    controllers.current.set(id, controller);
    setPending((p) => new Set(p).add(id));
    // La réponse est rangée dans SA discussion, même si l'étudiant en a ouvert une autre entre-temps
    const show = () => { if (!controller.signal.aborted) updateConversation(id, () => ({ messages: [...history, { ...answer }] })); };
    show();
    setInput("");
    const started = performance.now();
    const usedModel = model; // le modèle choisi au moment de l'envoi

    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        // On n'envoie que le texte des échanges (pas les erreurs, ni les étapes / sources)
        body: JSON.stringify({
          messages: history.filter((m) => !m.error).map(({ role, content }) => ({ role, content })),
          model: usedModel || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Erreur ${res.status}`);
      }

      // Lecture du streaming : une ligne JSON par événement
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); // la dernière ligne peut être incomplète
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "text") answer.content += ev.delta;
          else if (ev.type === "reset") answer.content = "";
          else if (ev.type === "step") answer.steps = [...answer.steps, { tool: ev.tool, label: ev.label }];
          else if (ev.type === "sources") answer.sources = ev.items;
          else if (ev.type === "error") throw new Error(ev.message);
        }
        show();
      }
      answer.done = true;
      answer.meta = `${modelName(usedModel, models)} · ${((performance.now() - started) / 1000).toFixed(1)} s`;
      show();
    } catch (e) {
      if (controller.signal.aborted) return; // discussion supprimée : rien à afficher
      const msg = e.message === "Failed to fetch"
        ? "Impossible de joindre l'API (serveur arrêté, mauvaise URL ou CORS ?)"
        : e.message;
      updateConversation(id, () => ({ messages: [...history, { role: "assistant", content: msg, error: true, done: true }] }));
    } finally {
      controllers.current.delete(id);
      setPending((p) => { const next = new Set(p); next.delete(id); return next; });
    }
  }

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        pending={pending}
        open={drawerOpen}
        onNew={newChat}
        onSelect={openChat}
        onDelete={deleteChat}
        onClose={() => setDrawerOpen(false)}
      />
      {drawerOpen && <div className="backdrop" onClick={() => setDrawerOpen(false)} />}

      <div className="chat">
        <header>
          {/* En-tête utile seulement sur téléphone : ouvrir le panneau des discussions, en créer une nouvelle */}
          <button type="button" className="menu-btn" aria-label="Voir les discussions" onClick={() => setDrawerOpen(true)}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          {messages.length > 0 && (
            <button type="button" className="new-chat header-new" onClick={newChat} title="Nouvelle discussion" aria-label="Nouvelle discussion">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
              <span>Nouvelle discussion</span>
            </button>
          )}
        </header>

        <main>
          <div className="thread">
            {messages.length === 0 && (
              <div className="empty">
                <h1 className="hero-brand">
                  <span className="dots"><i /><i /><i /><i /></span>
                  Joanita
                </h1>
                <p>Donne-moi ton sujet d'exposé : je mène les recherches et je te prépare une synthèse sourcée.</p>
                <div className="chips">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => send(s)}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => <Message key={i} m={m} />)}
            <div ref={endRef} />
          </div>
        </main>

        <form className="composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ton sujet d'exposé, de devoir, de mémoire…"
            maxLength={500}
            autoFocus={HAS_MOUSE} // sur mobile, on n'ouvre pas le clavier au chargement
            enterKeyHint="send"
          />
          <div className="toolbar">
            {models.length > 0 && (
              <ModelPicker models={models} value={model} onChange={chooseModel} disabled={loading} />
            )}
            <button type="submit" className="send" aria-label="Envoyer" disabled={loading || !input.trim()}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Message({ m }) {
  if (m.role === "user") {
    return <div className="msg user"><div className="bubble">{m.content}</div></div>;
  }
  const steps = m.steps ?? [];
  const working = !m.done;
  const showBubble = m.content || working; // pendant la recherche : bulle "en train d'écrire" sous les étapes
  const cited = citedNumbers(m.content);
  const sources = (m.sources ?? []).filter((s) => cited.has(s.n)).sort((a, b) => a.n - b.n);

  return (
    <div className={`msg assistant ${m.error ? "error" : ""}`}>
      {steps.length > 0 && <Steps steps={steps} working={working && !m.content} />}
      {showBubble && (
        <div className={`bubble ${m.content ? "" : "is-typing"}`}>
          {m.content
            ? (m.error ? m.content : <Markdown text={m.content} sources={m.sources ?? []} />)
            : <span className="typing"><i /><i /><i /></span>}
        </div>
      )}
      {sources.length > 0 && (
        <ol className="sources" aria-label="Sources">
          {sources.map((s) => (
            <li key={s.n}>
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                <span className="src-n">{s.n}</span>
                <span className="src-title">{s.title}</span>
                <span className="src-host">{hostOf(s.url)}</span>
              </a>
            </li>
          ))}
        </ol>
      )}
      {m.meta && <div className="meta">{m.meta}</div>}
    </div>
  );
}

// Ce que l'agent est en train de faire (ou a fait) : recherches et lectures de pages
function Steps({ steps, working }) {
  const count = (tool) => steps.filter((s) => s.tool === tool).length;
  const plural = (n, word, suffix = "s") => n && `${n} ${word}${n > 1 ? suffix : ""}`;
  const reads = count("read_page");
  const summary = [
    plural(count("web_search"), "recherche") && `${plural(count("web_search"), "recherche")} web`,
    plural(count("academic_search"), "recherche") && `${plural(count("academic_search"), "recherche")} d'articles`,
    reads && `${reads} source${reads > 1 ? "s" : ""} lue${reads > 1 ? "s" : ""}`,
  ].filter(Boolean).join(" · ");
  const list = (
    <ul className="steps-list">
      {steps.map((s, i) => (
        <li key={i}>
          <span className="step-icon" aria-hidden="true">{{ read_page: "📄", academic_search: "📚" }[s.tool] ?? "🔎"}</span>
          {s.label}
        </li>
      ))}
    </ul>
  );
  if (working) return <div className="steps" aria-live="polite">{list}</div>;
  return (
    <details className="steps">
      <summary>{summary}</summary>
      {list}
    </details>
  );
}

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
