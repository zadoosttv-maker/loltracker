// LoL Rank Tracker Overlay – laeuft unsichtbar im Hintergrund
// Holt Rank, LP und Matches direkt vom lokalen League-Client (kein API-Key noetig).
// Zeigt automatisch den Account, der gerade im Client eingeloggt ist (Tagesstatistik pro Account).
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { execFile, spawn } = require("child_process");

const ROOT = __dirname;
const STATE_FILE = path.join(ROOT, "state.json");

let config = { port: 8090, pollSeconds: 30, champCount: 3 };
try { config = { ...config, ...JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8")) }; } catch {}
if (process.env.PORT) config.port = Number(process.env.PORT);

// ---- Update-Check gegen GitHub ----
let VERSION = "0.0.0";
try { VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8")).version; } catch {}
const VERSION_URL = "https://raw.githubusercontent.com/zadoosttv-maker/loltracker/main/version.json";
let latestVersion = VERSION;
let updateAvailable = false;

function isNewer(remote, local) {
  const r = String(remote).split(".").map(Number);
  const l = String(local).split(".").map(Number);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const a = r[i] || 0, b = l[i] || 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

async function checkUpdate() {
  try {
    const res = await fetch(VERSION_URL, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.version) {
      latestVersion = data.version;
      updateAvailable = isNewer(latestVersion, VERSION);
    }
  } catch { /* offline o.ae. - beim naechsten Check erneut versuchen */ }
}

const TIERS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"];
const DIVS = { IV: 0, III: 1, II: 2, I: 3 };

function absoluteLP(tier, division, lp) {
  const t = TIERS.indexOf(tier);
  if (t < 0) return null;
  if (t >= TIERS.indexOf("MASTER")) return TIERS.indexOf("MASTER") * 400 + lp;
  return t * 400 + (DIVS[division] || 0) * 100 + lp;
}

// Der Spieltag laeuft von 6:00 bis 5:59 am naechsten Morgen. So bricht eine
// Nacht-Session nicht um Mitternacht mitten im Stream die Tagesbilanz ab.
const DAY_START_HOUR = 6;
function dayKey(when) {
  const d = new Date(when);
  d.setHours(d.getHours() - DAY_START_HOUR);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function todayStr() {
  return dayKey(new Date());
}

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!s.accounts) s.accounts = {};
    return s;
  } catch { return { accounts: {} }; }
}
function saveState(s) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch {}
}
function activeAccount(state) {
  return (state.activePuuid && state.accounts[state.activePuuid]) || null;
}

// ---- Rank-Embleme im Ordner automatisch erkennen ----
function scanEmblems() {
  const map = {};
  try {
    for (const f of fs.readdirSync(ROOT)) {
      if (!/\.(webp|png|jpg|jpeg|gif)$/i.test(f)) continue;
      const upper = f.toUpperCase();
      // Eigenes Unranked-Bild, falls jemand eins in den Ordner legt
      if (upper.includes("UNRANKED") || upper.includes("UNGERANKT")) map.UNRANKED = f;
      for (const tier of TIERS) {
        if (upper.includes(tier) || (tier === "SILVER" && upper.includes("SILBER")) ||
            (tier === "IRON" && upper.includes("EISEN"))) {
          // GRANDMASTER enthaelt MASTER – exakteren Treffer bevorzugen
          if (tier === "MASTER" && upper.includes("GRANDMASTER")) continue;
          map[tier] = f;
        }
      }
    }
  } catch {}
  return map;
}
let emblems = scanEmblems();

// ---- League-Client (LCU) finden ----
let lcu = null; // { port, token }

function findLcu() {
  return new Promise((resolve) => {
    execFile("powershell.exe",
      ["-NoProfile", "-Command",
       "(Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\").CommandLine"],
      { timeout: 15000 },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const port = /--app-port=[\"']?(\d+)/.exec(stdout);
        const token = /--remoting-auth-token=[\"']?([\w-]+)/.exec(stdout);
        resolve(port && token ? { port: port[1], token: token[1] } : null);
      });
  });
}

function lcuGet(apiPath) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: "127.0.0.1",
      port: lcu.port,
      path: apiPath,
      headers: { Authorization: "Basic " + Buffer.from("riot:" + lcu.token).toString("base64") },
      rejectUnauthorized: false,
      timeout: 10000,
    }, (res) => {
      let body = "";
      res.on("data", (c) => body += c);
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error("LCU " + res.statusCode + " " + apiPath));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("LCU timeout")));
    req.end();
  });
}

// ---- DDragon: Version + Champion-ID -> Name ----
let ddragonVersion = "15.1.1";
let champById = {};

async function loadDDragon() {
  try {
    const versions = await (await fetch("https://ddragon.leagueoflegends.com/api/versions.json")).json();
    ddragonVersion = versions[0];
    const data = await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/data/en_US/champion.json`)).json();
    champById = {};
    for (const name of Object.keys(data.data)) champById[data.data[name].key] = name;
  } catch (e) {
    console.error("DDragon nicht erreichbar:", e.message);
  }
}

// ---- Lane-Erkennung ----
// Prio 1: die in der Champ-Auswahl zugewiesene Position (inkl. offizieller Role-Swaps).
// Prio 2 (nur falls der Tracker die Champ-Auswahl nicht mitbekommen hat): Riots Ingame-Schaetzung.
const POS = { top: "TOP", jungle: "JUNGLE", middle: "MID", bottom: "ADC", utility: "SUPPORT" };

function detectLane(p) {
  const t = p.timeline || {};
  // Der Client meldet die Rolle als SUPPORT/CARRY/DUO/SOLO/NONE.
  // Support zuerst pruefen: Riots Lane-Schaetzung ist bei Supports oft
  // BOTTOM oder NONE (Roaming), die Rolle ist das verlaesslichere Signal.
  if (t.role === "SUPPORT" || t.role === "DUO_SUPPORT") return "SUPPORT";
  if (t.lane === "TOP") return "TOP";
  if (t.lane === "JUNGLE") return "JUNGLE";
  if (t.lane === "MIDDLE" || t.lane === "MID") return "MID";
  if (t.lane === "BOTTOM" || t.lane === "BOT") return "ADC";
  return null;
}

// Waehrend der Champ-Auswahl alle 5s die zugewiesene Position mitschreiben.
// Der letzte Eintrag vor Spielstart gewinnt -> Role-Swaps in der Auswahl werden erfasst.
function recordLane(gameId, lane) {
  const state = loadState();
  if (!state.laneRecords) state.laneRecords = [];
  const lastRec = state.laneRecords[state.laneRecords.length - 1];
  // Unveraendert innerhalb derselben Champ-Auswahl -> nichts schreiben.
  // Der Zeit-Check stellt sicher, dass eine spaetere Auswahl mit gleicher
  // Rolle (und ggf. fehlender gameId) trotzdem einen eigenen Eintrag bekommt.
  if (lastRec && lastRec.gameId === gameId && lastRec.lane === lane &&
      Date.now() - lastRec.ts < 3 * 60 * 1000) return;
  state.laneRecords.push({ gameId, lane, ts: Date.now() });
  if (state.laneRecords.length > 60) state.laneRecords = state.laneRecords.slice(-60);
  saveState(state);
}

function recordedLaneFor(state, g) {
  const records = state.laneRecords || [];
  // Exakte Zuordnung ueber die Game-ID
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].gameId && g.gameId && records[i].gameId === g.gameId) return records[i].lane;
  }
  // Fallback: letzter Eintrag kurz vor Spielstart (Champ-Auswahl endet direkt davor)
  const ts = g.gameCreation || (g.gameCreationDate ? Date.parse(g.gameCreationDate) : null);
  if (!ts) return null;
  let best = null;
  for (const r of records) {
    if (r.ts >= ts - 20 * 60 * 1000 && r.ts <= ts + 60 * 1000 && (!best || r.ts > best.ts)) best = r;
  }
  return best ? best.lane : null;
}

let lastPhase = null;

async function watchChampSelect() {
  if (!lcu) return;
  let phase;
  try {
    phase = await lcuGet("/lol-gameflow/v1/gameflow-phase");
  } catch { lcu = null; return; }

  // Spielende erkannt -> sofort aktualisieren statt auf den 30s-Takt zu warten.
  // Die LP-Aenderung erscheint manchmal erst ein paar Sekunden spaeter, daher zwei Nachzuegler.
  if (phase !== lastPhase) {
    const prev = lastPhase;
    lastPhase = phase;
    if (prev === "InProgress" || phase === "WaitingForStats" || phase === "PreEndOfGame" || phase === "EndOfGame") {
      poll();
      setTimeout(poll, 8000);
      setTimeout(poll, 20000);
    }
  }

  if (phase !== "ChampSelect") return;
  try {
    const session = await lcuGet("/lol-champ-select/v1/session");
    const me = (session.myTeam || []).find(p => p.cellId === session.localPlayerCellId);
    const lane = me && POS[me.assignedPosition];
    // Wichtig: die gameId aus der Champ-Select-Session selbst nehmen.
    // Die aus /lol-gameflow/v1/session haengt manchmal noch am vorherigen
    // Spiel und ordnet die neue Rolle dann dem falschen Game zu.
    const gameId = session.gameId || null;
    if (lane) recordLane(gameId, lane);
  } catch { /* Champ-Auswahl gerade beendet o.ae. */ }
}

function isToday(ts) {
  if (!ts) return false;
  return dayKey(ts) === todayStr();
}

// ---- Valorant ----
// Rang kommt ueber den lokalen Riot Client: dessen Lockfile liefert Port und
// Passwort, damit holen wir uns die Tokens und fragen Riots Valorant-Server.
// Das sind undokumentierte Endpunkte - kann sich mit einem Patch aendern.
const VAL_LOCK = path.join(process.env.LOCALAPPDATA || "", "Riot Games", "Riot Client", "Config", "lockfile");
const VAL_SHARD = { EUW:"eu", EUNE:"eu", EU:"eu", TR:"eu", RU:"eu", NA:"na", LATAM:"na", BR:"na", AP:"ap", SEA:"ap", KR:"kr" };
let valTiers = null;        // Tier-Nummer -> { name, division, icon }
let valLastFetch = 0;
let valorantRunning = false;

function httpsJson(opts) {
  return new Promise(res => {
    const r = https.request({ ...opts, timeout: 12000 }, x => {
      let b = ""; x.on("data", c => b += c);
      x.on("end", () => { try { res({ s: x.statusCode, j: JSON.parse(b) }); } catch { res({ s: x.statusCode, j: null }); } });
    });
    r.on("error", () => res({ s: 0, j: null }));
    r.on("timeout", () => { r.destroy(); res({ s: 0, j: null }); });
    r.end();
  });
}

async function loadValTiers() {
  if (valTiers) return valTiers;
  const r = await httpsJson({ host: "valorant-api.com", port: 443, path: "/v1/competitivetiers" });
  if (!r.j || !r.j.data || !r.j.data.length) return null;
  const neueste = r.j.data[r.j.data.length - 1];
  valTiers = {};
  for (const t of neueste.tiers || []) {
    const teile = String(t.tierName || "").trim().split(/s+/);
    const div = /^[0-9]+$/.test(teile[teile.length - 1]) ? teile.pop() : "";
    valTiers[t.tier] = { name: teile.join(" ").toUpperCase(), division: div, icon: t.largeIcon || null };
  }
  return valTiers;
}

async function fetchValorant() {
  if (!fs.existsSync(VAL_LOCK)) return null;   // Riot Client laeuft nicht
  let lock;
  try { lock = fs.readFileSync(VAL_LOCK, "utf8").split(":"); } catch { return null; }
  const port = lock[2], pw = lock[3];
  if (!port || !pw) return null;
  const auth = "Basic " + Buffer.from("riot:" + pw).toString("base64");

  const ent = await httpsJson({ host: "127.0.0.1", port, path: "/entitlements/v1/token",
    headers: { Authorization: auth }, rejectUnauthorized: false });
  if (!ent.j || !ent.j.accessToken || !ent.j.subject) return null;

  const reg = await httpsJson({ host: "127.0.0.1", port, path: "/riotclient/region-locale",
    headers: { Authorization: auth }, rejectUnauthorized: false });
  const region = String((reg.j && (reg.j.webRegion || reg.j.region)) || "").toUpperCase();
  const shard = VAL_SHARD[region] || "eu";

  const ver = await httpsJson({ host: "valorant-api.com", port: 443, path: "/v1/version" });
  const clientVersion = ver.j && ver.j.data && ver.j.data.riotClientVersion;
  if (!clientVersion) return null;

  const tiers = await loadValTiers();
  const platform = Buffer.from(JSON.stringify({ platformType: "PC", platformOS: "Windows",
    platformOSVersion: "10.0.19042.1.256.64bit", platformChipset: "Unknown" })).toString("base64");
  const mmr = await httpsJson({ host: "pd." + shard + ".a.pvp.net", port: 443,
    path: "/mmr/v1/players/" + ent.j.subject,
    headers: { Authorization: "Bearer " + ent.j.accessToken, "X-Riot-Entitlements-JWT": ent.j.token,
               "X-Riot-ClientVersion": clientVersion, "X-Riot-ClientPlatform": platform } });
  if (mmr.s !== 200 || !mmr.j) return null;

  const upd = mmr.j.LatestCompetitiveUpdate;
  const tierNr = (upd && upd.TierAfterUpdate) || 0;
  const rr = (upd && upd.RankedRatingAfterUpdate) || 0;
  const info = (tiers && tiers[tierNr]) || null;
  return {
    puuid: ent.j.subject,
    tier: tierNr > 0 && info ? info.name : "UNRANKED",
    rank: info ? info.division : "",
    rr,
    tierNr,
    icon: info ? info.icon : null,
  };
}

// ---- Welches Spiel wird gerade gespielt? ----
function checkValorantRunning() {
  return new Promise(resolve => {
    execFile("powershell.exe", ["-NoProfile", "-Command",
      "if (Get-Process -Name 'VALORANT-Win64-Shipping' -ErrorAction SilentlyContinue) { 'JA' } else { 'NEIN' }"],
      { timeout: 15000 }, (err, stdout) => resolve(!err && /JA/.test(String(stdout))));
  });
}

// TFT-Warteschlangen liegen im Bereich 1090-1199
function queueIsTft(id) { return id >= 1090 && id < 1200; }

// Aus Lobby bzw. laufendem Spiel ableiten, ob gerade LoL oder TFT laeuft.
// Ausserhalb einer Lobby bleibt der zuletzt gespielte Modus stehen.
async function detectLolMode(state) {
  let qid = null;
  try { const lob = await lcuGet("/lol-lobby/v2/lobby"); qid = lob && lob.gameConfig && lob.gameConfig.queueId; } catch {}
  if (!qid || qid <= 0) {
    try { const gf = await lcuGet("/lol-gameflow/v1/session"); qid = gf && gf.gameData && gf.gameData.queue && gf.gameData.queue.id; } catch {}
  }
  if (qid && qid > 0) {
    state.lastLolMode = queueIsTft(qid) ? "TFT" : "LOL";
    return state.lastLolMode;
  }
  return state.lastLolMode || "LOL";
}

// ---- Overlay-Daten ----
// Baut die Anzeige-Daten fuer das gerade gespielte Spiel (LoL, TFT oder Valorant).
function buildOverlay(acc, connected, game) {
  game = game || (acc && acc.activeGame) || "LOL";
  const today = todayStr();
  const base = {
    clientConnected: connected, error: null, game,
    emblems, ddragonVersion, version: VERSION, latestVersion, updateAvailable,
  };

  // TFT und Valorant: nur Rang und Tagesbilanz, keine Champs/Lanes/Serie
  if (game === "TFT" || game === "VAL") {
    const blk = (acc && (game === "TFT" ? acc.tft : acc.val)) || {};
    const fresh = blk.date === today;
    const last = blk.last || {};
    return {
      ...base,
      ok: !!last.tier,
      name: (acc && acc.name) || null,
      tier: last.tier || null,
      rank: last.rank || "",
      lp: game === "VAL" ? (last.rr || 0) : (last.lp || 0),
      lpLabel: game === "VAL" ? "RR" : "LP",
      tierIcon: last.icon || null,
      gains: fresh ? blk.gains || 0 : 0,
      losses: fresh ? blk.losses || 0 : 0,
      net: fresh ? (blk.gains || 0) - (blk.losses || 0) : 0,
      wins: 0, defeats: 0, champs: [], lanes: [], streak: 0,
    };
  }

  const fresh = acc && acc.date === today;
  const last = (acc && acc.last) || {};
  return {
    ...base,
    ok: !!last.tier,
    name: (acc && acc.name) || null,
    tier: last.tier || null,
    rank: last.rank || null,
    lp: last.lp || 0,
    lpLabel: "LP",
    tierIcon: null,
    gains: fresh ? acc.gains || 0 : 0,
    losses: fresh ? acc.losses || 0 : 0,
    net: fresh ? (acc.gains || 0) - (acc.losses || 0) : 0,
    wins: fresh ? acc.wins || 0 : 0,
    defeats: fresh ? acc.defeats || 0 : 0,
    champs: last.champs || [],
    lanes: fresh ? acc.lanes || [] : [],
    // Die Serie haengt an den letzten Spielen, nicht am Kalendertag
    streak: (acc && acc.streak) || 0,
  };
}

// Tagesbilanz fuer TFT/Valorant fortschreiben (gleiche Logik wie bei LoL,
// nur ohne Sieg-/Niederlagenzaehler)
function trackBlock(blk, abs) {
  const today = todayStr();
  if (blk.date !== today) {
    blk.date = today; blk.gains = 0; blk.losses = 0; blk.lastAbs = abs;
  }
  if (blk.lastAbs != null && abs != null && abs !== blk.lastAbs) {
    const diff = abs - blk.lastAbs;
    if (diff > 0) blk.gains += diff; else blk.losses += -diff;
  }
  blk.lastAbs = abs;
}

let overlayData = buildOverlay(activeAccount(loadState()), false);

function trackLP(acc, tier, division, lp) {
  const today = todayStr();
  const abs = absoluteLP(tier, division, lp);

  if (acc.date !== today) {
    acc.date = today;
    acc.gains = 0; acc.losses = 0; acc.wins = 0; acc.defeats = 0;
    acc.lastAbs = abs;
  }
  if (acc.lastAbs != null && abs != null && abs !== acc.lastAbs) {
    const delta = abs - acc.lastAbs;
    if (delta > 0) { acc.gains += delta; acc.wins += 1; }
    else { acc.losses += -delta; acc.defeats += 1; }
  }
  acc.lastAbs = abs;
}

// Valorant ohne laufenden League-Client. Die PUUID ist bei Riot kontoweit
// gleich, der Eintrag landet also beim selben Account wie die LoL-Daten.
async function pollValorantOnly() {
  const state = loadState();
  if (Date.now() - valLastFetch <= 60000) {
    overlayData = buildOverlay(activeAccount(state), true, "VAL");
    return;
  }
  valLastFetch = Date.now();
  const v = await fetchValorant();
  if (!v) { overlayData = buildOverlay(activeAccount(state), false); return; }
  if (!state.accounts[v.puuid]) state.accounts[v.puuid] = {};
  const acc = state.accounts[v.puuid];
  if (!acc.val) acc.val = {};
  if (v.tierNr > 0) trackBlock(acc.val, v.tierNr * 100 + v.rr);
  else if (acc.val.date !== todayStr()) { acc.val.date = todayStr(); acc.val.gains = 0; acc.val.losses = 0; }
  acc.val.last = { tier: v.tier, rank: v.rank, rr: v.rr, icon: v.icon };
  acc.activeGame = "VAL";
  state.activePuuid = v.puuid;
  saveState(state);
  overlayData = buildOverlay(acc, true, "VAL");
}

async function poll() {
  emblems = scanEmblems();
  // Prozess nur pruefen, wenn der Riot Client ueberhaupt laeuft (spart Aufrufe)
  valorantRunning = fs.existsSync(VAL_LOCK) ? await checkValorantRunning() : false;
  try {
    if (!lcu) lcu = await findLcu();
    if (!lcu) {
      // Valorant laeuft auch ohne League-Client
      if (valorantRunning) { await pollValorantOnly(); return; }
      overlayData = buildOverlay(activeAccount(loadState()), false);
      return;
    }

    let summoner, ranked, history;
    try {
      [summoner, ranked, history] = await Promise.all([
        lcuGet("/lol-summoner/v1/current-summoner"),
        lcuGet("/lol-ranked/v1/current-ranked-stats"),
        lcuGet("/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=50"),
      ]);
    } catch (e) {
      lcu = null; // Client wurde vermutlich geschlossen -> beim naechsten Poll neu suchen
      overlayData = buildOverlay(activeAccount(loadState()), false);
      return;
    }

    const puuid = summoner.puuid || "unknown";
    const name = (summoner.gameName || summoner.displayName || "") +
                 (summoner.tagLine ? "#" + summoner.tagLine : "");

    const solo = ranked.queueMap && ranked.queueMap.RANKED_SOLO_5x5;
    const tier = solo && TIERS.includes(solo.tier) ? solo.tier : "UNRANKED";
    const division = solo ? solo.division : "";
    const lp = solo ? solo.leaguePoints : 0;

    const state = loadState();

    // Letzte Ranked-Champs (Solo/Duo, queueId 420) + Lanes der heutigen Spiele
    const champs = [];
    const laneCounts = {};
    const games = (history.games && history.games.games) || [];
    for (const g of games) {
      if (g.queueId !== 420) continue;
      const p = g.participants && g.participants[0];
      if (!p) continue;
      if (champs.length < (config.champCount || 3)) {
        champs.push({
          champ: champById[String(p.championId)] || "Champ" + p.championId,
          win: !!(p.stats && p.stats.win),
          lane: recordedLaneFor(state, g) || detectLane(p),
        });
      }
      const ts = g.gameCreation || (g.gameCreationDate ? Date.parse(g.gameCreationDate) : null);
      if (isToday(ts)) {
        // Champ-Select-Zuweisung bevorzugen, Ingame-Schaetzung nur als Notloesung
        const lane = recordedLaneFor(state, g) || detectLane(p);
        if (lane) laneCounts[lane] = (laneCounts[lane] || 0) + 1;
      }
    }
    const lanes = Object.entries(laneCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([role, count]) => ({ role, count }));

    // Serie: wie viele Ranked-Spiele in Folge gewonnen bzw. verloren.
    // Kommt aus der Match-Historie (neueste zuerst), ist also auch nach
    // einem Neustart des Trackers sofort korrekt.
    let streak = 0;   // positiv = Siege in Folge, negativ = Niederlagen
    for (const g of games) {
      if (g.queueId !== 420) continue;
      const p = g.participants && g.participants[0];
      if (!p || !p.stats) break;
      const won = !!p.stats.win;
      if (streak === 0) streak = won ? 1 : -1;
      else if (won && streak > 0) streak++;
      else if (!won && streak < 0) streak--;
      else break;
    }

    // Tagesstatistik pro Account
    if (!state.accounts[puuid]) state.accounts[puuid] = {};
    const acc = state.accounts[puuid];
    acc.name = name;

    if (tier !== "UNRANKED") {
      trackLP(acc, tier, division, lp);
    } else if (acc.date !== todayStr()) {
      acc.date = todayStr();
      acc.gains = 0; acc.losses = 0; acc.wins = 0; acc.defeats = 0;
      acc.lastAbs = null;
    }
    acc.last = { tier, rank: division, lp, champs };
    acc.lanes = lanes;
    acc.streak = streak;
    // ---- TFT: steht in derselben Antwort wie die LoL-Rangliste ----
    const tftQ = ranked.queueMap && ranked.queueMap.RANKED_TFT;
    if (tftQ) {
      const tTier = TIERS.includes(tftQ.tier) ? tftQ.tier : "UNRANKED";
      if (!acc.tft) acc.tft = {};
      if (tTier !== "UNRANKED") trackBlock(acc.tft, absoluteLP(tTier, tftQ.division, tftQ.leaguePoints));
      else if (acc.tft.date !== todayStr()) { acc.tft.date = todayStr(); acc.tft.gains = 0; acc.tft.losses = 0; }
      acc.tft.last = { tier: tTier, rank: tftQ.division === "NA" ? "" : tftQ.division, lp: tftQ.leaguePoints || 0 };
    }

    // ---- Valorant: hoechstens einmal pro Minute abfragen ----
    // Nur haeufig abfragen, wenn Valorant auch laeuft. Sonst reicht ein
    // Erstabruf und danach ein seltener Abgleich - schont Riots Server.
    const valPause = valorantRunning ? 60000 : (acc.val && acc.val.last ? 15 * 60000 : 60000);
    if (Date.now() - valLastFetch > valPause) {
      valLastFetch = Date.now();
      try {
        const v = await fetchValorant();
        if (v) {
          if (!acc.val) acc.val = {};
          if (v.tierNr > 0) trackBlock(acc.val, v.tierNr * 100 + v.rr);
          else if (acc.val.date !== todayStr()) { acc.val.date = todayStr(); acc.val.gains = 0; acc.val.losses = 0; }
          acc.val.last = { tier: v.tier, rank: v.rank, rr: v.rr, icon: v.icon };
        }
      } catch { /* Riot Client zu oder Endpunkt geaendert */ }
    }

    // ---- Welches Spiel laeuft gerade? ----
    const lolMode = await detectLolMode(state);
    acc.activeGame = valorantRunning ? "VAL" : lolMode;

    state.activePuuid = puuid;
    saveState(state);

    overlayData = buildOverlay(acc, true, acc.activeGame);
  } catch (e) {
    console.error(new Date().toLocaleTimeString(), e.message);
    overlayData = { ...overlayData, error: e.message, emblems, ddragonVersion };
  }
}

// ---- HTTP-Server ----
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif", ".json": "application/json" };

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/api/state") {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(overlayData));
    return;
  }
  // Startet update.bat, das den Tracker aktualisiert und neu startet
  if (urlPath === "/api/do-update" && req.method === "POST") {
    const ip = req.socket.remoteAddress;
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip)) {
      res.writeHead(403); res.end(); return;
    }
    spawn("cmd.exe", ["/c", "update.bat", "silent"],
      { cwd: ROOT, detached: true, stdio: "ignore", windowsHide: true }).unref();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"ok":true}');
    return;
  }
  let file = urlPath === "/" ? "/overlay.html"
           : urlPath === "/update" ? "/update.html"
           : urlPath;
  const full = path.join(ROOT, path.normalize(file).replace(/^([\\/.])+/, ""));
  if (!full.startsWith(ROOT) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.writeHead(404); res.end("Not found"); return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(full).toLowerCase()] || "application/octet-stream" });
  fs.createReadStream(full).pipe(res);
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    // Laeuft schon (z.B. durch Autostart) -> diese Instanz leise beenden
    process.exit(0);
  }
  console.error(e.message);
  process.exit(1);
});

server.listen(config.port, "127.0.0.1", () => {
  console.log("LoL Rank Tracker " + VERSION + " laeuft: http://localhost:" + config.port + "/");
  loadDDragon().then(poll);
  checkUpdate();
  setInterval(poll, (config.pollSeconds || 30) * 1000);
  setInterval(watchChampSelect, 2000);
  setInterval(loadDDragon, 6 * 3600 * 1000);
  // Alle 15 Minuten pruefen, damit ein Update zeitnah bei allen ankommt
  setInterval(checkUpdate, 15 * 60 * 1000);
});
