// Affiche le solde du portefeuille RodiumAI (en RODI) : npm run wallet
// À lancer en local uniquement : on n'expose pas cette information publiquement.
const base = process.env.RODIUMAI_BASE_URL || "https://api.rodiumai.io/v1";
const res = await fetch(`${base}/wallet`, { headers: { Authorization: `Bearer ${process.env.RODIUMAI_API_KEY}` } });
console.log(res.ok ? JSON.stringify(await res.json(), null, 2) : `Erreur ${res.status} : ${await res.text()}`);
