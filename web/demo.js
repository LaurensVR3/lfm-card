/* Demo mode (?demo=1): a made-up race so you can set up your OBS scenes any day.
   Your real profile, stats and history are used; the next race, its entry list
   and its result are invented. Timeline from page load:
     0:00  starting soon, the server opens in 1:15
     1:15  practice 1 min, qualifying 1 min, race 2 min
     5:15  race over, "results soon"
     5:30  result: you win from P4 (celebration), results table
   Reload the page to start again. lfm.js asks handle(url) before fetching. */
(() => {
const {S, ID, URLS} = window.LFM;
const RACE_ID = 999999;
const T0 = Date.now();
const START = new Date(Math.ceil((T0 + 75e3) / 1000) * 1000);
const SESSIONS = [["P", 1], ["Q", 1], ["R", 2]];
const RACE_END = START.getTime() + SESSIONS.reduce((n, [, m]) => n + m, 0) * 60e3;
const RESULT_AT = RACE_END + 15e3;
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
    event: {event_name: "LFM Demo Series", sim_id: SIM, website_short_text: ""},
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
    track_name: race.track.track_name, car_model: car, car_name: last ? last.car_name : "Ferrari 296 GT3",
    thumbnail: last ? last.thumbnail : "ferrari.png", class: "GT3", user_split: 1, sof,
    start_pos: MY_START, finishing_pos: MY_FINISH, rating_change: mine.ratingGain, sr_change: 0.12, incidents: 2, points: 1400,
  };
  mine.bestlap = "02:00.412";  // your fastest lap of the race
  return race;
}

window.LFM_DEMO = {
  handle(url){
    const done = Date.now() >= RESULT_AT;
    if (url === URLS.widget){
      // The next race until the result is in, then nothing.
      return Promise.resolve(done ? {race: [], drivers: 0}
        : {race: [{race_id: RACE_ID, event_name: "LFM Demo Series", split: 1, race_date: START.toISOString()}], drivers: 18});
    }
    if (url === URLS.race(RACE_ID)) return race ? Promise.resolve(race) : build();
    if (url.startsWith(URLS.past(1).replace(/limit=1$/, ""))){
      // Real history, plus the demo race once its result is in.
      return fetch(url, {cache: "no-store"}).then(r => r.json()).then(async rows => {
        if (!done) return rows;
        if (!race) await build();
        return [race.pastRow].concat(rows);
      });
    }
    if (url === URLS.live) return Promise.resolve([]);
    if (url === URLS.youtube) return Promise.resolve("");
    return null;
  },
};
})();
