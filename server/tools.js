// Outils de l'agent Joanita : recherche web (Tavily, ou Wikipédia en secours) et lecture de page.
// Chaque source trouvée reçoit un numéro [n] que le modèle cite dans sa synthèse.

const TAVILY_KEY = process.env.TAVILY_API_KEY;
export const SEARCH_ENGINE = TAVILY_KEY ? "Tavily" : "Wikipédia";
const UA = { "User-Agent": "Joanita/1.0 (projet etudiant de demonstration)" };
const TIMEOUT = 10_000; // une source lente ne doit pas bloquer tout l'agent
const MAX_PAGE_CHARS = 6000; // au-delà, trop de tokens (= trop cher et trop lent)

// ---------- Définition des outils, au format OpenAI (compris par RodiumAI) ----------
export const TOOLS = [
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Recherche sur le web des informations fiables sur un sujet. Renvoie une liste de sources numérotées [n] avec un extrait.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            // La recherche Wikipédia fonctionne par mots-clés : une requête longue ramène des articles hors sujet
            description: TAVILY_KEY
              ? "Requête de recherche précise, en français"
              : "Requête COURTE de 1 à 4 mots-clés, en français (ex. « photosynthèse », « cycle de Calvin »)",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_page",
      description: "Lit le contenu détaillé d'une source renvoyée par web_search, pour approfondir.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "URL exacte d'une source renvoyée par web_search" } },
        required: ["url"],
      },
    },
  },
];

// ---------- Exécution d'un appel d'outil ----------
// ctx.sources : Map url → { n, title, url } partagée pendant toute la requête
export async function runTool(name, args, ctx) {
  try {
    if (name === "web_search") return await webSearch(String(args.query || ""), ctx);
    if (name === "read_page") return await readPage(String(args.url || ""), ctx);
    return `Erreur : outil inconnu « ${name} ».`;
  } catch (err) {
    return `Erreur pendant ${name} : ${err.message}. Essaie autrement ou continue avec ce que tu as.`;
  }
}

// Libellé affiché à l'étudiant pendant que l'agent travaille
export function stepLabel(name, args) {
  if (name === "web_search") return `Recherche : ${args.query ?? ""}`;
  if (name === "read_page") {
    try { const u = new URL(args.url); return `Lecture : ${u.hostname.replace(/^www\./, "")}${decodeURIComponent(u.pathname).slice(0, 60)}`; }
    catch { return "Lecture d'une page"; }
  }
  return name;
}

function register(ctx, title, url) {
  if (!ctx.sources.has(url)) ctx.sources.set(url, { n: ctx.sources.size + 1, title, url });
  return ctx.sources.get(url).n;
}

async function webSearch(query, ctx) {
  if (!query.trim()) return "Erreur : requête vide.";
  const results = TAVILY_KEY ? await tavilySearch(query) : await wikipediaSearch(query);
  if (results.length === 0) return `Aucun résultat pour « ${query} ». Essaie une autre formulation.`;
  return results
    .map((r) => `[${register(ctx, r.title, r.url)}] ${r.title}\nURL : ${r.url}\nExtrait : ${r.snippet}`)
    .join("\n\n");
}

async function readPage(url, ctx) {
  // Sécurité (SSRF) : on ne lit QUE des URL déjà renvoyées par une recherche,
  // sinon le modèle pourrait faire appeler au serveur n'importe quelle adresse (y compris internes).
  const source = ctx.sources.get(url);
  if (!source) return "Erreur : cette URL n'a pas été renvoyée par web_search. Utilise l'URL exacte d'une source trouvée.";
  const text = /^https:\/\/[a-z]+\.wikipedia\.org\/wiki\//.test(url)
    ? await wikipediaPage(url)
    : TAVILY_KEY ? await tavilyExtract(url) : "";
  if (!text) return `Impossible de lire [${source.n}]. Utilise son extrait de recherche.`;
  return `[${source.n}] ${source.title}\n\n${text.slice(0, MAX_PAGE_CHARS)}${text.length > MAX_PAGE_CHARS ? "\n[…texte tronqué]" : ""}`;
}

// ---------- Tavily : moteur de recherche web conçu pour les agents IA ----------
async function tavily(path, body) {
  const res = await fetch(`https://api.tavily.com/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TAVILY_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}`);
  return res.json();
}

async function tavilySearch(query) {
  const data = await tavily("search", { query, search_depth: "basic", max_results: 5 });
  return (data.results || []).map((r) => ({ title: r.title, url: r.url, snippet: (r.content || "").slice(0, 600) }));
}

async function tavilyExtract(url) {
  const data = await tavily("extract", { urls: [url] });
  return data.results?.[0]?.raw_content || "";
}

// ---------- Wikipédia (gratuit, sans clé) ----------
const WIKI = "https://fr.wikipedia.org/w/api.php";

async function wikipediaSearch(query) {
  const params = new URLSearchParams({ action: "query", list: "search", srsearch: query, srlimit: "5", format: "json", utf8: "1" });
  const res = await fetch(`${WIKI}?${params}`, { headers: UA, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`Wikipédia ${res.status}`);
  const data = await res.json();
  return (data.query?.search || []).map((r) => ({
    title: r.title,
    url: `https://fr.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`,
    snippet: cleanHtml(r.snippet),
  }));
}

async function wikipediaPage(url) {
  const title = decodeURIComponent(url.split("/wiki/")[1] || "");
  const params = new URLSearchParams({ action: "query", prop: "extracts", explaintext: "1", titles: title, format: "json", redirects: "1" });
  // Tavily peut renvoyer des pages Wikipédia dans d'autres langues : on interroge le bon site
  const res = await fetch(`${new URL(url).origin}/w/api.php?${params}`, { headers: UA, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`Wikipédia ${res.status}`);
  const pages = (await res.json()).query?.pages || {};
  return Object.values(pages)[0]?.extract || "";
}

function cleanHtml(s = "") {
  return s.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
