import { useState } from "react";
import { groupByDate } from "./history.js";

// Panneau des discussions : toujours visible sur ordinateur, tiroir sur téléphone
export default function Sidebar({ conversations, activeId, pending, open, onNew, onSelect, onDelete, onClose }) {
  const [confirmId, setConfirmId] = useState(null); // suppression en deux clics, pour éviter les accidents

  return (
    <aside className={`sidebar ${open ? "open" : ""}`} aria-label="Discussions">
      <div className="sidebar-top">
        <div className="brand">
          <span className="dots"><i /><i /><i /><i /></span>
          <span className="brand-name">Joanita</span>
        </div>
        <button type="button" className="sidebar-close" aria-label="Fermer le panneau" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <button type="button" className="sidebar-new" onClick={onNew}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        Nouvelle discussion
      </button>

      <nav className="history">
        {conversations.length === 0 && <p className="history-empty">Tes discussions apparaîtront ici.</p>}
        {groupByDate(conversations).map(([label, items]) => (
          <section key={label}>
            <h2>{label}</h2>
            <ul>
              {items.map((c) => (
                <li key={c.id} className={c.id === activeId ? "active" : ""}>
                  <button
                    type="button"
                    className="history-item"
                    onClick={() => onSelect(c.id)}
                    aria-current={c.id === activeId ? "page" : undefined}
                    title={c.title}
                  >
                    {pending.has(c.id) && <span className="pending-dot" title="Recherche en cours" />}
                    <span className="history-title">{c.title}</span>
                  </button>
                  {confirmId === c.id ? (
                    <button
                      type="button"
                      className="history-confirm"
                      autoFocus
                      onClick={() => { onDelete(c.id); setConfirmId(null); }}
                      onBlur={() => setConfirmId(null)}
                    >
                      Supprimer
                    </button>
                  ) : (
                    <button type="button" className="history-delete" aria-label={`Supprimer « ${c.title} »`} title="Supprimer" onClick={() => setConfirmId(c.id)}>
                      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                        <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>

      <p className="sidebar-note">Discussions enregistrées dans ce navigateur.</p>
    </aside>
  );
}
