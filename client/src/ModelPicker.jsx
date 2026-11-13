import { useEffect, useRef, useState } from "react";

// Nom lisible d'un modèle : celui fourni par RodiumAI ("Gemma 4 31B"), sinon tiré de l'id
export const modelName = (id, models = []) =>
  models.find((m) => m.id === id)?.name || (id || "").split("/").pop().replace(/-\d{8}$/, "");

// "google/gemma-4-31b" → "Google"
const PROVIDERS = { openai: "OpenAI", anthropic: "Anthropic", google: "Google", meta: "Meta", deepseek: "DeepSeek", mistral: "Mistral" };
const provider = (id) => {
  const p = id.includes("/") ? id.split("/")[0] : "";
  return PROVIDERS[p] || p.charAt(0).toUpperCase() + p.slice(1);
};

// Menu de choix du modèle (remplace le <select> natif, impossible à styliser sous Windows)
// models : [{ id, name }] envoyés par le serveur ; value : id du modèle choisi
export default function ModelPicker({ models, value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);

  // Fermer au clic en dehors
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // À l'ouverture : focus sur la liste, option courante en surbrillance
  useEffect(() => {
    if (open) { setActive(Math.max(0, models.findIndex((m) => m.id === value))); listRef.current?.focus(); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function pick(id) {
    onChange(id);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onListKey(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % models.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + models.length) % models.length); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(models.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(models[active].id); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); buttonRef.current?.focus(); }
    else if (e.key === "Tab") setOpen(false);
  }

  return (
    <div className="picker" ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        className="model-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Modèle : ${modelName(value, models)}`}
        title={value}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); setOpen(true); } }}
      >
        <span className="model-btn-label">{modelName(value, models)}</span>
        <svg className="chevron" viewBox="0 0 12 8" width="10" height="7" aria-hidden="true">
          <path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <ul
          ref={listRef}
          className="menu"
          role="listbox"
          tabIndex={-1}
          aria-label="Choisir un modèle"
          aria-activedescendant={`model-opt-${active}`}
          onKeyDown={onListKey}
        >
          <li className="menu-title" role="presentation">Modèle</li>
          {models.map((m, i) => (
            <li
              key={m.id}
              id={`model-opt-${i}`}
              role="option"
              aria-selected={m.id === value}
              title={m.id}
              className={`option ${i === active ? "active" : ""} ${m.id === value ? "selected" : ""}`}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(m.id)}
            >
              <span className="option-text">
                <span className="option-name">{m.name}</span>
                <span className="option-provider">{provider(m.id)}</span>
              </span>
              {m.id === value && (
                <svg className="check" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
