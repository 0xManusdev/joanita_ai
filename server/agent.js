// La boucle d'agent : le modèle décide d'appeler des outils, le serveur les exécute,
// renvoie les résultats au modèle… jusqu'à ce qu'il rédige sa réponse finale.
import { TOOLS, runTool, stepLabel } from "./tools.js";

const MAX_STEPS = 14; // garde-fou coûts : un agent ne doit jamais boucler indéfiniment
// Profondeur minimale d'une recherche : en dessous, le serveur refuse la synthèse et relance le modèle.
// (Une consigne dans le prompt ne suffit pas : les petits modèles ont tendance à conclure trop vite.)
const MIN_SEARCHES = 5; // web_search + academic_search
const MIN_READS = 4; // read_page
const MAX_NUDGES = 3; // nombre maximum de relances

// emit(event) envoie au navigateur, au fil de l'eau :
//   { type: "step", tool, label } l'agent utilise un outil
//   { type: "text", delta }       un morceau de la réponse
//   { type: "reset" }             le texte envoyé n'était qu'un commentaire avant un appel d'outil : on l'efface
//   { type: "sources", items }    les sources numérotées [n]
// signal : annule l'agent si l'étudiant quitte la discussion
export async function runAgent({ client, model, messages, emit, signal }) {
  const ctx = { sources: new Map() };
  const convo = [...messages];
  const stats = { steps: 0, tools: [], nudges: 0, usage: { prompt_tokens: 0, completion_tokens: 0 } };
  const count = (...names) => stats.tools.filter((t) => names.includes(t)).length;

  for (let step = 0; step < MAX_STEPS; step++) {
    if (signal?.aborted) return stats; // discussion abandonnée : on n'appelle plus rien
    const lastStep = step === MAX_STEPS - 1;
    const researching = stats.tools.length > 0; // l'agent a commencé à chercher : c'est une demande de recherche
    const deepEnough = count("web_search", "academic_search") >= MIN_SEARCHES && count("read_page") >= MIN_READS;
    // Tant que la recherche n'est pas assez approfondie, un éventuel brouillon n'est pas montré à l'étudiant
    const live = !researching || deepEnough || lastStep || stats.nudges >= MAX_NUDGES;

    const stream = await client.chat.completions.create({
      model,
      messages: convo,
      tools: TOOLS,
      tool_choice: lastStep ? "none" : "auto", // dernière étape : on force la rédaction
      stream: true,
      max_tokens: 8000, // réflexion (modèles "thinking") + synthèse détaillée
      temperature: 0.3,
    }, { signal }); // l'appel en cours au modèle est lui aussi interrompu

    // On reconstitue la réponse à partir des morceaux : du texte et/ou des appels d'outils
    let text = "";
    const calls = []; // les appels arrivent eux aussi en morceaux, repérés par leur index
    let extra; // champs propres au fournisseur (ex. signatures de réflexion Gemini) à renvoyer tels quels
    for await (const chunk of stream) {
      if (chunk.usage) {
        stats.usage.prompt_tokens += chunk.usage.prompt_tokens || 0;
        stats.usage.completion_tokens += chunk.usage.completion_tokens || 0;
      }
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.provider_specific_fields) extra = delta.provider_specific_fields;
      if (delta.content) { text += delta.content; if (live) emit({ type: "text", delta: delta.content }); }
      for (const part of delta.tool_calls || []) {
        const c = (calls[part.index ?? calls.length] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
        if (part.id) c.id = part.id;
        if (part.function?.name) c.function.name += part.function.name;
        if (part.function?.arguments) c.function.arguments += part.function.arguments;
      }
    }
    stats.steps = step + 1;

    if (calls.length === 0) {
      if (!live) {
        // Le modèle veut conclure trop tôt : on écarte le brouillon et on le relance
        stats.nudges++;
        const s = count("web_search", "academic_search"), r = count("read_page");
        convo.push({
          role: "user",
          content: `[Message automatique] Ta recherche n'est pas encore assez approfondie : ${s} recherche(s) et ${r} source(s) lue(s). ` +
            `Avant de rédiger, ${s < MIN_SEARCHES ? `fais encore au moins ${MIN_SEARCHES - s} recherche(s) sous d'autres angles (en anglais aussi, et academic_search), ` : ""}` +
            `${r < MIN_READS ? `lis en détail avec read_page au moins ${MIN_READS - r} source(s) supplémentaire(s) parmi les plus pertinentes et fiables, ` : ""}` +
            "puis rédige la synthèse complète.",
        });
        continue;
      }
      // C'est la réponse finale
      if (ctx.sources.size) emit({ type: "sources", items: [...ctx.sources.values()] });
      return stats;
    }

    // Le modèle veut utiliser des outils
    if (text && live) emit({ type: "reset" });
    convo.push({ role: "assistant", content: text || null, tool_calls: calls, ...(extra && { provider_specific_fields: extra }) });
    const results = await Promise.all(calls.map(async (c) => {
      let args = {};
      try { args = JSON.parse(c.function.arguments || "{}"); } catch { /* arguments invalides : l'outil renverra une erreur */ }
      emit({ type: "step", tool: c.function.name, label: stepLabel(c.function.name, args) });
      stats.tools.push(c.function.name);
      return { role: "tool", tool_call_id: c.id, content: await runTool(c.function.name, args, ctx) };
    }));
    convo.push(...results);
  }
  return stats;
}
