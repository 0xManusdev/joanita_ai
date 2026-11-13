# Joanita

Assistante de recherche pour les étudiants, propulsée par **RodiumAI**. C'est un **agent** : l'étudiant
donne un sujet (« Je prépare un exposé sur… »), Joanita mène elle-même une recherche approfondie
(recherches web en français et en anglais, articles scientifiques, lecture détaillée des meilleures sources),
puis rédige une synthèse (contexte, plan, points clés, débats, lectures) avec des citations [n] vers ses sources.

Mini-projet support de la présentation « Déployer une application IA ».

```
joanita/
├── client/   React + Vite : l'interface de chat           → Vercel
└── server/   Node + Express : l'API qui appelle RodiumAI    → Railway
              ├── POST /api/chat     réponse en streaming (étapes de l'agent, texte, sources)
              ├── GET  /api/health   état du service + modèles disponibles
              ├── agent.js           la boucle d'agent : modèle → outils → modèle… (14 tours max)
              └── tools.js           les outils : web_search (Tavily ou Wikipédia), academic_search (OpenAlex), read_page
```

**Comment marche l'agent ?** On décrit des *outils* au modèle (via l'API compatible OpenAI de RodiumAI).
Le modèle répond soit par du texte, soit par « appelle `web_search` avec telle requête ». Le serveur
exécute l'outil, renvoie le résultat au modèle, et recommence jusqu'à ce que le modèle rédige sa réponse.
**Profondeur minimale** : tant que l'agent n'a pas fait au moins 5 recherches et lu 4 sources, le serveur
refuse sa synthèse et le relance (3 fois au plus) : une simple consigne dans le prompt ne suffit pas,
les petits modèles concluent trop vite. Une recherche prend ainsi 20 à 40 s avec Gemini 3.1 Flash Lite.
Garde-fous : 14 tours maximum (coûts), `read_page` ne lit que des URL renvoyées par une recherche
(sinon le modèle pourrait faire appeler n'importe quelle adresse au serveur : faille SSRF), le contenu
des pages est traité comme une donnée et jamais comme une consigne (injection de prompt), et
l'interface affiche le Markdown sans `innerHTML` (XSS).

**Pourquoi un serveur ?** La clé RodiumAI ne doit jamais aller dans le front : tout ce qui est
dans le navigateur (y compris les variables `VITE_*`) est public. Le serveur garde la clé, limite
le nombre de requêtes et choisit le modèle.

---

## 1. Lancer en local

Prérequis : Node.js 22+ et une clé RodiumAI (`rd_sk_…`, à créer dans le tableau de bord RodiumAI → API keys).

```bash
# Terminal 1 : l'API
cd server
cp .env.example .env        # puis colle ta clé dans .env
npm install
npm run dev                 # → http://localhost:3000/api/health

# Terminal 2 : l'interface
cd client
cp .env.example .env
npm install
npm run dev                 # → http://localhost:5173
```

> Si le port 5173 est déjà occupé, Vite prend le suivant (5174…). Mets alors à jour
> `ALLOWED_ORIGIN` dans `server/.env`, sinon le navigateur bloquera les requêtes (CORS).

Outils utiles (dans `server/`) :

```bash
npm run models          # modèles de chat utilisables avec ta clé (prix, vitesse)
npm run models -- --all # tous les modèles de la clé (image, vidéo, audio…)
npm run models gemini   # … filtrés
npm run wallet          # solde du portefeuille (RODI)
```

## 2. Mettre le code sur GitHub

```bash
git init && git add . && git commit -m "Joanita"
git branch -M main
git remote add origin https://github.com/<toi>/joanita.git
git push -u origin main
```

Vérifie que **`.env` n'apparaît pas** dans le dépôt (il est dans `.gitignore`).

## 3. Déployer l'API sur Railway

1. railway.com → **New Project** → **Deploy from GitHub repo** → choisir `joanita`.
2. Dans le service → **Settings** → **Root Directory** : `server`.
   Railway détecte Node et lance `npm start`.
3. Onglet **Variables** :
   | Nom | Valeur |
   |---|---|
   | `RODIUMAI_API_KEY` | `rd_sk_…` |
   | `MODEL` | `google/gemini-3.1-flash-lite` : modèle par défaut (un id de `npm run models`) |
   | `MODELS` | liste blanche des modèles du menu, séparés par des virgules (seuls ceux que ta clé peut utiliser s'affichent) |
   | `TAVILY_API_KEY` | `tvly-…` (optionnel : clé gratuite sur tavily.com ; sans elle, l'agent cherche sur Wikipédia) |
   | `OPENALEX_API_KEY` | optionnel : clé gratuite sur openalex.org pour les articles scientifiques (sinon quota partagé) |
   | `ALLOWED_ORIGIN` | à remplir à l'étape 5 |
   Ne définis pas `PORT` : Railway le fournit.
4. **Settings → Networking → Generate Domain**, puis teste
   `https://<ton-service>.up.railway.app/api/health` → `{"status":"ok", ...}`.

## 4. Déployer l'interface sur Vercel

1. vercel.com → **Add New… → Project** → importer `joanita`.
2. **Root Directory** : `client` (le preset **Vite** est détecté automatiquement).
3. **Environment Variables** : `VITE_API_URL` = `https://<ton-service>.up.railway.app` (sans `/` final).
4. **Deploy** → tu obtiens `https://joanita-xxx.vercel.app`.

> `VITE_API_URL` est lue **au moment du build** : si tu la modifies, il faut **redéployer**.

## 5. Brancher les deux (CORS)

Sur Railway, mets `ALLOWED_ORIGIN` = l'URL Vercel (ex. `https://joanita-xxx.vercel.app`).
Plusieurs origines possibles, séparées par des virgules. Railway redéploie automatiquement.

Tant que ce n'est pas fait, l'interface affiche « API injoignable » : c'est l'erreur CORS
qu'on montre volontairement pendant la démo.

## 6. Le cycle de vie

- **Modifier et pousser** : `git push` → Railway et Vercel redéploient tout seuls.
- **Changer de modèle** : chaque utilisateur choisit dans le menu « Modèle » de l'interface, parmi la
  liste blanche `MODELS`, croisée avec les modèles que la clé RodiumAI peut utiliser (vérifié toutes les
  10 minutes : un modèle en panne disparaît du menu). Le serveur refuse tout autre id : c'est lui, pas le navigateur, qui maîtrise
  les coûts. Pour ajouter ou retirer un modèle, ou changer celui par défaut (`MODEL`), il suffit de
  modifier les variables sur Railway, sans toucher au code.
- **Preview** : pousser une branche → Vercel crée une URL de prévisualisation dédiée.
  (Ajoute cette URL dans `ALLOWED_ORIGIN` si tu veux qu'elle appelle l'API.)
- **Revenir en arrière** : Vercel → Deployments → *Promote to Production* / *Instant Rollback* ;
  Railway → Deployments → *Redeploy* sur une version précédente.
- **Logs** : Railway → Deployments → *View logs*. Chaque requête écrit une ligne JSON avec
  le modèle, la durée, les tokens consommés et, pour l'agent, le nombre d'étapes et les outils utilisés.

## Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| « API injoignable » dans l'interface | CORS ou mauvaise `VITE_API_URL` | Vérifier `ALLOWED_ORIGIN` (Railway) et `VITE_API_URL` (Vercel), puis redéployer Vercel |
| Le service Railway crashe au démarrage | `RODIUMAI_API_KEY` absente | L'ajouter dans Variables |
| « Crédits RodiumAI épuisés » | Solde RODI à 0 | Recharger le portefeuille, vérifier avec `npm run wallet` |
| « Modèle … momentanément indisponible » | Le fournisseur du modèle est en panne (erreur 503) | Choisir un autre modèle dans le menu |
| « Modèle non disponible » | L'id n'est pas dans `MODELS`, ou la clé n'y a pas accès | `npm run models`, puis ajuster `MODELS` sur Railway |
| « Le modèle ne répond pas » | Id de modèle inconnu, autre erreur | `npm run models`, logs Railway |
| « Trop de requêtes » | Limite de 10 questions/minute/IP | Attendre, ou ajuster dans `server/index.js` |
| Build Railway en échec | Root Directory pas sur `server` | Settings → Root Directory |
| Recherches peu pertinentes (articles hors sujet) | Pas de `TAVILY_API_KEY` : recherche Wikipédia par mots-clés | Ajouter la clé Tavily sur Railway |
| Recherche très lente (plus d'une minute) | Modèle qui « réfléchit » beaucoup (Gemini 2.5 Pro) | Gemini 3.1 Flash Lite : 20 à 40 s |

## Coûts (à vérifier au moment du déploiement)

- **RodiumAI** : paiement à l'usage en crédits RODI (recharge Mobile Money). Prix par modèle : `GET /v1/pricing` ou la page Models.
- **Tavily** : 1 000 crédits gratuits par mois. Une recherche « avancée » coûte 2 crédits et une demande
  d'exposé en lance 3 à 6, plus quelques lectures de pages : compter environ 15 crédits par exposé.
- **OpenAlex** : gratuit (quota quotidien plus large avec une clé gratuite).
- **Railway** : essai unique de 5 $ (30 jours), puis plan Hobby à 5 $/mois.
- **Vercel** : plan Hobby gratuit, réservé à un usage personnel et non commercial.
