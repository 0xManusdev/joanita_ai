// Liste les modèles utilisables avec TA clé RodiumAI.
//   npm run models            → modèles de chat disponibles (utilisables par Joanita)
//   npm run models -- --all   → tous les modèles de la clé (images, vidéo, audio, retirés…)
//   npm run models gemini     → filtre sur le nom
// Avec une clé, /v1/models ne renvoie que les modèles autorisés pour cette clé.
const base = process.env.RODIUMAI_BASE_URL || "https://api.rodiumai.io/v1";
const args = process.argv.slice(2);
const all = args.includes("--all");
const filter = (args.find((a) => !a.startsWith("--")) || "").toLowerCase();

const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${process.env.RODIUMAI_API_KEY}` } });
if (!res.ok) {
  console.error(`Erreur ${res.status} :`, await res.text());
  process.exit(1);
}
const list = (await res.json()).data ?? [];

const isChat = (m) => {
  const c = m.rodiumai_capabilities || {};
  const id = m.id.toLowerCase();
  return (c.input_modalities || []).includes("text") && (c.output_modalities || []).includes("text") &&
    m.rodiumai_pricing?.pricing_unit === "per_million_tokens" && !/image|tts|transcribe|embedding/.test(id);
};
const price = (m) => {
  const p = m.rodiumai_pricing || {};
  return p.pricing_unit === "per_million_tokens" ? `${p.input_per_1m} / ${p.output_per_1m}` : p.pricing_unit || "?";
};

const rows = list
  .filter((m) => all || (isChat(m) && m.rodiumai_status === "available"))
  .filter((m) => m.id.toLowerCase().includes(filter))
  .sort((a, b) => a.id.localeCompare(b.id))
  .map((m) => ({
    id: m.id,
    statut: m.rodiumai_status === "available" ? "✅" : "⛔",
    type: isChat(m) ? "chat" : "autre",
    "prix RODI / 1M tokens (entrée / sortie)": price(m),
    vitesse: m.rodiumai_tier?.speed ?? "",
    qualité: m.rodiumai_tier?.quality ?? "",
  }));

console.table(rows);
const providers = [...new Set(list.map((m) => m.id.split("/")[0]))].join(", ");
console.log(`${rows.length} modèle(s) affiché(s) sur ${list.length} accessibles avec cette clé (fournisseurs : ${providers})`);
if (!all) console.log("Ajoute -- --all pour voir aussi les modèles image/vidéo/audio et les modèles indisponibles.");
