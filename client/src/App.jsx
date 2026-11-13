import { useEffect, useRef, useState } from "react";
import ModelPicker, { modelName } from "./ModelPicker.jsx";
import Markdown, { citedNumbers } from "./Markdown.jsx";

// L'URL de l'API est injectée AU MOMENT DU BUILD (Vercel) : changer la variable impose un redéploiement.
const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/$/, "");

const HAS_MOUSE = typeof window !== "undefined" && window.matchMedia?.("(pointer: fine)").matches;

//   = espace insécable : le « ? » ne se retrouve jamais seul en début de ligne
const SUGGESTIONS = [
  "Quand dois-je m'inscrire aux rattrapages ?",
  "Je prépare un exposé sur l'énergie solaire en Afrique",
  "Que se passe-t-il si je rate un examen ?",
  "Quel est le menu de la cantine demain ?",
];

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState([]);
  const [model, setModel] = useState("");
  const endRef = useRef(null);

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

  async function send(text) {
    const question = text.trim();
    if (!question || loading) return;
    const history = [...messages, { role: "user", content: question }];
    // La réponse en cours de construction : texte, étapes de l'agent, sources
    const answer = { role: "assistant", content: "", steps: [], sources: [] };
    const show = () => setMessages([...history, { ...answer }]);
    show();
    setInput("");
    setLoading(true);
    const started = performance.now();
    const usedModel = model; // le modèle choisi au moment de l'envoi

    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
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
      const msg = e.message === "Failed to fetch"
        ? "Impossible de joindre l'API (serveur arrêté, mauvaise URL ou CORS ?)"
        : e.message;
      setMessages([...history, { role: "assistant", content: msg, error: true, done: true }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="dots"><i /><i /><i /><i /></span>
          <h1>Joanita</h1>
        </div>
      </header>

      <main>
        <div className="thread">
          {messages.length === 0 && (
            <div className="empty">
              <h2>Bonjour 👋</h2>
              <p>Pose-moi une question sur ta scolarité, ou demande-moi de t'aider à préparer un exposé.</p>
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
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ta question, ou ton sujet d'exposé…"
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
  );
}

function Message({ m }) {
  if (m.role === "user") {
    return <div className="msg user"><div className="bubble">{m.content}</div></div>;
  }
  const steps = m.steps ?? [];
  const working = !m.done;
  const showBubble = m.content || (steps.length === 0 && working);
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
  const searches = steps.filter((s) => s.tool === "web_search").length;
  const reads = steps.filter((s) => s.tool === "read_page").length;
  const summary = [
    searches && `${searches} recherche${searches > 1 ? "s" : ""}`,
    reads && `${reads} page${reads > 1 ? "s" : ""} lue${reads > 1 ? "s" : ""}`,
  ].filter(Boolean).join(" · ");
  const list = (
    <ul className="steps-list">
      {steps.map((s, i) => (
        <li key={i} className={working && i === steps.length - 1 ? "current" : ""}>
          <span className="step-icon" aria-hidden="true">{s.tool === "read_page" ? "📄" : "🔎"}</span>
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
