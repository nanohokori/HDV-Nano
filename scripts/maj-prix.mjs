// Met à jour data.json avec les prix de l'HDV QuestLog (Nezekan EU, serverId 1302).
// 2 requêtes par exécution (listings + noms), 1 exécution par heure. Rien n'est écrit si QuestLog n'a pas changé.
import fs from "node:fs";

const FILE = process.env.DATA_FILE || "data.json";
const BASE = process.env.QL_BASE || "https://questlog.gg";
const SERVER = 1302;
const EXCLU = /coffre de kinah|papier de verre|durcisseur .*écaille de dragon|^catalyseur$|^abrasif$/i;
const HEADERS = { "User-Agent": "HDV-Nano price tracker (1 relevé par heure)", Accept: "application/json" };

async function get(path, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(BASE + path, { headers: HEADERS, signal: AbortSignal.timeout(40000) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return (await r.json()).result.data;
    } catch (e) {
      console.log(`Essai ${i}/${tries} échoué : ${e.message}`);
      if (i < tries) await new Promise(res => setTimeout(res, 20000 * i));
    }
  }
  return null;
}

const db = JSON.parse(fs.readFileSync(FILE, "utf8"));
const L = await get(`/aion-2/api/trpc/auctionHouse.getListings?input=${encodeURIComponent(JSON.stringify({ serverId: SERVER }))}`);
const I = L && await get(`/aion-2/api/trpc/auctionHouse.getItems?input=${encodeURIComponent(JSON.stringify({ language: "fr" }))}`);
if (!Array.isArray(L) || !L.length || !Array.isArray(I) || !I.length) {
  console.log("QuestLog injoignable ou réponse inattendue : aucune modification.");
  process.exit(0);
}

const snap = Math.max(...L.map(x => Date.parse(x.updatedAt)).filter(Number.isFinite));
if (!Number.isFinite(snap)) { console.log("Horodatage illisible : aucune modification."); process.exit(0); }
if (db.qlSnap && snap <= db.qlSnap) { console.log("QuestLog n'a pas été actualisé depuis le dernier relevé : rien à faire."); process.exit(0); }

const byId = new Map(L.map(x => [x.itemId, x]));
const idByName = new Map();
for (const x of I) { const n = String(x.name || "").toLowerCase(); if (n && !idByName.has(n)) idByName.set(n, x.id); }

const t = Math.min(snap, Date.now());
let changes = 0, pushed = 0, skipped = [];
for (const it of db.items) {
  if (EXCLU.test(it.name)) continue;
  const id = idByName.get(it.name.toLowerCase());
  if (id == null) { skipped.push(it.name); continue; }
  const l = byId.get(id);
  const h = it.h || (it.h = []);
  const last = h.length ? h.reduce((a, b) => (b.t >= a.t ? b : a)) : null;
  let pt;
  if (l && l.listings > 0) pt = { t, p: l.minPrice, by: "Auto", q: l.listings };
  else if (last) pt = { t, p: last.p, by: "Auto", q: 0 };       // « aucun en vente » : on garde le dernier prix, quantité 0
  else continue;
  if (last && last.t >= t) continue;
  // Même règle que l'ajout manuel : on enregistre si le prix ou la quantité change, ou si le dernier point date de plus d'1 h.
  if (!last || last.p !== pt.p || last.q !== pt.q || t - last.t > 36e5) { h.push(pt); pushed++; }
  changes++;
}

db.qlSnap = snap;
db.chk = Date.now();
db.rev = Math.max(Date.now(), (db.rev || 0) + 1);
fs.writeFileSync(FILE, JSON.stringify(db));
console.log(`Relevé du ${new Date(snap).toISOString()} : ${pushed} points ajoutés (${changes} objets vérifiés, ${skipped.length} sans équivalent QuestLog).`);
