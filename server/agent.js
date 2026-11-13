// La boucle d'agent : le modèle décide d'appeler des outils, le serveur les exécute,
// renvoie les résultats au modèle… jusqu'à ce qu'il rédige sa réponse finale.
import { TOOLS, runTool, stepLabel } from "./tools.js";

const MAX_STEPS = 6; // garde-fou coûts : un agent ne doit jamais boucler indéfiniment

// emit(event) envoie au navigateur, au fil de l'eau :
//   { type: "step", label }   l'agent utilise un outil
//   { type: "text", delta }   un morceau de la réponse
//   { type: "reset" }         le texte envoyé n'était qu'un commentaire avant un appel d'outil : on l'efface
//   { type: "sources", items } les sources numérotées [n]
export async function runAgent({ client, model, messages, emit }) {
  const ctx = { sources: new Map() };
  const convo = [...messages];
  const stats = { steps: 0, tools: [], usage: { prompt_tokens: 0, completion_tokens: 0 } };

  for (let step = 0; step < MAX_STEPS; step++) {
    const lastStep = step === MAX_STEPS - 1;
    const stream = await client.chat.completions.create({
      model,
      messages: convo,
      tools: TOOLS,
      tool_choice: lastStep ? "none" : "auto", // dernière étape : on force la rédaction
      stream: true,
      max_tokens: 4000, // réflexion (modèles "thinking") + synthèse
      temperature: 0.3,
    });

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
      if (delta.content) { text += delta.content; emit({ type: "text", delta: delta.content }); }
      for (const part of delta.tool_calls || []) {
        const c = (calls[part.index ?? calls.length] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
        if (part.id) c.id = part.id;
        if (part.function?.name) c.function.name += part.function.name;
        if (part.function?.arguments) c.function.arguments += part.function.arguments;
      }
    }
    stats.steps = step + 1;

    if (calls.length === 0) {
      // Pas d'outil demandé : c'est la réponse finale
      if (ctx.sources.size) emit({ type: "sources", items: [...ctx.sources.values()] });
      return stats;
    }

    // Le modèle veut utiliser des outils
    if (text) emit({ type: "reset" });
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
