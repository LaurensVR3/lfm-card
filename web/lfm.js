/* Shared data layer for the LFM overlays (card, lower third, starting soon).
   Loads the driver's LFM profile, next race, race history and stats, works out
   the current state, and hands it to the layout's render function.
   Usage: LFM.start(state => { ...render... }). */
(() => {
/* ------------------------------------------------------------------ config */
// LFM sim ids. Names are a fallback for drivers with no rating entry in that sim.
const SIMS = {
  1:{code:"acc",  name:"Assetto Corsa Competizione"},
  2:{code:"rf2",  name:"rFactor2"},
  3:{code:"ac",   name:"Assetto Corsa"},
  4:{code:"ams2", name:"Automobilista 2"},
  6:{code:"rr",   name:"RaceRoom Racing Experience"},
  7:{code:"lmu",  name:"Le Mans Ultimate"},
  8:{code:"ace",  name:"Assetto Corsa EVO"},
};
const SIM_ALIASES = {r3e:6, raceroom:6, acevo:8, evo:8};

// Driver ID comes from the URL: /lfm-card/99685. Options are query params,
// all documented on /lfm-card/ (the manual page).
const PARAMS = new URLSearchParams(location.search);
const ID = (location.pathname.match(/lfm-card\/(\d+)/) || [])[1] || PARAMS.get("id") || "99685";
const SIM_PIN = (() => {
  const v = (PARAMS.get("sim") || "").toLowerCase();
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v);
  const hit = Object.entries(SIMS).find(([, s]) => s.code === v);
  return hit ? Number(hit[0]) : SIM_ALIASES[v] || null;
})();
const OWNER_ID = "99685";        // keeps Lavaro volt instead of the licence colour
const LAVARO_TEAM_ID = 10177;
const REFRESH_MS = 120000;       // the original card refreshes every 120 s
const RACE_WINDOW_MS = 3 * 3600e3;  // a started race shows as live until its result is in, at most this long
const RESULT_MS = 7 * 864e5;     // last result shown (when no race is coming up) for this long
const CELEBRATE_MS = 6 * 3600e3; // results this fresh get a celebration
const FORM_SIZE = 10;
const FIELD_SIZE = 11;           // drivers in the SOF ticker, this driver included
const FLIP_S = PARAMS.has("flip") ? Math.max(0, Number(PARAMS.get("flip")) || 0) : 30;
const MOTION = PARAMS.get("motion") !== "off";
const SHOW = (PARAMS.get("show") || "").toLowerCase();   // "result" previews result mode
const CELEBRATE = (PARAMS.get("celebrate") || "").toLowerCase();
if (!MOTION) document.documentElement.classList.add("still");

// The JSON APIs send Access-Control-Allow-Origin: *, so they are fetched directly.
// The original card HTML (only source of the next-race info) isn't CORS-enabled,
// so it goes through a same-origin nginx proxy.
const API = "https://api3.lowfuelmotorsport.com/api";
const URLS = {
  user:  `${API}/users/getUserData/${ID}`,
  stats: `${API}/users/getUserStats/${ID}`,
  past:  n => `${API}/users/getUsersPastRaces/${ID}?start=0&limit=${n}`,
  race:  id => `${API}/race/${id}`,
  cars:  `${API}/lists/getCars`,
  card:  `/lfm-api/lfmlicense/${ID}`,
  // Screenshot of an uploaded LFM livery (transparent PNG). The id is base64'd, as on lowfuelmotorsport.com.
  livery: id => `${API}/liveries/screenshot/${btoa(String(id))}?width=1200`,
};

// Plate colours, taken from the original card's stylesheet (.platenice.* / .S, .A1 ...).
// Licence text is white with a black outline unless a colour is given.
const LICENCE_STYLES = {
  ROOKIE:{bg:"red"}, IRON:{bg:"#434B4D"}, BRONZE:{bg:"#bf8970"}, SILVER:{bg:"silver"},
  GOLD:{bg:"gold"}, PLATINUM:{bg:"black"}, DIAMOND:{bg:"#305496"}, LEGEND:{bg:"purple"},
  ALIEN:{bg:"greenyellow"}, PACEPIRATE:{bg:"black", fg:"deeppink"}, "KEINANFÄNGER":{bg:"black", fg:"deeppink"}
};
// Card accent per licence, matching the plate colours.
// Platinum's plate is black and Pace Pirate's text is pink, so those use a visible stand-in.
const LICENCE_ACCENTS = {
  ROOKIE:"#ff0000", IRON:"#434b4d", BRONZE:"#bf8970", SILVER:"#c0c0c0",
  GOLD:"#ffd700", PLATINUM:"#e5e4e2", DIAMOND:"#305496", LEGEND:"#800080",
  ALIEN:"#adff2f", PACEPIRATE:"#ff1493", "KEINANFÄNGER":"#ff1493"
};
const LICENCE_ORDER = ["ROOKIE","IRON","BRONZE","SILVER","GOLD","PLATINUM","DIAMOND","LEGEND","ALIEN"];
const SR_STYLES = {  // keyed by SR class letter: S, A1-3, B1-3, ... F
  S:{bg:"#00b050", fg:"black"}, A:{bg:"#7030a0", fg:"black"}, B:{bg:"#ffff00", fg:"black"},
  C:{bg:"#dbdbdb", fg:"black"}, D:{bg:"#c65911", fg:"black"}, E:{bg:"#808080", fg:"black"},
  F:{bg:"red", fg:"white"}
};

/* ------------------------------------------------------------------ helpers */
const $ = id => document.getElementById(id);
const regionNames = new Intl.DisplayNames(["en"], {type:"region"});
const flagUrl = cc => cc ? `https://flagcdn.com/${cc.toLowerCase()}.svg` : "";
const countryName = cc => { try { return regionNames.of(cc.toUpperCase()); } catch { return cc; } };
const pad = n => String(n).padStart(2, "0");
const licenceKey = l => String(l || "").toUpperCase().replace(/[+\s]/g, "");
const getJSON = url => fetch(url, {cache:"no-store"}).then(r => r.ok ? r.json() : Promise.reject(r.status));
const getText = url => fetch(url, {cache:"no-store"}).then(r => r.ok ? r.text() : Promise.reject(r.status));
const store = {
  get(k){ try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// Scale the design canvas to fit the OBS source.
function fitStage(w, h){
  const stage = $("stage");
  stage.style.setProperty("--w", w + "px");
  stage.style.setProperty("--h", h + "px");
  const fit = () => stage.style.setProperty("--s", Math.min(innerWidth / w, innerHeight / h));
  addEventListener("resize", fit); fit();
}

// Shrink an element's font until it is no wider than max px.
function fitText(el, max, size, min){
  el.style.fontSize = size + "px";
  while (el.offsetWidth > max && size > min){ size -= 2; el.style.fontSize = size + "px"; }
}
const overflows = el => el.scrollWidth > el.clientWidth + 1;
// Shrink a row's gaps, then its text, until it fits.
function tighten(row, gap = 30, size = 19){
  row.style.gap = gap + "px"; row.style.fontSize = "";
  while (overflows(row) && gap > 14){ gap -= 4; row.style.gap = gap + "px"; }
  while (overflows(row) && size > 14){ size -= 1; row.style.fontSize = size + "px"; }
}

// LFM API dates ("2026-11-09 20:15:00") are Central European local time.
function lfmDate(s){
  const utc = new Date(String(s).replace(" ", "T") + "Z");
  if (isNaN(utc)) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {timeZone:"Europe/Berlin", hourCycle:"h23",
    year:"numeric", month:"numeric", day:"numeric", hour:"numeric", minute:"numeric", second:"numeric"})
    .formatToParts(utc).map(x => [x.type, Number(x.value)]));
  const asBerlin = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return new Date(utc.getTime() - (asBerlin - utc.getTime()));
}

function countdown(ms){
  const t = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
function ago(date){
  const m = Math.max(0, Math.round((Date.now() - date) / 60000));
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
const signed = (n, digits = 0) => n == null ? "" : (n > 0 ? "+" : n < 0 ? "−" : "±") + Math.abs(n).toFixed(digits);
const deltaClass = n => !n ? "flat" : n > 0 ? "up" : "down";

/* ------------------------------------------------------------------ accent */
const luminance = ([r, g, b]) => {
  const c = v => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
const BG_LUM = luminance([20, 20, 22]);  // --bg

// Set the accent from a #rrggbb colour (null = Lavaro volt). Dark licence
// colours (Legend purple, Diamond blue, Iron) are lightened just enough to read
// on the dark card, keeping their hue.
function setAccent(hex){
  const root = document.documentElement.style;
  if (!hex){ for (const p of ["--volt","--volt-rgb","--on-volt"]) root.removeProperty(p); return; }
  const base = hex.match(/\w\w/g).map(h => parseInt(h, 16));
  let rgb = base;
  for (let t = 0; t <= 1 && (luminance(rgb) + 0.05) / (BG_LUM + 0.05) < 3.2; t += 0.05)
    rgb = base.map(v => Math.round(v + (255 - v) * t));
  root.setProperty("--volt", `rgb(${rgb})`);
  root.setProperty("--volt-rgb", rgb.join(","));
  root.setProperty("--on-volt", luminance(rgb) > 0.35 ? "#111" : "#fff");
}

function paintLicence(plate, text, licence){
  const ls = LICENCE_STYLES[licenceKey(licence)] || {bg:"#333"};
  text.textContent = licence || "—";
  plate.style.background = ls.bg;
  plate.style.color = ls.fg || "#fff";
}
function paintSR(plate, text, sr){
  const ss = SR_STYLES[String(sr || "").charAt(0).toUpperCase()] || {bg:"#fff", fg:"black"};
  text.textContent = sr || "—";
  plate.style.background = ss.bg;
  plate.style.color = ss.fg;
}

/* ------------------------------------------------------------------ state */
const S = {
  id: ID, simPin: SIM_PIN, sims: SIMS,
  user: null,      // profile from the user API
  stats: null,     // career stats: wins, podium, poles, starts, ...
  next: null,      // next race from the LFM card: {series, raceId, split, drivers, start}
  race: null,      // race API details for `next`, see parseRace()
  history: [],     // past races, newest first (getUsersPastRaces rows)
  fullHistory: false,
  result: null,    // last finished race, see makeResult()
  form: [],        // last finishes in the shown sim, oldest first
  sim: 1,          // sim the card shows
  view: null,      // display-ready profile for that sim, see makeView()
  livery: null,    // {url, car}
  mode: "idle",    // "next" | "live" | "result" | "idle"
  promo: null,     // {licence, at} when the licence went up recently
};
let carNames = null;
const raceCache = new Map();  // finished race id -> {livery, bestLap, classPos}

async function loadCarNames(){
  if (!carNames) carNames = getJSON(URLS.cars).then(cars => new Map(cars.map(c => [`${c.sim_id}:${c.server_value}`, c.car_name])));
  return carNames;
}

/* ------------------------------------------------------------------ parsing */
function parseCard(html){
  const doc = new DOMParser().parseFromString(html, "text/html");
  const bar = doc.querySelector(".nextrace");
  const time = doc.querySelector("#next-race-time");
  if (!bar || !time || !time.textContent.trim()) return null;
  const driversEl = bar.querySelector(".drivers");
  const drivers = driversEl ? driversEl.textContent.trim() : "";
  if (driversEl) driversEl.remove();
  const parts = bar.textContent.split("|").map(s => s.trim()).filter(Boolean);
  const start = new Date(time.textContent.trim().replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
  if (isNaN(start)) return null;
  return {series: parts[0] || "", raceId: parts[1] || "", split: parts[2] || "", drivers, start,
          id: Number((parts[1] || "").replace(/\D/g, "")) || null};
}

// Pull this driver's entry out of the race. Door numbers are handed out by Elo
// within each class (ACC: GT3 101+, GT4 401+), so the seed is their Elo rank
// among same-class drivers in their split.
function parseRace(race, cars){
  const entries = (race.participants && race.participants.entries) || [];
  const me = entries.find(e => String(e.user_id) === ID);
  const sim = Number((race.track && race.track.sim_id) || (race.event && race.event.sim_id)) || null;
  const info = {
    raceId: Number(race.race_id),
    sim,
    track: race.track ? {name: race.track.track_name, country: race.track.country, km: race.track.km} : null,
    sof: race.sof || null,
    drivers: entries.length,
    field: [],
  };
  if (me){
    const rivals = entries.filter(e => e.split === me.split && e.car_class === me.car_class)
                          .sort((a, b) => b.elo - a.elo);
    info.drivers = entries.filter(e => e.split === me.split).length;
    info.car = cars ? cars.get(`${sim}:${me.car_model}`) : null;
    info.door = me.raceNumber;
    info.livery = me.livery || null;
    info.seed = rivals.indexOf(me) + 1;
    info.classSize = rivals.length;
    info.carClass = me.car_class;
    const splitSof = me.split > 1 ? race[`split${me.split}_sof`] : 0;
    if (splitSof) info.sof = splitSof;

    // A window of FIELD_SIZE same-class drivers centred on this one, shifted
    // to stay inside the list (P3 -> P1-P11, P10 -> P5-P15).
    const idx = rivals.indexOf(me);
    const from = Math.max(0, Math.min(idx - Math.floor(FIELD_SIZE / 2), rivals.length - FIELD_SIZE));
    info.field = rivals.slice(from, from + FIELD_SIZE).map(e => ({
      door: e.raceNumber, first: e.vorname, last: e.nachname, origin: e.origin, elo: e.elo, me: e === me}));
  }

  Object.assign(info, parseServer(race));
  // Fallback race length from the event blurb, e.g. "GT3 + GT4 Multiclass / 75 min."
  const m = race.event && /(\d+)\s*min/i.exec(race.event.website_short_text || "");
  info.raceMinutes = (info.sessions.find(x => x.type === "R") || {}).minutes || (m ? Number(m[1]) : null);
  return info;
}

// Each sim's server config has its own shape. Returns
//   weather:  {icon, label, temp?, rain? (0..1), mode} or null
//   sessions: [{type: "P"|"Q"|"R", minutes}], timed sessions only
// Unknown shapes (LMU, future sims) just come back empty.
function parseServer(race){
  const s = race.server_settings || {};
  const out = {weather: null, sessions: []};
  const add = (type, minutes) => { if (minutes > 0) out.sessions.push({type, minutes: Math.round(minutes)}); };

  // ACC and AC: ACC-style event.json, cloudLevel / rain are 0..1.
  const ev = s.server_settings && s.server_settings.event && s.server_settings.event.data;
  if (ev){
    const [icon, label] = describeLevels(ev.cloudLevel, ev.rain);
    out.weather = {icon, label, temp: ev.ambientTemp, rain: ev.rain || 0,
      mode: race.real_weather ? "Real weather" : ev.weatherRandomness > 0 ? "Dynamic" : "Static"};
    for (const x of ev.sessions || []) add(x.sessionType, x.sessionDurationMinutes);
    return out;
  }

  // AC EVO: seasondef, durations in seconds, weather as an enum name.
  const sd = s.seasondef;
  if (sd){
    const g = sd.game_config || {};
    add("P", g.practice_duration / 60);
    add("Q", g.qualify_duration / 60);
    if (!/LAP/i.test(g.race_duration_type || "")) add("R", g.race_duration / 60);
    if (sd.weather_type){
      const [icon, label] = describeName(sd.weather_type.replace(/^.*_/, ""));
      out.weather = {icon, label, mode: /DYNAMIC/i.test(sd.weather_behaviour || "") ? "Dynamic" : "Static"};
    }
    return out;
  }

  // AMS2: lengths in minutes (laps unless TIMED_RACE), weather as named slots.
  const d = s.default;
  if (d){
    add("P", d.PracticeLength);
    add("Q", d.QualifyLength);
    if ((d.Flags || []).includes("TIMED_RACE")) add("R", d.RaceLength);
    const slots = d.RaceWeatherSlots || 0, first = d.RaceWeatherSlot1 || "";
    if (slots && first){
      const [icon, label] = describeName(first);
      out.weather = {icon, label, mode: slots > 1 ? "Dynamic" : /random/i.test(first) ? "Random" : "Static"};
    }
    return out;
  }

  // RaceRoom: durations in minutes (Laps is set instead for lap races). RR has no weather.
  const gs = s.GameSettings && s.GameSettings[0];
  const ses = gs && gs.TrackLayouts && gs.TrackLayouts[0] && gs.TrackLayouts[0].Sessions;
  if (ses){
    const mins = x => x && !x.Laps ? x.Duration : 0;
    add("P", mins(ses.Practice));
    add("Q", mins(ses.Qualify));
    add("R", mins(ses.Race1));
  }
  return out;
}

const WX_ICONS = {
  sun:   '<svg class="wx" viewBox="0 0 32 32" fill="none" style="stroke:var(--volt)" stroke-width="2.5" stroke-linecap="round"><circle cx="16" cy="16" r="6"/><path d="M16 3v4M16 25v4M3 16h4M25 16h4M6.8 6.8l2.8 2.8M22.4 22.4l2.8 2.8M6.8 25.2l2.8-2.8M22.4 9.6l2.8-2.8"/></svg>',
  part:  '<svg class="wx" viewBox="0 0 32 32" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="11" r="5" style="stroke:var(--volt)"/><path d="M12 2.5v2M3.5 11h2M6 5l1.4 1.4M18 5l-1.4 1.4" style="stroke:var(--volt)"/><path d="M11 27h13a5 5 0 0 0 0-10 7 7 0 0 0-13.3 2A4 4 0 0 0 11 27Z" stroke="#EBEBEB" fill="#141416"/></svg>',
  cloud: '<svg class="wx" viewBox="0 0 32 32" fill="none" stroke="#EBEBEB" stroke-width="2.5" stroke-linejoin="round"><path d="M9 25h15a6 6 0 0 0 0-12 8 8 0 0 0-15.2 2.4A4.8 4.8 0 0 0 9 25Z"/></svg>',
  rain:  '<svg class="wx" viewBox="0 0 32 32" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 20h15a6 6 0 0 0 0-12 8 8 0 0 0-15.2 2.4A4.8 4.8 0 0 0 9 20Z" stroke="#EBEBEB"/><path d="M11 24l-2 4M17 24l-2 4M23 24l-2 4" stroke="#6fc3ff"/></svg>',
};

// ACC/AC cloudLevel / rain are 0..1. Labels are a rough reading of those values.
function describeLevels(cloud = 0, rain = 0){
  if (rain >= 0.6) return ["rain", "Heavy rain"];
  if (rain >= 0.3) return ["rain", "Rain"];
  if (rain >= 0.1) return ["rain", "Light rain"];
  if (cloud < 0.1) return ["sun", "Clear"];
  if (cloud < 0.45) return ["part", "Partly cloudy"];
  if (cloud < 0.75) return ["cloud", "Cloudy"];
  return ["cloud", "Overcast"];
}

// Named weather (AMS2 slots like "LightCloud", "HeavyFogWithRain"; ACE "CLEAR").
function describeName(name){
  const n = String(name).toLowerCase().replace(/[^a-z]/g, "");
  if (/thunder|storm/.test(n)) return ["rain", "Storm"];
  if (/heavyrain/.test(n)) return ["rain", "Heavy rain"];
  if (/lightrain|drizzle/.test(n)) return ["rain", "Light rain"];
  if (/rain|wet/.test(n)) return ["rain", "Rain"];
  if (/snow/.test(n)) return ["cloud", "Snow"];
  if (/fog/.test(n)) return ["cloud", "Fog"];
  if (/haz/.test(n)) return ["part", "Hazy"];
  if (/random/.test(n)) return ["part", "Random"];
  if (/clear|sun/.test(n)) return ["sun", "Clear"];
  if (/lightcloud|partly|scattered|few/.test(n)) return ["part", "Partly cloudy"];
  if (/overcast|heavycloud/.test(n)) return ["cloud", "Overcast"];
  if (/cloud/.test(n)) return ["cloud", "Cloudy"];
  return ["cloud", String(name).replace(/([a-z])([A-Z])/g, "$1 $2")];
}

/* ------------------------------------------------------------------ history */
function mergeHistory(rows){
  const seen = new Set(rows.map(r => r.race_id));
  S.history = rows.concat(S.history.filter(r => !seen.has(r.race_id)))
    .sort((a, b) => String(b.race_date).localeCompare(String(a.race_date)));
}

// A past race counts once it has a finishing position, or has clearly ended
// (finishing_pos 0 = DNF / no result).
function isFinal(r){
  const d = lfmDate(r.race_date);
  if (!d || d > Date.now()) return false;
  return r.finishing_pos > 0 || r.rating_change || Date.now() - d > 2 * 3600e3;
}
const finals = () => S.history.filter(r => isFinal(r) && (!SIM_PIN || r.sim_id === SIM_PIN));

function makeResult(r){
  const split = r.user_split || 1;
  return {
    raceId: r.race_id, date: lfmDate(r.race_date), sim: r.sim_id, series: r.event_name,
    track: r.track_name, car: r.car_name || r.car, carClass: r.class,
    start: r.start_pos || null, finish: r.finishing_pos || 0, dnf: !r.finishing_pos,
    elo: r.rating_change ?? null, sr: r.sr_change ?? null, incidents: r.incidents ?? null,
    points: Math.round(r.points || 0) || null, split,
    sof: (split > 1 && r[`split${split}_sof`]) || r.sof || null,
  };
}

// Finished race details that only the race API has: livery, best lap.
async function loadResultRace(id){
  if (raceCache.has(id)) return raceCache.get(id);
  const race = await getJSON(URLS.race(id));
  const me = ((race.participants && race.participants.entries) || []).find(e => String(e.user_id) === ID);
  // Results are nested per class / split; find this driver's row anywhere in them.
  let row = null;
  const walk = (o, depth) => {
    if (row || !o || typeof o !== "object" || depth > 6) return;
    if (!Array.isArray(o) && String(o.user_id) === ID && "bestlap" in o){ row = o; return; }
    for (const v of Object.values(o)) walk(v, depth + 1);
  };
  walk(race.race_results, 0);
  if (!row) walk(race.race_results_splits, 0);
  const info = {livery: (me && me.livery) || null,
                bestLap: row && row.bestlap ? row.bestlap.replace(/^00:|^0(?=\d:)/, "") : null,
                classPos: row ? row.class_position : null};
  raceCache.set(id, info);
  return info;
}

// Rating after each race in this sim, newest first, rebuilt from the current
// rating and each race's rating change.
function ratingTrail(sim, current){
  const out = [current];
  for (const r of S.history.filter(x => x.sim_id === sim && isFinal(x))) out.push(out[out.length - 1] - (r.rating_change || 0));
  return out;
}

/* ------------------------------------------------------------------ derive */
const nextActive = () => {
  const n = S.next;
  if (!n || Date.now() > n.start.getTime() + RACE_WINDOW_MS) return false;
  return !S.history.some(r => r.race_id === n.id && isFinal(r) && (r.finishing_pos > 0 || r.rating_change));
};
const currentRace = () => nextActive() && S.race && S.race.raceId === S.next.id ? S.race : null;

// Which sim the card shows: pinned, else the next race's, else the last result's, else the most raced one.
function pickSim(){
  if (SIM_PIN) return SIM_PIN;
  const r = currentRace();
  if (r && r.sim) return r.sim;
  if (S.mode === "result" && S.result) return S.result.sim;
  const u = S.user || {};
  const best = (u.rating_by_sim || []).reduce((a, b) => (b.ranked_races || 0) > (a.ranked_races || 0) ? b : a, {});
  return best.ranked_races ? best.sim_id : (u.fav_sim || 1);
}

function makeView(u, simId){
  const sim = (u.rating_by_sim || []).find(s => s.sim_id === simId) || {};
  const licence = sim.license || u.license || "";
  const team = u.team || null;
  return {
    first: u.vorname || u.name || "", last: u.nachname || "",
    team: team && team.teamname, teamLogo: team && team.teamlogo,
    lavaro: !!team && team.team_id === LAVARO_TEAM_ID,
    avatar: u.avatar, banner: u.banner,
    origin: u.origin, flag: flagUrl(u.origin), country: u.origin ? countryName(u.origin) : "",
    simName: sim.name || (SIMS[simId] || {}).name || "", simCode: (SIMS[simId] || {}).code || "",
    rating: sim.rating ?? null, races: sim.ranked_races ?? null,
    licence, licenceKey: licenceKey(licence),
    sr: u.sr_license || "", srNum: u.safety_rating || "",
    division: sim.division ?? u.division ?? null,
  };
}

// Remember the licence per sim; a step up is celebrated for a few hours.
function checkPromotion(){
  if (!S.view || !S.view.licence) return;
  const key = `lfm-card:${ID}:${S.sim}`;
  const prev = store.get(key) || {};
  const now = Date.now(), rank = l => LICENCE_ORDER.indexOf(licenceKey(l));
  let promo = prev.promo || null;
  if (prev.licence && rank(S.view.licence) > rank(prev.licence) && rank(prev.licence) >= 0)
    promo = {licence: S.view.licence, at: now};
  store.set(key, {licence: S.view.licence, promo});
  S.promo = promo && now - promo.at < CELEBRATE_MS ? promo : null;
}

/* ------------------------------------------------------------------ load */
let render = () => {};
let loadedOnce = false;

async function load(){
  const first = !loadedOnce;
  const [user, card, past, stats] = await Promise.allSettled([
    getJSON(URLS.user), getText(URLS.card), getJSON(URLS.past(first ? 40 : 10)), getJSON(URLS.stats)]);
  // On failure keep showing the last good data rather than blanking the overlay.
  if (user.status === "fulfilled") S.user = user.value; else console.warn("LFM profile fetch failed", user.reason);
  if (stats.status === "fulfilled") S.stats = stats.value;
  if (past.status === "fulfilled" && Array.isArray(past.value)) mergeHistory(past.value);
  if (card.status === "fulfilled"){
    const n = parseCard(card.value);
    // LFM may drop a race from the card once it starts; keep it while it runs.
    if (n || !(S.next && S.next.start <= Date.now())) S.next = n;
  } else console.warn("LFM card fetch failed", card.reason);

  if (nextActive()){
    const [race, cars] = await Promise.allSettled([getJSON(URLS.race(S.next.id)), loadCarNames()]);
    if (race.status === "fulfilled") S.race = parseRace(race.value, cars.status === "fulfilled" ? cars.value : null);
    else console.warn("LFM race fetch failed", race.reason);
  } else S.race = null;
  // A pinned sim only shows races in that sim.
  if (SIM_PIN && S.race && S.race.sim && S.race.sim !== SIM_PIN) S.next = S.race = null;

  const done = finals();
  const last = done[0] && makeResult(done[0]);
  S.result = last && (Date.now() - last.date < RESULT_MS || SHOW === "result") ? last : null;
  if (S.result){
    try { Object.assign(S.result, await loadResultRace(S.result.raceId)); }
    catch (e){ console.warn("LFM result race fetch failed", e); }
  }

  S.mode = nextActive() && SHOW !== "result" ? (S.next.start <= Date.now() ? "live" : "next")
         : S.result ? "result" : "idle";
  S.sim = pickSim();
  S.form = done.filter(r => r.sim_id === S.sim).slice(0, FORM_SIZE).reverse()
               .map(r => ({pos: r.finishing_pos || 0, raceId: r.race_id}));
  if (S.user){
    S.view = makeView(S.user, S.sim);
    setAccent(ID === OWNER_ID ? null : LICENCE_ACCENTS[S.view.licenceKey]);
    checkPromotion();
  }

  // Livery: from the next race's entry, else from the last result's.
  const r = currentRace();
  const liv = S.mode === "result" ? S.result && S.result.livery : r && r.livery;
  const car = S.mode === "result" ? S.result && S.result.car : r && r.car;
  S.livery = liv ? {url: URLS.livery(liv), car: car || ""} : null;

  loadedOnce = true;
  if (S.view){ render(S); $("stage").classList.add("ready"); }
  queueCelebrations();
  if (first) loadFullHistory();
}

// The whole race history (~1 MB for 900 races) is only needed to spot a new
// personal-best rating, so it loads once in the background.
async function loadFullHistory(){
  try {
    const rows = await getJSON(URLS.past(3000));
    if (Array.isArray(rows)){ mergeHistory(rows); S.fullHistory = true; queueCelebrations(); }
  } catch (e){ console.warn("LFM history fetch failed", e); }
}

/* ------------------------------------------------------------------ celebrations */
const played = new Set();
const queue = [];
let playing = false;

function celebrations(){
  const out = [], r = S.result, v = S.view;
  if (CELEBRATE === "off" || !v) return out;
  if (r && Date.now() - r.date < CELEBRATE_MS){
    const key = k => `${r.raceId}:${k}`;
    if (r.finish === 1)
      out.push({key: key("win"), big: "Victory", sub: [S.stats && S.stats.wins ? `Win #${S.stats.wins}` : "", r.track]});
    else if (r.finish > 1 && r.finish <= 3)
      out.push({key: key("podium"), big: "Podium", sub: [`P${r.finish}`, r.track]});
    if (S.fullHistory && r.elo > 0 && v.rating != null && r.sim === S.sim){
      const trail = ratingTrail(S.sim, v.rating);
      if (trail.length > 2 && v.rating > Math.max(...trail.slice(1)))
        out.push({key: key("pb"), big: "New personal best", sub: [`${v.rating} rating`, signed(r.elo)]});
    }
    const starts = S.stats && S.stats.starts;
    if (starts && starts % 100 === 0) out.push({key: key("starts"), big: `${starts} starts`, sub: ["on Low Fuel Motorsport"]});
  }
  if (S.promo) out.push({key: `promo:${S.promo.licence}`, big: "Promoted", sub: ["Licence"], plate: S.promo.licence});

  // ?celebrate=win,podium,pb,promo,starts shows examples with this driver's data.
  for (const k of CELEBRATE.split(",").filter(Boolean)){
    const demo = {
      win: {big: "Victory", sub: ["Win #1", "Spa-Francorchamps"]},
      podium: {big: "Podium", sub: ["P2", "Spa-Francorchamps"]},
      pb: {big: "New personal best", sub: [`${v.rating ?? 2000} rating`, "+42"]},
      promo: {big: "Promoted", sub: ["Licence"], plate: v.licence || "GOLD"},
      starts: {big: "500 starts", sub: ["on Low Fuel Motorsport"]},
    }[k];
    if (demo) out.push({...demo, key: `demo:${k}`});
  }
  return out;
}

function queueCelebrations(){
  for (const c of celebrations()) if (!played.has(c.key)){ played.add(c.key); queue.push(c); }
  if (!playing) playNext();
}

function playNext(){
  const c = queue.shift();
  if (!c){ playing = false; return; }
  playing = true;
  const host = document.querySelector("[data-celebrate]") || $("stage");
  const dur = 5600;
  const el = document.createElement("div");
  el.className = "celebrate";
  el.style.setProperty("--cdur", dur + "ms");
  el.innerHTML = '<div class="wash"></div><div class="band"></div><div class="txt"><div class="big"></div><div class="sub"></div></div>';
  el.querySelector(".big").textContent = c.big;
  const sub = el.querySelector(".sub");
  c.sub.filter(Boolean).forEach((s, i) => {
    if (i) sub.append(Object.assign(document.createElement("span"), {textContent: "·"}));
    sub.append(Object.assign(document.createElement("span"), {textContent: s}));
  });
  if (c.plate){
    const plate = document.createElement("span"), txt = document.createElement("span");
    plate.className = "lplate"; plate.append(txt);
    paintLicence(plate, txt, c.plate);
    sub.append(plate);
  }
  // A few streaks fly across ahead of the band.
  [[18, 0], [30, 120], [70, 60], [82, 180]].forEach(([top, delay]) => {
    const s = document.createElement("i"); s.className = "streak";
    s.style.top = top + "%"; s.style.animationDelay = delay + "ms";
    el.append(s);
  });
  host.append(el);
  // Big headlines shrink to fit the stage.
  const big = el.querySelector(".big");
  const max = host.clientWidth * 0.86;
  let size = parseFloat(getComputedStyle(big).fontSize);
  while (big.scrollWidth > max && size > 24){ size -= 4; big.style.fontSize = size + "px"; }
  setTimeout(() => { el.remove(); setTimeout(playNext, 600); }, dur);
}

/* ------------------------------------------------------------------ widgets */
// Avatar coin: flips between the profile picture and the livery every FLIP_S seconds.
function coin(el){
  const front = el.querySelector(".front img"), back = el.querySelector(".back img"), cap = el.querySelector(".back .cap");
  let ready = false;
  const pop = el.closest("[data-pop]") || el.parentElement;
  if (FLIP_S > 0 && MOTION) setInterval(() => {
    const flipped = el.classList.contains("flipped");
    if (!flipped && !ready) return;
    el.classList.toggle("flipped", !flipped);
    pop.classList.remove("flip-pop"); void pop.offsetWidth; pop.classList.add("flip-pop");
  }, FLIP_S * 1000);
  return {
    set(view, livery){
      if (view.avatar && front.getAttribute("src") !== view.avatar) front.src = view.avatar;
      const url = livery && livery.url;
      if (cap) cap.textContent = livery ? livery.car : "";
      if (!url){ ready = false; el.classList.remove("flipped"); return; }
      if (back.getAttribute("src") === url) return;
      ready = false;
      back.onload = () => { ready = true; };
      back.onerror = () => { ready = false; el.classList.remove("flipped"); };
      back.src = url;
    }
  };
}

function renderRivals(box, list){
  box.replaceChildren();
  for (const d of list || []){
    const chip = document.createElement("span"); chip.className = d.me ? "rv me" : "rv";
    const door = document.createElement("span"); door.className = "rdoor";
    const em = document.createElement("em"); em.textContent = `#${d.door}`; door.append(em);
    chip.append(door);
    if (d.origin){
      const img = document.createElement("img"); img.alt = ""; img.src = flagUrl(d.origin); chip.append(img);
    }
    const name = document.createElement("span"); name.className = "rname";
    name.textContent = [d.first, d.last].filter(Boolean).join(" ");
    const elo = document.createElement("span"); elo.className = "relo"; elo.textContent = d.elo;
    chip.append(name, elo);
    box.append(chip);
  }
}

function renderForm(box, form){
  box.replaceChildren();
  for (const f of form){
    const b = document.createElement("b"), em = document.createElement("em");
    b.className = !f.pos ? "dnf" : f.pos === 1 ? "win" : f.pos <= 3 ? "pod" : f.pos <= 10 ? "top" : "";
    em.textContent = f.pos ? `P${f.pos}` : "DNF";
    b.append(em); box.append(b);
  }
  if (form.length){
    const l = document.createElement("span"); l.className = "latest"; l.textContent = "◂ latest"; box.append(l);
  }
}

// Rotating pages: each `.page` in `pages` shows for pageMs (longer if it holds
// a scrolling field ticker), then slides up to the next. Pages with
// data-empty="1" are skipped. ?page=<title> pins one page.
function rotator({pages, title, bar, pageMs = 8000, scrollPxS = 90, hold = 1500}){
  const PIN = (PARAMS.get("page") || "").toLowerCase();
  let timer = 0;
  const setTitle = page => {
    if (!title) return;
    title.textContent = page.dataset.title;
    if (page.dataset.value){
      const em = document.createElement("em"); em.textContent = page.dataset.value; title.append(em);
    }
  };
  const scroll = track => {
    const dist = Math.max(0, track.scrollWidth - track.parentElement.clientWidth);
    track.getAnimations().forEach(a => a.cancel());
    if (!dist || !MOTION) return pageMs;
    const ms = dist / scrollPxS * 1000 + 2 * hold, h = hold / ms;
    track.animate([
      {transform: "translateX(0)"}, {transform: "translateX(0)", offset: h},
      {transform: `translateX(${-dist}px)`, offset: 1 - h}, {transform: `translateX(${-dist}px)`},
    ], {duration: ms, easing: "linear", fill: "forwards"});
    return ms;
  };
  function step(){
    clearTimeout(timer);
    const all = [...pages.querySelectorAll(".page")].filter(p => !p.dataset.empty);
    const pinned = all.filter(p => p.dataset.title.toLowerCase() === PIN);
    const list = pinned.length ? pinned : all;
    const cur = pages.querySelector(".page.on");
    if (!list.length){ if (cur) cur.classList.remove("on"); timer = setTimeout(step, pageMs); return; }
    const next = list[(list.indexOf(cur) + 1) % list.length];
    if (next !== cur){
      if (cur){ cur.classList.replace("on", "off"); setTimeout(() => cur.classList.remove("off"), 750); }
      next.classList.add("on");
      if (title){
        title.classList.add("swap");
        setTimeout(() => { setTitle(next); title.classList.remove("swap"); }, 300);
      }
    }
    const track = next.querySelector(".ftrack");
    const ms = track ? scroll(track) : pageMs;
    if (bar){
      bar.parentElement.style.visibility = list.length > 1 ? "" : "hidden";
      bar.classList.remove("run"); void bar.offsetWidth;
      bar.style.animationDuration = ms + "ms"; bar.classList.add("run");
    }
    timer = setTimeout(step, ms);
  }
  return {
    // Call after changing page contents: restarts if the current page went empty.
    refresh(){
      const cur = pages.querySelector(".page.on");
      if (!cur || cur.dataset.empty) step();
      else setTitle(cur);
    },
  };
}

/* ------------------------------------------------------------------ public */
window.LFM = {
  S, PARAMS, ID, SIMS, MOTION, URLS, WX_ICONS,
  $, flagUrl, pad, countdown, ago, signed, deltaClass, fitStage, fitText, tighten, overflows,
  paintLicence, paintSR, coin, rotator, renderRivals, renderForm, currentRace, nextActive,
  start(fn){
    render = fn;
    document.fonts.ready.then(load);
    setInterval(load, REFRESH_MS);
  },
};
})();
