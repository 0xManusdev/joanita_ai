// Mini-rendu Markdown pour les réponses de Joanita : titres, listes, gras, italique, code, liens et citations [n].
// Volontairement SANS innerHTML / dangerouslySetInnerHTML : le texte vient d'un modèle qui a lu des pages web,
// l'injecter tel quel en HTML ouvrirait la porte à une faille XSS. Ici, React échappe tout.

const SAFE_URL = /^https?:\/\//i;

// Découpe une ligne en morceaux : **gras**, *italique*, `code`, [texte](url), citations [2] ou [1, 3]
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\[\d+(?:\s*[,;]\s*\d+)*\]|\*[^*\s][^*]*\*)/g;

function Inline({ text, sources }) {
  return text.split(INLINE).map((part, i) => {
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) return SAFE_URL.test(link[2])
      ? <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>
      : link[1];
    const cite = part.match(/^\[(\d+(?:\s*[,;]\s*\d+)*)\]$/);
    if (cite) return cite[1].split(/\s*[,;]\s*/).map((n) => {
      const src = sources.find((s) => String(s.n) === n);
      return src && SAFE_URL.test(src.url)
        ? <a key={`${i}-${n}`} className="cite" href={src.url} target="_blank" rel="noopener noreferrer" title={src.title}>{n}</a>
        : <sup key={`${i}-${n}`}>[{n}]</sup>;
    });
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

export default function Markdown({ text, sources = [] }) {
  const blocks = [];
  let list = null; // liste en cours : { items: [{ level, marker, text }] }
  const flush = () => { if (list) { blocks.push({ type: "list", ...list }); list = null; } };

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const item = line.match(/^(\s*)([-*•]|\d+[.)])\s+(.*)$/);
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); blocks.push({ type: "hr" }); } // --- ou ***
    else if (heading) { flush(); blocks.push({ type: "h", level: heading[1].length, text: heading[2] }); }
    else if (item) {
      list ??= { items: [] };
      const level = Math.min(2, Math.floor(item[1].replace(/\t/g, "  ").length / 2));
      list.items.push({ level: level > 0 ? Math.min(level, 2) : 0, marker: /\d/.test(item[2]) ? item[2] : null, text: item[3] });
    }
    else if (!line.trim()) flush();
    else { flush(); blocks.push({ type: "p", text: line }); }
  }
  flush();

  return (
    <div className="md">
      {blocks.map((b, i) => {
        if (b.type === "hr") return <hr key={i} />;
        if (b.type === "h") return b.level <= 2
          ? <h3 key={i}><Inline text={b.text} sources={sources} /></h3>
          : <h4 key={i}><Inline text={b.text} sources={sources} /></h4>;
        if (b.type === "list") return (
          <ul key={i}>
            {b.items.map((it, j) => (
              <li key={j} className={`lvl-${it.level} ${it.marker ? "numbered" : ""}`} data-marker={it.marker ?? undefined}>
                <Inline text={it.text} sources={sources} />
              </li>
            ))}
          </ul>
        );
        return <p key={i}><Inline text={b.text} sources={sources} /></p>;
      })}
    </div>
  );
}

// Numéros des sources réellement citées dans le texte
export function citedNumbers(text) {
  const nums = new Set();
  for (const m of text.matchAll(/\[(\d+(?:\s*[,;]\s*\d+)*)\]/g)) m[1].split(/\s*[,;]\s*/).forEach((n) => nums.add(Number(n)));
  return nums;
}
