/* Demo mode (?demo=1): a made-up race so you can set up your OBS scenes any day.
   Your real profile, stats and history are used; the next race, its entry list
   and its result are invented. Timeline from page load:
     0:00  starting soon, the server opens in 1:15
     1:15  practice 1 min, qualifying 1 min, race 2 min
     5:15  race over, "results soon"
     5:30  result: you win from P4 (celebration), results table
   Reload the page to start again. lfm.js asks handle(url) before fetching.
   ?demo=team: the same as a team race, with two made-up drivers sharing your car.
   ?demo=<race id>: replays a real past race (its entry list and results) on the
   same short timeline, e.g. to check a team race as one of its drivers. */
(() => {
const {S, ID, URLS} = window.LFM;
const MODE = (window.LFM.PARAMS.get("demo") || "").toLowerCase();
const TEAM = MODE === "team";
const REPLAY = /^\d{4,}$/.test(MODE) ? Number(MODE) : 0;
const RACE_ID = REPLAY || 999999;
const T0 = Date.now();
// ?show=live (the builder's "Show race frame"): already 30 s into a long race, no result.
const LIVE = (window.LFM.PARAMS.get("show") || "").toLowerCase() === "live";
const SESSIONS = LIVE ? [["P", 1], ["Q", 1], ["R", 30]] : [["P", 1], ["Q", 1], ["R", 2]];
const START = new Date(Math.ceil((T0 + (LIVE ? -150e3 : 75e3)) / 1000) * 1000);
const RACE_END = START.getTime() + SESSIONS.reduce((n, [, m]) => n + m, 0) * 60e3;
const RESULT_AT = LIVE ? Infinity : RACE_END + 15e3;
const SIM = 1, CAR_FALLBACK = 32;   // ACC, Ferrari 296 GT3
const MY_START = 4, MY_FINISH = 1;

// LFM API dates are Berlin local time without an offset.
function berlin(d){
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {timeZone: "Europe/Berlin", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"})
    .formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

const RIVALS = [
  ["Jonas", "Becker", "DE"], ["Lucas", "Martin", "FR"], ["Matteo", "Ricci", "IT"], ["Daan", "de Vries", "NL"],
  ["Oliver", "Hughes", "GB"], ["Pablo", "García", "ES"], ["Mikkel", "Hansen", "DK"], ["Tomasz", "Nowak", "PL"],
  ["Elias", "Gruber", "AT"], ["Noah", "Peeters", "BE"], ["Leon", "Schmidt", "DE"], ["Rafael", "Costa", "PT"],
  ["Viktor", "Lindqvist", "SE"], ["Jan", "Novák", "CZ"], ["Luca", "Brunner", "CH"], ["Finn", "Murphy", "IE"],
  ["Anton", "Koskinen", "FI"],
];
// The made-up race; built once, when the profile is known.
let race = null;
async function build(){
  const u = S.user || {};
  const sim = (u.rating_by_sim || []).find(x => x.sim_id === SIM) || {};
  const rating = sim.rating || 2500;
  const last = S.history.find(r => r.sim_id === SIM);
  const car = last ? last.car_model : CAR_FALLBACK;
  // Use your livery from your last ACC race, so the flip shows your car.
  let livery = null;
  if (last){
    try {
      const real = await fetch(URLS.race(last.race_id)).then(r => r.json());
      const me = ((real.participants && real.participants.entries) || []).find(e => String(e.user_id) === ID);
      livery = me && me.livery || null;
    } catch {}
  }
  // Elo spread around yours so you seed P4, as in MY_START.
  const elos = RIVALS.map((_, i) => Math.max(900, Math.round(rating + (MY_START - 1.5 - i) * rating * 0.04)));
  const drivers = RIVALS.map(([first, lastName, origin], i) => ({
    vorname: first, nachname: lastName, origin, elo: elos[i], user_id: 900000 + i, car_model: car,
    license: elos[i] > 4000 ? "PLATINUM" : elos[i] > 2500 ? "GOLD" : "SILVER", is_live: i === 2 || i === 9,
  }));
  drivers.push({vorname: u.vorname || "You", nachname: u.nachname || "", origin: u.origin || "BE", elo: rating,
    user_id: Number(ID), car_model: car, license: sim.license || u.license || "GOLD", livery, is_live: false});
  drivers.sort((a, b) => b.elo - a.elo);
  drivers.forEach((d, i) => Object.assign(d, {raceNumber: i + 1, split: 1, car_class: "GT3"}));
  const sof = Math.round(drivers.reduce((n, d) => n + d.elo, 0) / drivers.length);

  // Finishing order: you win, the rest roughly by Elo with some shuffling.
  const others = drivers.filter(d => String(d.user_id) !== ID)
    .map((d, i) => ({d, k: i + Math.sin(i * 7.3) * 3})).sort((a, b) => a.k - b.k).map(x => x.d);
  const me = drivers.find(d => String(d.user_id) === ID);
  const order = others.slice(0, MY_FINISH - 1).concat(me, others.slice(MY_FINISH - 1));
  const lapsLead = 22;
  const results = order.map((d, i) => {
    const dnf = i === order.length - 1, lapped = i >= order.length - 3 && !dnf;
    const gap = i * 1.9 + i * i * 0.35;
    return {
      user_id: d.user_id, vorname: d.vorname, nachname: d.nachname, origin: d.origin, car_number: d.raceNumber,
      position: i + 1, class_position: i + 1, split: 1, class: "GT3", laps: dnf ? 9 : lapped ? lapsLead - 1 : lapsLead,
      time: i ? "" : "45:12.384", gap: i ? `00:${String(Math.floor(gap)).padStart(2, "0")}.${String(Math.round(gap * 1000) % 1000).padStart(3, "0")}` : "00:00.000",
      bestlap: `02:0${(i % 3)}.${String(400 + i * 37).slice(-3)}`, dnf: dnf ? 1 : 0, dns: 0, dsq: 0,
      ratingGain: Math.round((order.length / 2 - i) * 4 + (d === me ? 12 : 0)),
      positionGain: drivers.indexOf(d) - i, incidents: (i * 3) % 7,
    };
  });
  race = {
    race_id: RACE_ID, season_week: 3, sof, real_weather: 0, live_video: "", videolink: "",
    event: {event_name: "LFM Demo Series", sim_id: SIM, website_short_text: "", event_id: RACE_ID, event_type: "Season"},
    track: {track_name: "Suzuka Circuit", country: "JP", km: 5807, turns: 18, city: "Suzuka", sim_id: SIM,
            thumbnail: "https://cdn.lowfuelmotorsport.com/images/tracks/Suzuka3.jpg"},
    server_settings: {server_settings: {event: {data: {ambientTemp: 21, cloudLevel: 0.35, rain: 0, weatherRandomness: 2,
      sessions: SESSIONS.map(([sessionType, sessionDurationMinutes]) => ({sessionType, sessionDurationMinutes}))}}}},
    participants: {entries: drivers},
    race_results_splits: [{GT3: {OVERALL: results}}],
    race_results: {GT3: {OVERALL: results}},
  };
  const mine = results.find(r => String(r.user_id) === ID);
  race.pastRow = {
    race_id: RACE_ID, race_date: berlin(START), sim_id: SIM, event_name: race.event.event_name,
    event_id: RACE_ID, event_type: "Season", team_event: TEAM ? 1 : 0,
    track_name: race.track.track_name, car_model: car, car_name: last ? last.car_name : "Ferrari 296 GT3",
    thumbnail: last ? last.thumbnail : "ferrari.png", class: "GT3", user_split: 1, sof,
    start_pos: MY_START, finishing_pos: MY_FINISH, rating_change: mine.ratingGain, sr_change: 0.12, incidents: 2, points: 1400,
  };
  mine.bestlap = "02:00.412";  // your fastest lap of the race
  return race;
}

// ?demo=team: every car gets a team name and extra drivers; yours gets two
// made-up teammates. Results are credited to a teammate, as LFM does for one driver per car.
const TEAMS = ["Apex Endurance", "Redline Racing", "Northwind Motorsport", "Blue Flag Racing", "Pitlane Collective",
  "Kerb Hoppers", "Slipstream Esports", "Late Apex Squad", "Full Send Racing", "Tyre Whisperers", "Box Box Racing",
  "Double Stint", "Sector Three", "Lift and Coast", "Trail Brake Team", "Night Stint Racing", "Torque Factory",
  "Apex Hunters", "Green Flag Motorsport", "Undercut Racing"];
const CREW = [["Alex", "Morgan", "GB"], ["Sam", "Keller", "DE"], ["Lena", "Vos", "NL"], ["Marco", "Bianchi", "IT"],
  ["Hugo", "Lambert", "FR"], ["Erik", "Berg", "NO"]];
function teamUp(r){
  const u = S.user || {};
  const drivers = r.participants.entries;
  let extra = 0;
  const cars = drivers.map((d, i) => {
    const mine = String(d.user_id) === ID;
    const mates = (mine ? [0, 1] : i % 3 ? [2 + (i % 4)] : []).map(k => {
      const [first, last, origin] = CREW[k];
      return {vorname: first, nachname: last, origin, elo: Math.round(d.elo * (0.92 + (k % 3) * 0.04)),
              user_id: 800000 + extra++, license: d.license, is_live: mine && k === 1, split: 1};
    });
    const crew = mine ? [mates[0], d, mates[1]] : [d, ...mates];
    return {teamname: mine ? (u.team && u.team.teamname) || "Your Team" : TEAMS[i % TEAMS.length],
            car_number: d.raceNumber, car_model: d.car_model, car_elo: d.elo, car_class: d.car_class,
            livery: d.livery || null, drivers: crew.map(x => ({...x, raceNumber: d.raceNumber, split: 1}))};
  });
  r.participants.entries = cars;
  const carOf = id => cars.find(c => c.drivers.some(x => x.user_id === id));
  const rows = r.race_results.GT3.OVERALL.map(x => {
    const c = carOf(x.user_id), lead = String(x.user_id) === ID ? c.drivers[0] : c.drivers.find(y => y.user_id === x.user_id);
    return {...x, user_id: lead.user_id, vorname: lead.vorname, nachname: lead.nachname, teamname: c.teamname, drivers: c.drivers};
  });
  r.race_results = {GT3: {OVERALL: rows}};
  r.race_results_splits = [{GT3: {OVERALL: rows}}];
  r.event.event_name = r.pastRow.event_name = "LFM Demo Endurance";
  return r;
}

// ?demo=<race id>: a real race on the demo timeline. Sessions are shortened
// (ACC-style servers only); this driver's real result row comes back after the race.
let realRow = null;
async function replay(){
  const real = await fetch(URLS.race(REPLAY), {cache: "no-store"}).then(r => r.json());
  const ev = real.server_settings && real.server_settings.server_settings && real.server_settings.server_settings.event;
  if (ev && ev.data) ev.data.sessions = SESSIONS.map(([sessionType, sessionDurationMinutes]) => ({sessionType, sessionDurationMinutes}));
  race = real;
  return race;
}

const eventName = () => race ? race.event.event_name : TEAM ? "LFM Demo Endurance" : "LFM Demo Series";
const getRace = () => race ? Promise.resolve(race) : REPLAY ? replay() : build().then(r => TEAM ? teamUp(r) : r);

function standings(){
  const me = Number(ID), done = Date.now() >= RESULT_AT, myPos = done ? 2 : 3;
  const rows = race.participants.entries.flatMap(e => e.drivers || [e]).filter(d => d.user_id !== me).slice(0, 40)
    .map(d => ({user_id: d.user_id, vorname: d.vorname, nachname: d.nachname, origin: d.origin, elo: d.elo}));
  rows.splice(myPos - 1, 0, {user_id: me, vorname: "You", nachname: "", elo: 0});
  const all = rows.map((r, i) => ({...r, position: i + 1, points: Math.round(4200 - i * 140 - i * i * 2), division: i < 25 ? 1 : 2, car_class: "GT3"}));
  const div = d => all.filter(r => r.division === d).map((r, i) => ({...r, position: i + 1}));
  return {GT3: {OVERALL: all, 1: div(1), 2: div(2)}};
}
function teamStandings(){
  const mine = race.participants.entries.find(c => (c.drivers || []).some(d => String(d.user_id) === ID));
  const names = race.participants.entries.map(c => c.teamname).filter(n => n && n !== (mine && mine.teamname));
  if (mine) names.splice(1, 0, mine.teamname);
  return {GT3: names.map((teamname, i) => ({teamname, position: i + 1, teampoints: String(3100 - i * 160), car_class: "GT3"}))};
}

window.LFM_DEMO = {
  handle(url){
    const done = Date.now() >= RESULT_AT;
    if (url === URLS.widget){
      // The next race until the result is in, then nothing.
      if (done) return Promise.resolve({race: [], drivers: 0});
      // A made-up race needs the profile, which loads alongside this; a replay doesn't.
      return (REPLAY ? getRace() : Promise.resolve()).then(() => ({race: [{race_id: RACE_ID, event_name: eventName(), split: 1,
        race_date: START.toISOString()}], drivers: race ? race.participants.entries.length : 18}));
    }
    if (url === URLS.race(RACE_ID)) return getRace();
    if (url.startsWith(URLS.past(1).replace(/limit=1$/, ""))){
      // Real history, plus the demo race once its result is in. A replayed race's
      // real row is held back until then, and moved to the demo date.
      return fetch(url, {cache: "no-store"}).then(r => r.json()).then(async rows => {
        if (REPLAY){
          const real = rows.find(r => r.race_id === REPLAY);
          if (real) realRow = real;
          rows = rows.filter(r => r.race_id !== REPLAY);
          return done && realRow ? [{...realRow, race_date: berlin(START)}].concat(rows) : rows;
        }
        if (!done) return rows;
        await getRace();
        return [race.pastRow].concat(rows);
      });
    }
    // A made-up championship: you're P3 overall (P2 after the win), your team P2.
    if (url === URLS.standings(RACE_ID) && !REPLAY) return getRace().then(standings);
    if (url === URLS.teamStandings(RACE_ID) && !REPLAY) return getRace().then(teamStandings);
    if (url === URLS.live) return Promise.resolve([]);
    if (url === URLS.youtube) return Promise.resolve("");
    return null;
  },
};
})();
