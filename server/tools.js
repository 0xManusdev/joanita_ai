// Outils de l'agent Joanita : recherche web, recherche d'articles scientifiques et lecture de page.
// Chaque source trouvée reçoit un numéro [n] que le modèle cite dans sa synthèse.

const TAVILY_KEY = process.env.TAVILY_API_KEY;
const OPENALEX_KEY = process.env.OPENALEX_API_KEY; // optionnelle : sans clé, quota gratuit partagé
export const SEARCH_ENGINE = TAVILY_KEY ? "Tavily" : "Wikipédia (fr + en)";
const UA = { "User-Agent": "Joanita/1.0 (projet etudiant de demonstration)" };
const TIMEOUT = 12_000; // une source lente ne doit pas bloquer tout l'agent
const MAX_PAGE_CHARS = 9000; // au-delà, trop de tokens (= trop cher et trop lent)
const MAX_HTML_BYTES = 2_000_000;

// ---------- Définition des outils, au format OpenAI (compris par RodiumAI) ----------
export const TOOLS = [
  {
    type: "function",
    function: {
      name: "web_search",
      description: TAVILY_KEY
        ? "Recherche sur le web (sites d'institutions, presse, organisations, encyclopédies…). Renvoie des sources numérotées [n] avec un extrait."
        : "Recherche dans Wikipédia. Renvoie des articles numérotés [n] avec un extrait.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            // La recherche Wikipédia fonctionne par mots-clés : une requête longue ramène des articles hors sujet
            description: TAVILY_KEY
              ? "Requête de recherche précise"
              : "Requête COURTE de 1 à 4 mots-clés (ex. « photosynthèse », « cycle de Calvin »)",
          },
          lang: {
            type: "string",
            enum: ["fr", "en"],
            description: "Langue de la recherche. L'anglais donne souvent des sources plus nombreuses et plus détaillées.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "academic_search",
      description: "Recherche d'articles scientifiques et de rapports (base OpenAlex) : titre, année, auteurs, nombre de citations et résumé. Les requêtes en anglais donnent beaucoup plus de résultats.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Mots-clés du sujet, de préférence en anglais" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_page",
      description: "Lit le contenu détaillé d'une source renvoyée par web_search ou academic_search, pour en extraire faits, dates et chiffres précis.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "URL exacte d'une source déjà renvoyée par une recherche" } },
        required: ["url"],
      },
    },
  },
];

// ---------- Exécution d'un appel d'outil ----------
// ctx.sources : Map url → { n, title, url, content? } partagée pendant toute la requête
export async function runTool(name, args, ctx) {
  try {
    if (name === "web_search") return await webSearch(String(args.query || ""), args.lang === "en" ? "en" : "fr", ctx);
    if (name === "academic_search") return await academicSearch(String(args.query || ""), ctx);
    if (name === "read_page") return await readPage(String(args.url || ""), ctx);
    return `Erreur : outil inconnu « ${name} ».`;
  } catch (err) {
    return `Erreur pendant ${name} : ${err.message}. Essaie autrement ou continue avec ce que tu as.`;
  }
}

// Libellé affiché à l'étudiant pendant que l'agent travaille
export function stepLabel(name, args) {
  if (name === "web_search") return `Recherche${args.lang === "en" ? " (en anglais)" : ""} : ${args.query ?? ""}`;
  if (name === "academic_search") return `Articles scientifiques : ${args.query ?? ""}`;
  if (name === "read_page") {
    try { const u = new URL(args.url); return `Lecture : ${u.hostname.replace(/^www\./, "")}${decodeURIComponent(u.pathname).slice(0, 60)}`; }
    catch { return "Lecture d'une page"; }
  }
  return name;
}

function register(ctx, { title, url, content }) {
  if (!ctx.sources.has(url)) ctx.sources.set(url, { n: ctx.sources.size + 1, title, url, content });
  return ctx.sources.get(url).n;
}

const formatResults = (results, ctx) => results
  .map((r) => `[${register(ctx, r)}] ${r.title}${r.meta ? ` (${r.meta})` : ""}\nURL : ${r.url}\nExtrait : ${r.snippet}`)
  .join("\n\n");

async function webSearch(query, lang, ctx) {
  if (!query.trim()) return "Erreur : requête vide.";
  const results = TAVILY_KEY ? await tavilySearch(query) : await wikipediaSearch(query, lang);
  if (results.length === 0) return `Aucun résultat pour « ${query} ». Essaie une autre formulation${lang === "fr" ? " ou lang: \"en\"" : ""}.`;
  return formatResults(results, ctx);
}

async function academicSearch(query, ctx) {
  if (!query.trim()) return "Erreur : requête vide.";
  const results = await openAlexSearch(query);
  if (results.length === 0) return `Aucun article pour « ${query} ». Essaie des mots-clés en anglais.`;
  return formatResults(results, ctx);
}

async function readPage(url, ctx) {
  // Sécurité (SSRF) : on ne lit QUE des URL déjà renvoyées par une recherche,
  // sinon le modèle pourrait faire appeler au serveur n'importe quelle adresse (y compris internes).
  const source = ctx.sources.get(url);
  if (!source) return "Erreur : cette URL n'a pas été renvoyée par une recherche. Utilise l'URL exacte d'une source trouvée.";
  let text = "";
  if (/^https:\/\/[a-z]+\.wikipedia\.org\/wiki\//.test(url)) text = await wikipediaPage(url);
  else if (source.content) text = source.content; // article scientifique : métadonnées + résumé complet
  else if (TAVILY_KEY) text = await tavilyExtract(url).catch(() => "");
  if (!text && !source.content) text = await fetchPageText(url).catch(() => "");
  if (!text) return `Impossible de lire [${source.n}] (page protégée ou vide). Utilise son extrait ou une autre source.`;
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
  // "advanced" : recherche plus approfondie (2 crédits Tavily au lieu de 1)
  const data = await tavily("search", { query, search_depth: "advanced", max_results: 7 });
  return (data.results || []).map((r) => ({ title: r.title, url: r.url, snippet: (r.content || "").slice(0, 700) }));
}

async function tavilyExtract(url) {
  const data = await tavily("extract", { urls: [url] });
  return data.results?.[0]?.raw_content || "";
}

// ---------- Wikipédia (gratuit, sans clé), en français ou en anglais ----------
async function wikipediaSearch(query, lang) {
  const params = new URLSearchParams({ action: "query", list: "search", srsearch: query, srlimit: "6", format: "json", utf8: "1" });
  const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params}`, { headers: UA, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`Wikipédia ${res.status}`);
  const data = await res.json();
  return (data.query?.search || []).map((r) => ({
    title: lang === "fr" ? r.title : `${r.title} (Wikipedia EN)`,
    url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`,
    snippet: cleanHtml(r.snippet),
  }));
}

async function wikipediaPage(url) {
  const title = decodeURIComponent(url.split("/wiki/")[1] || "");
  const params = new URLSearchParams({ action: "query", prop: "extracts", explaintext: "1", titles: title, format: "json", redirects: "1" });
  const res = await fetch(`${new URL(url).origin}/w/api.php?${params}`, { headers: UA, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`Wikipédia ${res.status}`);
  const pages = (await res.json()).query?.pages || {};
  return Object.values(pages)[0]?.extract || "";
}

// ---------- OpenAlex : 250 millions d'articles scientifiques (gratuit) ----------
async function openAlexSearch(query) {
  const params = new URLSearchParams({
    search: query, "per-page": "6",
    select: "id,doi,title,publication_year,cited_by_count,abstract_inverted_index,primary_location,authorships",
  });
  if (OPENALEX_KEY) params.set("api_key", OPENALEX_KEY);
  const res = await fetch(`https://api.openalex.org/works?${params}`, { headers: UA, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`OpenAlex ${res.status}`);
  const data = await res.json();
  return (data.results || []).filter((w) => w.title).map((w) => {
    const abstract = rebuildAbstract(w.abstract_inverted_index);
    const authors = (w.authorships || []).slice(0, 3).map((a) => a.author?.display_name).filter(Boolean).join(", ");
    const venue = w.primary_location?.source?.display_name;
    const meta = [w.publication_year, authors, venue, `cité ${w.cited_by_count ?? 0} fois`].filter(Boolean).join(" · ");
    return {
      title: w.title,
      url: w.doi || w.primary_location?.landing_page_url || w.id,
      meta,
      snippet: abstract ? abstract.slice(0, 500) : "(pas de résumé disponible)",
      // read_page renverra ces informations : les pages d'éditeurs sont souvent payantes ou illisibles
      content: `${w.title}\n${meta}\n\nRésumé : ${abstract || "non disponible"}`,
    };
  });
}

// OpenAlex stocke les résumés sous forme d'index { mot: [positions] } : on reconstitue le texte
function rebuildAbstract(inv) {
  if (!inv) return "";
  const words = [];
  for (const [word, positions] of Object.entries(inv)) for (const p of positions) words[p] = word;
  return words.filter(Boolean).join(" ");
}

// ---------- Lecture générique d'une page web (quand Tavily n'est pas configuré) ----------
async function fetchPageText(url) {
  const u = new URL(url);
  // Défense en profondeur (SSRF) : uniquement des adresses publiques en http(s)
  if (!/^https?:$/.test(u.protocol) || isPrivateHost(u.hostname)) throw new Error("adresse non autorisée");
  const res = await fetch(u, { headers: { ...UA, Accept: "text/html" }, signal: AbortSignal.timeout(TIMEOUT), redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (isPrivateHost(new URL(res.url).hostname)) throw new Error("redirection non autorisée");
  if (!(res.headers.get("content-type") || "").includes("html")) throw new Error("pas une page HTML");
  const html = (await res.text()).slice(0, MAX_HTML_BYTES);
  return cleanHtml(html
    .replace(/<(script|style|noscript|svg|nav|header|footer|form)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n"))
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

function isPrivateHost(host) {
  return host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.includes(":") ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
}

function cleanHtml(s = "") {
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
}
