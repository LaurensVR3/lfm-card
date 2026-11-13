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
// ?hide=field,form,... switches parts off (see the manual); "broadcast" = ?broadcast=off.
const HIDE = new Set((PARAMS.get("hide") || "").toLowerCase().split(/[\s,]+/).filter(Boolean));
const hidden = k => HIDE.has(k);
const BROADCAST = PARAMS.get("broadcast") !== "off" && !HIDE.has("broadcast");
const BROADCAST_MS = 10 * 60e3;  // YouTube schedule refresh (nginx caches it for as long)
const STANDINGS_MS = 30 * 60e3;  // championship standings refresh (they're big and change once a race)
const TREND_SIZE = 30;           // races in the rating / safety rating trend
// Official LFM Twitch channels, as listed on lowfuelmotorsport.com.
const LFM_TWITCH = {lowfuelmotorsport_en:"EN", lowfuelmotorsport_de:"DE", lowfuelmotorsport_es:"ES"};
const LFM_YOUTUBE = "youtube.com/@LowFuelMotorsport";
// Option lookup that ignores case, so ?HEXCODE= and ?hexcode= both work.
const param = name => { for (const [k, v] of PARAMS) if (k.toLowerCase() === name) return v; return null; };
// ?HEXCODE=FF0033 (or F03, #FF0033): accent colour instead of the licence colour.
const HEXCODE = (() => {
  const v = (param("hexcode") || param("accent") || "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(v)) return "#" + v;
  if (/^[0-9a-f]{3}$/i.test(v)) return "#" + v.replace(/./g, c => c + c);
  return null;
})();
// ?aspect=21:9 / 32:9 / 2560x1080 forces the canvas shape; otherwise it follows
// the OBS source size. "21:9" is a marketing name: real ultrawide screens are
// wider (2560x1080 = 2.37, 3440x1440 = 2.39), so it means 2560x1080 here.
const ASPECT = (() => {
  const v = (param("aspect") || "").trim(), m = v.match(/^(\d+(?:\.\d+)?)\s*[:x\/]\s*(\d+(?:\.\d+)?)$/i);
  if (m && m[1] == 21 && m[2] == 9) return 2560 / 1080;
  const r = m ? m[1] / m[2] : Number(v);
  return r > 0 ? r : null;
})();
/* ------------------------------------------------------------------ language
   ?lang=de|es|fr|it|nl|pt. Static labels are translated by matching their text
   on load; strings built in code go through t(). Missing keys stay English. */
const LANG = (param("lang") || "").toLowerCase().slice(0, 2);
const I18N = {
  de: {
    "latest": "zuletzt",
    "overall": "gesamt",
    "Trend": "Verlauf", "Championship": "Meisterschaft", "{n} pts": "{n} Pkt.", "Div {n}": "Div. {n}",
    "Drivers": "Fahrer", "{n} cars": "{n} Autos", "{n} teammates": "{n} Teamkollegen", "{n} teammate": "{n} Teamkollege",
    "Can't load LFM driver {id}. Check the ID in the URL. Trying again…": "LFM-Fahrer {id} kann nicht geladen werden. Prüfe die ID in der URL. Neuer Versuch läuft…",
    "{n} turns": "{n} Kurven",
    "Practice": "Training", "Qualifying": "Qualifying", "Quali": "Quali", "Race": "Rennen", "{n} laps": "{n} Runden",
    "{n} min ago": "vor {n} Min.", "{n}h ago": "vor {n} Std.", "yesterday": "gestern", "{n} days ago": "vor {n} Tagen",
    "Heavy rain": "Starkregen", "Rain": "Regen", "Light rain": "Leichter Regen", "Clear": "Klar", "Partly cloudy": "Leicht bewölkt",
    "Cloudy": "Bewölkt", "Overcast": "Bedeckt", "Storm": "Gewitter", "Snow": "Schnee", "Fog": "Nebel", "Hazy": "Dunstig",
    "Random": "Zufällig", "Real weather": "Echtes Wetter", "Dynamic": "Dynamisch", "Static": "Statisch",
    "Victory": "Sieg", "Win #{n}": "Sieg Nr. {n}", "Podium": "Podium", "New personal best": "Neue Bestmarke",
    "{n} rating": "{n} Rating", "{n} starts": "{n} Starts", "on Low Fuel Motorsport": "auf Low Fuel Motorsport",
    "Promoted": "Aufgestiegen", "Licence": "Lizenz", "{n} ranked races": "{n} gewertete Rennen",
    "Racing now": "Rennen läuft", "Next race": "Nächstes Rennen", "{n} driver": "{n} Fahrer", "{n} drivers": "{n} Fahrer",
    "LIVE": "LIVE", "Live": "Live", "in {t}": "in {t}", "Last race": "Letztes Rennen", "from P{n}": "von P{n}", "of {n}": "von {n}",
    "Starts": "Starts", "Wins": "Siege", "Podiums": "Podien", "Poles": "Poles", "Podium rate": "Podiumsquote",
    "{n} min race": "{n} Min. Rennen", "Seed of {n}": "Setzplatz von {n}", "Start": "Start", "Best lap": "Beste Runde",
    "Field": "Feld", "Form": "Form", "First LFM race here": "Erstes LFM-Rennen hier", "start here": "Start hier",
    "starts here": "Starts hier", "win": "Sieg", "wins": "Siege", "podium": "Podium", "podiums": "Podien", "Best": "Bestes",
    "Last": "Zuletzt", "{n} streaming": "{n} streamen", "Live now on LFM": "Jetzt live bei LFM",
    "Official LFM broadcast": "Offizielle LFM-Übertragung", "Seed P{p} of {n}": "Setzplatz P{p} von {n}",
    "Starting": "Start in", "Finished": "Beendet", "Results soon": "Ergebnis folgt", "Week {n}": "Woche {n}", "Door": "Startnummer",
    "Seed": "Setzplatz", "Weather": "Wetter", "rain": "Regen", "Conditions": "Bedingungen", "Car": "Auto", "Finish": "Ziel",
    "Rating": "Rating", "Safety": "Safety", "Incidents": "Vorfälle", "Starting soon": "Gleich geht's los", "{s} now": "{s} läuft",
    "Started {t}": "Gestartet {t}", "Result": "Ergebnis", "Stay tuned": "Dranbleiben", "TBA": "Folgt",
    "No race scheduled yet": "Noch kein Rennen geplant", "Entry list": "Starterliste", "Results": "Ergebnis",
    "LFM data {n} min old": "LFM-Daten {n} Min. alt", "Career": "Karriere", "Details": "Details", "Division": "Division",
    "Driver profile": "Fahrerprofil", "Grid": "Startplatz", "Next": "Nächstes", "Track": "Strecke", "Race details": "Renndetails",
    "Safety rating": "Safety Rating", "SOF": "SOF", "last 10": "letzte 10", "LFM RATING": "LFM RATING", "LFM Rating": "LFM Rating",
  },
  es: {
    "latest": "último",
    "overall": "general",
    "Trend": "Tendencia", "Championship": "Campeonato", "{n} pts": "{n} pts", "Div {n}": "Div. {n}",
    "Drivers": "Pilotos", "{n} cars": "{n} coches", "{n} teammates": "{n} compañeros", "{n} teammate": "{n} compañero",
    "Can't load LFM driver {id}. Check the ID in the URL. Trying again…": "No se puede cargar el piloto de LFM {id}. Revisa el ID en la URL. Reintentando…",
    "{n} turns": "{n} curvas",
    "Practice": "Libres", "Qualifying": "Clasificación", "Quali": "Clasif.", "Race": "Carrera", "{n} laps": "{n} vueltas",
    "{n} min ago": "hace {n} min", "{n}h ago": "hace {n} h", "yesterday": "ayer", "{n} days ago": "hace {n} días",
    "Heavy rain": "Lluvia fuerte", "Rain": "Lluvia", "Light rain": "Lluvia ligera", "Clear": "Despejado", "Partly cloudy": "Parcialmente nublado",
    "Cloudy": "Nublado", "Overcast": "Cubierto", "Storm": "Tormenta", "Snow": "Nieve", "Fog": "Niebla", "Hazy": "Bruma",
    "Random": "Aleatorio", "Real weather": "Clima real", "Dynamic": "Dinámico", "Static": "Estático",
    "Victory": "Victoria", "Win #{n}": "Victoria n.º {n}", "Podium": "Podio", "New personal best": "Nuevo récord personal",
    "{n} rating": "{n} de rating", "{n} starts": "{n} salidas", "on Low Fuel Motorsport": "en Low Fuel Motorsport",
    "Promoted": "Ascendido", "Licence": "Licencia", "{n} ranked races": "{n} carreras puntuables",
    "Racing now": "En carrera", "Next race": "Próxima carrera", "{n} driver": "{n} piloto", "{n} drivers": "{n} pilotos",
    "LIVE": "EN VIVO", "Live": "En vivo", "in {t}": "en {t}", "Last race": "Última carrera", "from P{n}": "desde P{n}", "of {n}": "de {n}",
    "Starts": "Salidas", "Wins": "Victorias", "Podiums": "Podios", "Poles": "Poles", "Podium rate": "% de podios",
    "{n} min race": "carrera de {n} min", "Seed of {n}": "Seed de {n}", "Start": "Salida", "Best lap": "Mejor vuelta",
    "Field": "Parrilla", "Form": "Forma", "First LFM race here": "Primera carrera LFM aquí", "start here": "salida aquí",
    "starts here": "salidas aquí", "win": "victoria", "wins": "victorias", "podium": "podio", "podiums": "podios", "Best": "Mejor",
    "Last": "Última", "{n} streaming": "{n} en directo", "Live now on LFM": "En directo en LFM",
    "Official LFM broadcast": "Retransmisión oficial de LFM", "Seed P{p} of {n}": "Seed P{p} de {n}",
    "Starting": "Empieza en", "Finished": "Terminada", "Results soon": "Resultados pronto", "Week {n}": "Semana {n}", "Door": "Dorsal",
    "Seed": "Seed", "Weather": "Clima", "rain": "lluvia", "Conditions": "Condiciones", "Car": "Coche", "Finish": "Final",
    "Rating": "Rating", "Safety": "Seguridad", "Incidents": "Incidentes", "Starting soon": "Empezamos pronto", "{s} now": "{s} en curso",
    "Started {t}": "Empezó {t}", "Result": "Resultado", "Stay tuned": "Atentos", "TBA": "Pronto",
    "No race scheduled yet": "Sin carrera programada", "Entry list": "Inscritos", "Results": "Resultados",
    "LFM data {n} min old": "Datos de LFM de hace {n} min", "Career": "Trayectoria", "Details": "Detalles", "Division": "División",
    "Driver profile": "Perfil del piloto", "Grid": "Parrilla", "Next": "Próxima", "Track": "Circuito", "Race details": "Detalles",
    "Safety rating": "Safety rating", "last 10": "últimas 10", "LFM RATING": "RATING LFM", "LFM Rating": "Rating LFM",
  },
  fr: {
    "latest": "dernier",
    "overall": "au général",
    "Trend": "Tendance", "Championship": "Championnat", "{n} pts": "{n} pts", "Div {n}": "Div. {n}",
    "Drivers": "Pilotes", "{n} cars": "{n} voitures", "{n} teammates": "{n} coéquipiers", "{n} teammate": "{n} coéquipier",
    "Can't load LFM driver {id}. Check the ID in the URL. Trying again…": "Impossible de charger le pilote LFM {id}. Vérifie l'ID dans l'URL. Nouvel essai…",
    "{n} turns": "{n} virages",
    "Practice": "Essais", "Qualifying": "Qualifications", "Quali": "Qualifs", "Race": "Course", "{n} laps": "{n} tours",
    "{n} min ago": "il y a {n} min", "{n}h ago": "il y a {n} h", "yesterday": "hier", "{n} days ago": "il y a {n} jours",
    "Heavy rain": "Forte pluie", "Rain": "Pluie", "Light rain": "Pluie légère", "Clear": "Dégagé", "Partly cloudy": "Partiellement nuageux",
    "Cloudy": "Nuageux", "Overcast": "Couvert", "Storm": "Orage", "Snow": "Neige", "Fog": "Brouillard", "Hazy": "Brumeux",
    "Random": "Aléatoire", "Real weather": "Météo réelle", "Dynamic": "Dynamique", "Static": "Statique",
    "Victory": "Victoire", "Win #{n}": "Victoire n° {n}", "Podium": "Podium", "New personal best": "Nouveau record perso",
    "{n} rating": "{n} de rating", "{n} starts": "{n} départs", "on Low Fuel Motorsport": "sur Low Fuel Motorsport",
    "Promoted": "Promu", "Licence": "Licence", "{n} ranked races": "{n} courses classées",
    "Racing now": "En course", "Next race": "Prochaine course", "{n} driver": "{n} pilote", "{n} drivers": "{n} pilotes",
    "LIVE": "EN DIRECT", "Live": "En direct", "in {t}": "dans {t}", "Last race": "Dernière course", "from P{n}": "depuis P{n}", "of {n}": "sur {n}",
    "Starts": "Départs", "Wins": "Victoires", "Podiums": "Podiums", "Poles": "Poles", "Podium rate": "Taux de podium",
    "{n} min race": "course de {n} min", "Seed of {n}": "Seed sur {n}", "Start": "Départ", "Best lap": "Meilleur tour",
    "Field": "Plateau", "Form": "Forme", "First LFM race here": "Première course LFM ici", "start here": "départ ici",
    "starts here": "départs ici", "win": "victoire", "wins": "victoires", "podium": "podium", "podiums": "podiums", "Best": "Meilleur",
    "Last": "Dernier", "{n} streaming": "{n} en stream", "Live now on LFM": "En direct sur LFM",
    "Official LFM broadcast": "Diffusion officielle LFM", "Seed P{p} of {n}": "Seed P{p} sur {n}",
    "Starting": "Départ dans", "Finished": "Terminé", "Results soon": "Résultats bientôt", "Week {n}": "Semaine {n}", "Door": "Numéro",
    "Seed": "Seed", "Weather": "Météo", "rain": "pluie", "Conditions": "Conditions", "Car": "Voiture", "Finish": "Arrivée",
    "Rating": "Rating", "Safety": "Sécurité", "Incidents": "Incidents", "Starting soon": "Ça commence bientôt", "{s} now": "{s} en cours",
    "Started {t}": "Départ {t}", "Result": "Résultat", "Stay tuned": "Restez connectés", "TBA": "À venir",
    "No race scheduled yet": "Aucune course prévue", "Entry list": "Engagés", "Results": "Résultats",
    "LFM data {n} min old": "Données LFM d'il y a {n} min", "Career": "Carrière", "Details": "Détails", "Division": "Division",
    "Driver profile": "Profil pilote", "Grid": "Grille", "Next": "Suivante", "Track": "Circuit", "Race details": "Détails",
    "Safety rating": "Safety rating", "last 10": "10 dernières", "LFM RATING": "RATING LFM", "LFM Rating": "Rating LFM",
  },
  it: {
    "latest": "ultimo",
    "overall": "assoluto",
    "Trend": "Andamento", "Championship": "Campionato", "{n} pts": "{n} pt", "Div {n}": "Div. {n}",
    "Drivers": "Piloti", "{n} cars": "{n} auto", "{n} teammates": "{n} compagni", "{n} teammate": "{n} compagno",
    "Can't load LFM driver {id}. Check the ID in the URL. Trying again…": "Impossibile caricare il pilota LFM {id}. Controlla l'ID nell'URL. Nuovo tentativo…",
    "{n} turns": "{n} curve",
    "Practice": "Libere", "Qualifying": "Qualifiche", "Quali": "Quali", "Race": "Gara", "{n} laps": "{n} giri",
    "{n} min ago": "{n} min fa", "{n}h ago": "{n} h fa", "yesterday": "ieri", "{n} days ago": "{n} giorni fa",
    "Heavy rain": "Pioggia forte", "Rain": "Pioggia", "Light rain": "Pioggia leggera", "Clear": "Sereno", "Partly cloudy": "Poco nuvoloso",
    "Cloudy": "Nuvoloso", "Overcast": "Coperto", "Storm": "Temporale", "Snow": "Neve", "Fog": "Nebbia", "Hazy": "Foschia",
    "Random": "Casuale", "Real weather": "Meteo reale", "Dynamic": "Dinamico", "Static": "Statico",
    "Victory": "Vittoria", "Win #{n}": "Vittoria n. {n}", "Podium": "Podio", "New personal best": "Nuovo record personale",
    "{n} rating": "{n} di rating", "{n} starts": "{n} partenze", "on Low Fuel Motorsport": "su Low Fuel Motorsport",
    "Promoted": "Promosso", "Licence": "Licenza", "{n} ranked races": "{n} gare classificate",
    "Racing now": "In gara", "Next race": "Prossima gara", "{n} driver": "{n} pilota", "{n} drivers": "{n} piloti",
    "LIVE": "LIVE", "Live": "Live", "in {t}": "tra {t}", "Last race": "Ultima gara", "from P{n}": "da P{n}", "of {n}": "su {n}",
    "Starts": "Partenze", "Wins": "Vittorie", "Podiums": "Podi", "Poles": "Pole", "Podium rate": "% podi",
    "{n} min race": "gara di {n} min", "Seed of {n}": "Seed su {n}", "Start": "Partenza", "Best lap": "Giro veloce",
    "Field": "Griglia", "Form": "Forma", "First LFM race here": "Prima gara LFM qui", "start here": "partenza qui",
    "starts here": "partenze qui", "win": "vittoria", "wins": "vittorie", "podium": "podio", "podiums": "podi", "Best": "Migliore",
    "Last": "Ultima", "{n} streaming": "{n} in streaming", "Live now on LFM": "Ora in diretta su LFM",
    "Official LFM broadcast": "Diretta ufficiale LFM", "Seed P{p} of {n}": "Seed P{p} su {n}",
    "Starting": "Si parte tra", "Finished": "Finita", "Results soon": "Risultati a breve", "Week {n}": "Settimana {n}", "Door": "Numero",
    "Seed": "Seed", "Weather": "Meteo", "rain": "pioggia", "Conditions": "Condizioni", "Car": "Auto", "Finish": "Arrivo",
    "Rating": "Rating", "Safety": "Sicurezza", "Incidents": "Incidenti", "Starting soon": "Si parte a breve", "{s} now": "{s} in corso",
    "Started {t}": "Partita {t}", "Result": "Risultato", "Stay tuned": "Restate sintonizzati", "TBA": "A breve",
    "No race scheduled yet": "Nessuna gara in programma", "Entry list": "Iscritti", "Results": "Risultati",
    "LFM data {n} min old": "Dati LFM di {n} min fa", "Career": "Carriera", "Details": "Dettagli", "Division": "Divisione",
    "Driver profile": "Profilo pilota", "Grid": "Griglia", "Next": "Prossima", "Track": "Circuito", "Race details": "Dettagli",
    "Safety rating": "Safety rating", "last 10": "ultime 10", "LFM RATING": "RATING LFM", "LFM Rating": "Rating LFM",
  },
  nl: {
    "latest": "laatste",
    "overall": "totaal",
    "Trend": "Verloop", "Championship": "Kampioenschap", "{n} pts": "{n} ptn", "Div {n}": "Div. {n}",
    "Drivers": "Rijders", "{n} cars": "{n} auto's", "{n} teammates": "{n} teamgenoten", "{n} teammate": "{n} teamgenoot",
    "Can't load LFM driver {id}. Check the ID in the URL. Trying again…": "Kan LFM-coureur {id} niet laden. Controleer de ID in de URL. Opnieuw proberen…",
    "{n} turns": "{n} bochten",
    "Practice": "Training", "Qualifying": "Kwalificatie", "Quali": "Kwali", "Race": "Race", "{n} laps": "{n} ronden",
    "{n} min ago": "{n} min geleden", "{n}h ago": "{n} u geleden", "yesterday": "gisteren", "{n} days ago": "{n} dagen geleden",
    "Heavy rain": "Zware regen", "Rain": "Regen", "Light rain": "Lichte regen", "Clear": "Helder", "Partly cloudy": "Half bewolkt",
    "Cloudy": "Bewolkt", "Overcast": "Zwaar bewolkt", "Storm": "Onweer", "Snow": "Sneeuw", "Fog": "Mist", "Hazy": "Nevelig",
    "Random": "Willekeurig", "Real weather": "Echt weer", "Dynamic": "Dynamisch", "Static": "Statisch",
    "Victory": "Overwinning", "Win #{n}": "Zege nr. {n}", "Podium": "Podium", "New personal best": "Nieuw persoonlijk record",
    "{n} rating": "{n} rating", "{n} starts": "{n} starts", "on Low Fuel Motorsport": "op Low Fuel Motorsport",
    "Promoted": "Gepromoveerd", "Licence": "Licentie", "{n} ranked races": "{n} gerankte races",
    "Racing now": "Nu aan het racen", "Next race": "Volgende race", "{n} driver": "{n} coureur", "{n} drivers": "{n} coureurs",
    "LIVE": "LIVE", "Live": "Live", "in {t}": "over {t}", "Last race": "Laatste race", "from P{n}": "vanaf P{n}", "of {n}": "van {n}",
    "Starts": "Starts", "Wins": "Zeges", "Podiums": "Podiums", "Poles": "Poles", "Podium rate": "Podiumratio",
    "{n} min race": "race van {n} min", "Seed of {n}": "Seed van {n}", "Start": "Start", "Best lap": "Snelste ronde",
    "Field": "Veld", "Form": "Vorm", "First LFM race here": "Eerste LFM-race hier", "start here": "start hier",
    "starts here": "starts hier", "win": "zege", "wins": "zeges", "podium": "podium", "podiums": "podiums", "Best": "Beste",
    "Last": "Laatste", "{n} streaming": "{n} streamen", "Live now on LFM": "Nu live op LFM",
    "Official LFM broadcast": "Officiële LFM-uitzending", "Seed P{p} of {n}": "Seed P{p} van {n}",
    "Starting": "Start over", "Finished": "Afgelopen", "Results soon": "Uitslag volgt", "Week {n}": "Week {n}", "Door": "Startnummer",
    "Seed": "Seed", "Weather": "Weer", "rain": "regen", "Conditions": "Omstandigheden", "Car": "Auto", "Finish": "Finish",
    "Rating": "Rating", "Safety": "Safety", "Incidents": "Incidenten", "Starting soon": "We beginnen zo", "{s} now": "{s} bezig",
    "Started {t}": "Gestart {t}", "Result": "Uitslag", "Stay tuned": "Blijf kijken", "TBA": "Volgt",
    "No race scheduled yet": "Nog geen race gepland", "Entry list": "Deelnemers", "Results": "Uitslag",
    "LFM data {n} min old": "LFM-data {n} min oud", "Career": "Carrière", "Details": "Details", "Division": "Divisie",
    "Driver profile": "Coureursprofiel", "Grid": "Grid", "Next": "Volgende", "Track": "Circuit", "Race details": "Racedetails",
    "Safety rating": "Safety rating", "last 10": "laatste 10", "LFM RATING": "LFM RATING", "LFM Rating": "LFM Rating",
  },
  pt: {
    "latest": "último",
    "overall": "geral",
    "Trend": "Tendência", "Championship": "Campeonato", "{n} pts": "{n} pts", "Div {n}": "Div. {n}",
    "Drivers": "Pilotos", "{n} cars": "{n} carros", "{n} teammates": "{n} colegas de equipe", "{n} teammate": "{n} colega de equipe",
    "Can't load LFM driver {id}. Check the ID in the URL. Trying again…": "Não foi possível carregar o piloto LFM {id}. Verifique o ID na URL. Tentando de novo…",
    "{n} turns": "{n} curvas",
    "Practice": "Treino", "Qualifying": "Qualificação", "Quali": "Quali", "Race": "Corrida", "{n} laps": "{n} voltas",
    "{n} min ago": "há {n} min", "{n}h ago": "há {n} h", "yesterday": "ontem", "{n} days ago": "há {n} dias",
    "Heavy rain": "Chuva forte", "Rain": "Chuva", "Light rain": "Chuva fraca", "Clear": "Limpo", "Partly cloudy": "Parcialmente nublado",
    "Cloudy": "Nublado", "Overcast": "Encoberto", "Storm": "Tempestade", "Snow": "Neve", "Fog": "Nevoeiro", "Hazy": "Névoa",
    "Random": "Aleatório", "Real weather": "Clima real", "Dynamic": "Dinâmico", "Static": "Estático",
    "Victory": "Vitória", "Win #{n}": "Vitória n.º {n}", "Podium": "Pódio", "New personal best": "Novo recorde pessoal",
    "{n} rating": "{n} de rating", "{n} starts": "{n} largadas", "on Low Fuel Motorsport": "no Low Fuel Motorsport",
    "Promoted": "Promovido", "Licence": "Licença", "{n} ranked races": "{n} corridas ranqueadas",
    "Racing now": "Em corrida", "Next race": "Próxima corrida", "{n} driver": "{n} piloto", "{n} drivers": "{n} pilotos",
    "LIVE": "AO VIVO", "Live": "Ao vivo", "in {t}": "em {t}", "Last race": "Última corrida", "from P{n}": "de P{n}", "of {n}": "de {n}",
    "Starts": "Largadas", "Wins": "Vitórias", "Podiums": "Pódios", "Poles": "Poles", "Podium rate": "% de pódios",
    "{n} min race": "corrida de {n} min", "Seed of {n}": "Seed de {n}", "Start": "Largada", "Best lap": "Melhor volta",
    "Field": "Grid", "Form": "Forma", "First LFM race here": "Primeira corrida LFM aqui", "start here": "largada aqui",
    "starts here": "largadas aqui", "win": "vitória", "wins": "vitórias", "podium": "pódio", "podiums": "pódios", "Best": "Melhor",
    "Last": "Última", "{n} streaming": "{n} transmitindo", "Live now on LFM": "Ao vivo agora na LFM",
    "Official LFM broadcast": "Transmissão oficial da LFM", "Seed P{p} of {n}": "Seed P{p} de {n}",
    "Starting": "Começa em", "Finished": "Terminada", "Results soon": "Resultados em breve", "Week {n}": "Semana {n}", "Door": "Número",
    "Seed": "Seed", "Weather": "Clima", "rain": "chuva", "Conditions": "Condições", "Car": "Carro", "Finish": "Chegada",
    "Rating": "Rating", "Safety": "Segurança", "Incidents": "Incidentes", "Starting soon": "Começando em breve", "{s} now": "{s} agora",
    "Started {t}": "Começou {t}", "Result": "Resultado", "Stay tuned": "Fiquem ligados", "TBA": "Em breve",
    "No race scheduled yet": "Nenhuma corrida marcada", "Entry list": "Inscritos", "Results": "Resultados",
    "LFM data {n} min old": "Dados da LFM de {n} min atrás", "Career": "Carreira", "Details": "Detalhes", "Division": "Divisão",
    "Driver profile": "Perfil do piloto", "Grid": "Grid", "Next": "Próxima", "Track": "Circuito", "Race details": "Detalhes",
    "Safety rating": "Safety rating", "last 10": "últimas 10", "LFM RATING": "RATING LFM", "LFM Rating": "Rating LFM",
  },
};
function t(key, vars){
  let out = (I18N[LANG] && I18N[LANG][key]) || key;
  if (vars) out = out.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  return out;
}
function translatePage(){
  // Page titles of the rotators / side panel: data-title stays the ?page= key.
  document.querySelectorAll("[data-title]").forEach(el => el.dataset.label = t(el.dataset.title));
  const dict = I18N[LANG];
  if (!dict) return;
  document.documentElement.lang = LANG;
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walk.nextNode());){
    const key = n.nodeValue.trim();
    if (key && dict[key]) n.nodeValue = n.nodeValue.replace(key, dict[key]);
  }
}

// ?sound=off (or 1-100 for the volume): the short sting that plays with a celebration.
const SOUND = (() => {
  const v = (param("sound") || "").toLowerCase();
  if (/^(off|no|false|mute|0)$/.test(v)) return 0;
  return Number(v) > 0 ? Math.min(100, Number(v)) / 100 : 0.6;
})();
// OBS scene switching: ?scenes=off, ?scene-race= / ?scene-result= for other scene names.
const SCENES_ON = !/^(off|no|false|0)$/i.test(param("scenes") || "");
const SCENE_RACE = (param("scene-race") || "").trim() || "LFM Racing";
const SCENE_RESULT = (param("scene-result") || "").trim() || "LFM Starting soon";
const SCENE_LEAD_MS = 60e3;      // switch to the racing scene this long before the server opens

// ?demo=1: a made-up race starting in a minute, with your real profile (demo.js).
// demo=team: a team race; demo=<race id>: replay a real race (see demo.js).
const DEMO = /^(1|on|true|yes|team|\d{4,})$/i.test(param("demo") || "");
// ?bg=off: no card / scene background, for putting the overlay over your own.
const NOBG = /^(off|none|0|transparent)$/i.test(param("bg") || "");
if (!MOTION) document.documentElement.classList.add("still");
if (NOBG) document.documentElement.classList.add("nobg");
HIDE.forEach(k => document.documentElement.classList.add("hide-" + k));

// The JSON APIs send Access-Control-Allow-Origin: *, so they are fetched directly.
// The original card HTML (only source of the next-race info) isn't CORS-enabled,
// so it goes through a same-origin nginx proxy.
const API = "https://api3.lowfuelmotorsport.com/api";
const URLS = {
  // Next race as JSON (what the official card itself polls). CORS-open.
  widget: `https://api.lowfuelmotorsport.de/api/licenseWidgetUserData/${ID}`,
  user:  `${API}/users/getUserData/${ID}`,
  stats: `${API}/users/getUserStats/${ID}`,
  past:  n => `${API}/users/getUsersPastRaces/${ID}?start=0&limit=${n}`,
  race:  id => `${API}/race/${id}`,
  cars:  `${API}/lists/getCars`,
  // Championship standings of a season event: {class: {OVERALL | division: [rows]}}; team events: {class: [teams]}.
  standings: id => `${API}/v2/seasons/getSeasonStandings/${id}`,
  teamStandings: id => `${API}/v2/seasons/getSeasonTeamStandings/${id}`,
  card:  `/lfm-api/lfmlicense/${ID}`,    // fallback when the widget JSON fails
  // Which LFM-listed Twitch channels are live right now (Twitch "streams" rows). CORS-open.
  live:  `${API}/checkBroadcaster`,
  // LFM's YouTube /streams page, through a cached same-origin nginx proxy.
  youtube: `/lfm-api/youtube-streams`,
  // Screenshot of an uploaded LFM livery (transparent PNG). The id is base64'd, as on lowfuelmotorsport.com.
  livery: id => `${API}/liveries/screenshot/${btoa(String(id))}?width=1200`,
  // Manufacturer logo (transparent PNG); file names come from the car list ("ferrari.png").
  logo: file => `https://cdn.lowfuelmotorsport.com/images/manufacturers/${file}`,
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
// Country names in the overlay's language (?lang=), English otherwise.
const regionNames = (() => { try { return new Intl.DisplayNames([LANG || "en", "en"], {type:"region"}); }
                           catch { return new Intl.DisplayNames(["en"], {type:"region"}); } })();
const flagUrl = cc => cc ? `https://flagcdn.com/${cc.toLowerCase()}.svg` : "";
const countryName = cc => { try { return regionNames.of(cc.toUpperCase()); } catch { return cc; } };
const pad = n => String(n).padStart(2, "0");
const licenceKey = l => String(l || "").toUpperCase().replace(/[+\s]/g, "");
// Demo mode answers some URLs itself (a made-up race); everything else is fetched.
const demoHit = url => DEMO && window.LFM_DEMO ? window.LFM_DEMO.handle(url) : null;
const getJSON = url => demoHit(url) || fetch(url, {cache:"no-store"}).then(r => r.ok ? r.json() : Promise.reject(r.status));
const getText = url => demoHit(url) || fetch(url, {cache:"no-store"}).then(r => r.ok ? r.text() : Promise.reject(r.status));
const store = {
  get(k){ try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// Scale the design canvas to fit the OBS source. The height is fixed; the
// width grows from the 16:9 design (w) up to 32:9 (2 * w) to match the source,
// or the ?aspect= option. <html> gets .wide (about 21:9 and up) and .ultra
// (about 32:9) so layouts can use the extra room. STAGE.w is the canvas width.
const STAGE = {w: 0, h: 0, wide: false, ultra: false};
// opts.fixed: the canvas keeps its shape (mini card).
function fitStage(w, h, opts = {}){
  const stage = $("stage"), root = document.documentElement.classList;
  const fit = () => {
    // A forced aspect close to the source shape (within 8%) follows the source,
    // so e.g. aspect=21:9 fills both 2560x1080 and 3440x1440 exactly.
    const src = h * innerWidth / innerHeight, forced = ASPECT && w * ASPECT / (16 / 9);
    const want = forced && Math.abs(src / forced - 1) > 0.08 ? forced : src;
    const cw = opts.fixed ? w : Math.round(Math.min(2 * w, Math.max(w, want || w)));
    const changed = cw !== STAGE.w;
    Object.assign(STAGE, {w: cw, h, wide: cw >= 1.15 * w, ultra: cw >= 1.65 * w});
    stage.style.setProperty("--w", cw + "px");
    stage.style.setProperty("--h", h + "px");
    stage.style.setProperty("--s", Math.min(innerWidth / cw, innerHeight / h));
    root.toggle("wide", STAGE.wide); root.toggle("ultra", STAGE.ultra);
    if (changed && S.view) render(S);  // re-fit text and lists to the new width
  };
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
  if (m < 60) return t("{n} min ago", {n: m});
  const h = Math.round(m / 60);
  if (h < 24) return t("{n}h ago", {n: h});
  const d = Math.round(h / 24);
  return d === 1 ? t("yesterday") : t("{n} days ago", {n: d});
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
// on the dark card, keeping their hue. A ?HEXCODE= colour is used as given.
function setAccent(hex, exact = false){
  const root = document.documentElement.style;
  if (!hex){ for (const p of ["--volt","--volt-rgb","--on-volt"]) root.removeProperty(p); return; }
  const base = hex.match(/\w\w/g).map(h => parseInt(h, 16));
  let rgb = base;
  for (let t = 0; !exact && t <= 1 && (luminance(rgb) + 0.05) / (BG_LUM + 0.05) < 3.2; t += 0.05)
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
  okAt: 0,         // last successful profile fetch
  broadcast: null, // official LFM stream of the next race, see loadBroadcast()
  standings: null, // championship position in the series on screen, see loadStandings()
};
let carNames = null, carLogos = new Map();
const realLogo = f => f && !/placeholder/i.test(f) ? f : null;
const raceCache = new Map();  // finished race id -> {livery, bestLap, classPos}

async function loadCarNames(){
  if (!carNames) carNames = getJSON(URLS.cars).then(cars => {
    carLogos = new Map(cars.filter(c => realLogo(c.thumbnail)).map(c => [`${c.sim_id}:${c.server_value}`, c.thumbnail]));
    return new Map(cars.map(c => [`${c.sim_id}:${c.server_value}`, c.car_name]));
  });
  return carNames;
}

/* ------------------------------------------------------------------ parsing */
// "2026-11-10T20:00:00+0100" (offset kept), or a bare LFM date in Berlin time.
const parseStart = s => /[+-]\d\d:?\d\d$|Z$/.test(String(s).trim())
  ? new Date(String(s).trim().replace(" ", "T").replace(/([+-]\d\d)(\d\d)$/, "$1:$2")) : lfmDate(s);

function nextRace(id, series, split, drivers, start){
  if (!id || !start || isNaN(start)) return null;
  return {series: series || "", raceId: `Race #${id}`, split: split ? `Split ${split}` : "",
          drivers: drivers ? String(drivers) : "", start, id: Number(id)};
}

// licenseWidgetUserData: {race: [{event_name, race_id, split, race_date, ...}], drivers}
function parseWidget(json){
  const r = json && Array.isArray(json.race) && json.race[0];
  return r ? nextRace(r.race_id, r.event_name, r.split, json.drivers, parseStart(r.race_date)) : null;
}

// The official card HTML. Current markup has ids (#raceEvent, #raceId ...); the
// older one was a "series | race | split" bar.
function parseCard(html){
  const doc = new DOMParser().parseFromString(html, "text/html");
  const txt = sel => ((doc.querySelector(sel) || {}).textContent || "").trim();
  const time = txt("#next-race-time");
  const box = doc.querySelector(".nextrace");
  if (!time || !box || box.hasAttribute("hidden")) return null;
  if (doc.querySelector("#raceId"))
    return nextRace(txt("#raceId"), txt("#raceEvent"), txt("#raceSplit"), txt("#drivers"), parseStart(time));
  const driversEl = box.querySelector(".drivers");
  const drivers = driversEl ? driversEl.textContent.trim() : "";
  if (driversEl) driversEl.remove();
  const parts = box.textContent.split("|").map(s => s.trim()).filter(Boolean);
  return nextRace((parts[1] || "").replace(/\D/g, ""), parts[0], (parts[2] || "").replace(/\D/g, ""), drivers, parseStart(time));
}

// Pull this driver's entry out of the race. Door numbers are handed out by Elo
// within each class (ACC: GT3 101+, GT4 401+), so the seed is their Elo rank
// among same-class drivers in their split.
// Team races (endurance, driver swaps) list cars instead of drivers: {teamname,
// car_number, car_elo, livery, drivers: [...]}. They're flattened to one row per
// car in the solo shape, keyed to this driver when they're in it.
const isMe = d => !!d && String(d.user_id ?? d.id) === ID;
function carRows(entries){
  if (!entries.some(e => Array.isArray(e.drivers))) return entries;
  return entries.map(c => {
    const crew = c.drivers || [], mine = crew.find(isMe), lead = mine || crew[0] || {};
    return {...lead, raceNumber: c.car_number ?? lead.raceNumber, car_model: c.car_model ?? lead.car_model,
      car_class: c.car_class ?? lead.car_class, elo: c.car_elo ?? lead.elo, livery: c.livery ?? lead.livery,
      split: lead.split ?? c.split ?? 1, user_id: lead.user_id, teamname: c.teamname || lead.team_name || "",
      crew, is_live: crew.some(d => d.is_live)};
  });
}
const crewOf = car => (car.crew || []).map(d => ({first: d.vorname || "", last: d.nachname || "", origin: d.origin,
  elo: d.elo, avatar: d.avatar, licence: d.license || "", live: !!d.is_live, me: isMe(d)}));

function parseRace(race, cars){
  const raw = (race.participants && race.participants.entries) || [];
  const teamRace = raw.some(e => Array.isArray(e.drivers));
  const entries = carRows(raw);
  const me = entries.find(isMe);
  const myTeam = S.user && S.user.team ? S.user.team.team_id : null;
  const sim = Number((race.track && race.track.sim_id) || (race.event && race.event.sim_id)) || null;
  const trk = race.track, ev = race.event || {};
  const info = {
    raceId: Number(race.race_id),
    sim,
    eventId: Number(ev.event_id || race.event_id) || null, eventType: ev.event_type || "",
    series: ev.event_name || "",
    week: Number(race.season_week) || null,
    track: trk ? {name: trk.track_name, country: trk.country, km: trk.km, turns: trk.turns || null,
                city: trk.city || "", image: trk.thumbnail || ""} : null,
    sof: race.sof || null,
    teamRace,        // entries are cars with several drivers; `crew` = the drivers in this car
    drivers: entries.length,
    field: [],
    grid: [],        // the whole split (class first), see below
    streamers: 0,    // drivers in the split who are live on Twitch / YouTube
    // LFM's own broadcast fields. Empty for normal races.
    liveVideo: race.live_video || race.videolink || "",
  };
  if (me){
    const rivals = entries.filter(e => e.split === me.split && e.car_class === me.car_class)
                          .sort((a, b) => b.elo - a.elo);
    const split = entries.filter(e => e.split === me.split);
    info.drivers = split.length;
    info.classes = new Set(split.map(e => e.car_class)).size;
    // Own class by Elo, then the other classes.
    // Team race rows show the team name, solo rows the driver. `mate`: same LFM team.
    const who = e => teamRace
      ? {first: e.teamname || (e.crew || []).map(d => d.nachname || d.vorname).filter(Boolean).join(" / "), last: "", origin: null}
      : {first: e.vorname, last: e.nachname, origin: e.origin};
    const mate = e => e !== me && !!myTeam && (e.team_id === myTeam || (e.crew || []).some(d => d.team_id === myTeam));
    info.grid = rivals.concat(split.filter(e => e.car_class !== me.car_class).sort((a, b) => b.elo - a.elo))
      .map(e => ({door: e.raceNumber, ...who(e), elo: e.elo,
                  carClass: e.car_class, licence: e.license || "", me: e === me, mate: mate(e),
                  live: !!e.is_live, team: e.teamname || e.team_name || "", car: cars ? cars.get(`${sim}:${e.car_model}`) : null}));
    info.mates = info.grid.filter(g => g.mate).length;
    if (teamRace){ info.teamName = me.teamname; info.crew = crewOf(me); }
    info.streamers = split.filter(e => e.is_live).length;
    info.car = cars ? cars.get(`${sim}:${me.car_model}`) : null;
    info.carLogo = carLogos.get(`${sim}:${me.car_model}`) || null;
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
      door: e.raceNumber, ...who(e), elo: e.elo, me: e === me}));
  }

  Object.assign(info, parseServer(race));
  if (info.weather){
    info.weather.label = t(info.weather.label);
    if (info.weather.mode) info.weather.mode = t(info.weather.mode);
  }
  // Fallback race length from the event blurb, e.g. "GT3 + GT4 Multiclass / 75 min." or "6h".
  const blurb = `${ev.website_short_text || ""} ${ev.event_name || ""}`;
  const m = /(\d+)\s*min/i.exec(blurb), hrs = /\b(\d{1,2})\s*(?:h|hrs?|hours?|stunden)\b/i.exec(blurb);
  const raceSes = info.sessions.find(x => x.type === "R") || {};
  info.raceMinutes = raceSes.minutes || (raceSes.laps ? null : m ? Number(m[1]) : hrs ? Number(hrs[1]) * 60 : null);
  info.raceLaps = raceSes.laps || null;
  // A race we can't read from the server config, but whose length the blurb names:
  // add it, so the schedule still ends with a race (and not with qualifying).
  if (!raceSes.type && info.raceMinutes && info.sessions.length) info.sessions.push({type: "R", minutes: info.raceMinutes});
  return info;
}

// Session times from the race start (= server start, first session). The timers
// are only part of it: a session runs on until the cars finish their lap
// (capped by the server's overtime), the sim shows results, and the race starts
// after the pre-race wait and a formation lap. Only the first time is exact.
// `at` = green flag, `end` = roughly when the session is over.
const SESSION_GAP_MS = 30e3;        // results screen / loading between sessions
const LAP_KMH = 150;                // rough average lap speed for the lap estimate
function lapEstimate(km){
  return km > 0 ? Math.min(600e3, Math.max(60e3, km / 1000 / LAP_KMH * 3600e3)) : 120e3;
}
function sessionTimes(start, sessions, timing = {}, km = 0){
  const lap = lapEstimate(km);
  const overtime = timing.overtime != null ? timing.overtime * 1e3 : lap;
  const preRace = (timing.preRace != null ? timing.preRace : 120) * 1e3;
  let t = start.getTime();
  return (sessions || []).map((s, i) => {
    if (s.type === "R") t += preRace + (timing.formation != null ? timing.formation * 1e3 : (timing.shortFormation ? 0.6 : 1) * lap);
    const at = t;
    const run = s.minutes ? s.minutes * 60e3 : (s.laps || 0) * lap;
    // Timed sessions: the field finishes the lap it is on. Races: the leader's last lap and the rest behind.
    const over = s.type === "R" ? (s.minutes ? Math.min(overtime, lap) : 0) + Math.min(overtime, lap) / 2 : s.minutes ? Math.min(overtime, lap) : 0;
    const end = at + run + over;
    t = end + (timing.gap != null ? timing.gap * 1e3 : SESSION_GAP_MS);
    return {...s, minutes: s.minutes || Math.round(run / 60e3), at: new Date(at), end: new Date(end), approx: i > 0 || s.type === "R"};
  });
}
const SESSION_NAMES = {P: t("Practice"), Q: t("Qualifying"), R: t("Race")};

// Each sim's server config has its own shape. Returns
//   weather:  {icon, label, temp?, rain? (0..1), mode} or null
//   sessions: [{type: "P"|"Q"|"R", minutes} | {type, laps}], sessions of length 0 left out
//   timing:   {preRace?, overtime? (seconds), shortFormation?} where the config says
// Unknown shapes (LMU, future sims) just come back empty.
function parseServer(race){
  const s = race.server_settings || {};
  const out = {weather: null, sessions: [], timing: {}};
  const add = (type, minutes) => { if (minutes > 0) out.sessions.push({type, minutes: Math.round(minutes)}); };
  const addLaps = (type, laps) => { if (laps > 0) out.sessions.push({type, laps: Math.round(laps)}); };

  // ACC and AC: ACC-style event.json, cloudLevel / rain are 0..1.
  const ev = s.server_settings && s.server_settings.event && s.server_settings.event.data;
  if (ev){
    const [icon, label] = describeLevels(ev.cloudLevel, ev.rain);
    out.weather = {icon, label, temp: ev.ambientTemp, rain: ev.rain || 0,
      mode: race.real_weather ? "Real weather" : ev.weatherRandomness > 0 ? "Dynamic" : "Static"};
    for (const x of ev.sessions || []) add(x.sessionType, x.sessionDurationMinutes);
    const st = (s.server_settings.settings && s.server_settings.settings.data) || {};
    out.timing = {preRace: ev.preRaceWaitingTimeSeconds, overtime: ev.sessionOverTimeSeconds, shortFormation: !!st.shortFormationLap};
    return out;
  }

  // AC EVO: seasondef, durations in seconds, weather as an enum name.
  const sd = s.seasondef;
  if (sd){
    const g = sd.game_config || {};
    add("P", g.practice_duration / 60);
    add("Q", g.qualify_duration / 60);
    if (!/LAP/i.test(g.race_duration_type || "")) add("R", g.race_duration / 60);
    else addLaps("R", g.race_duration);
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
    else addLaps("R", d.RaceLength);
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
    if (ses.Race1 && ses.Race1.Laps) addLaps("R", ses.Race1.Laps);
    else add("R", mins(ses.Race1));
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
// (finishing_pos 0 = DNF / no result): 2 hours after the start, or for the
// race on screen, once its live window is over (endurance races run for hours).
function isFinal(r){
  const d = lfmDate(r.race_date);
  if (!d || d > Date.now()) return false;
  const running = S.next && S.next.id === r.race_id ? raceWindow(S.next) : 2 * 3600e3;
  return r.finishing_pos > 0 || r.rating_change || Date.now() - d > running;
}
const finals = () => S.history.filter(r => isFinal(r) && (!SIM_PIN || r.sim_id === SIM_PIN));

function makeResult(r){
  const split = r.user_split || 1;
  return {
    raceId: r.race_id, date: lfmDate(r.race_date), sim: r.sim_id, series: r.event_name,
    track: r.track_name, car: r.car_name || r.car, carClass: r.class,
    start: r.start_pos || null, finish: r.finishing_pos || 0, dnf: !r.finishing_pos,
    elo: r.rating_change ?? null, sr: r.sr_change ?? null, incidents: r.incidents ?? null,
    points: Math.round(r.points || 0) || null, split, carLogo: realLogo(r.thumbnail),
    eventId: r.event_id || null, eventType: r.event_type || "", teamRace: !!r.team_event,
    sof: (split > 1 && r[`split${split}_sof`]) || r.sof || null,
  };
}

// Finished race details that only the race API has: livery, best lap.
async function loadResultRace(id){
  if (raceCache.has(id)) return raceCache.get(id);
  const race = await getJSON(URLS.race(id));
  const me = carRows((race.participants && race.participants.entries) || []).find(isMe);
  // Results are nested per class / split; find this driver's row anywhere in them.
  // Team races have one row per car, credited to one of its drivers.
  let row = null;
  const walk = (o, depth) => {
    if (row || !o || typeof o !== "object" || depth > 6) return;
    if (!Array.isArray(o) && "bestlap" in o && rowIsMine(o)){ row = o; return; }
    for (const v of Object.values(o)) walk(v, depth + 1);
  };
  walk(race.race_results, 0);
  if (!row) walk(race.race_results_splits, 0);
  const info = {livery: (me && me.livery) || null,
                bestLap: row && row.bestlap ? row.bestlap.replace(/^00:|^0(?=\d:)/, "") : null,
                classPos: row ? row.class_position : null,
                teamName: (row && row.teamname) || (me && me.teamname) || null,
                results: parseResults(race, row, me)};
  raceCache.set(id, info);
  return info;
}

const rowIsMine = x => isMe(x) || (Array.isArray(x.drivers) && x.drivers.some(isMe));
// Finishing order of this driver's class in their split:
// race_results_splits[split - 1][class].OVERALL, else race_results[class].OVERALL.
function parseResults(race, row, me){
  const split = (row && row.split) || (me && me.split) || 1;
  const cls = (row && row.class) || (me && me.car_class);
  const pick = o => {
    const c = o && cls && o[cls];
    return c && (Array.isArray(c) ? c : c.OVERALL || Object.values(c).find(Array.isArray)) || null;
  };
  const splits = race.race_results_splits;
  const list = pick(Array.isArray(splits) ? splits[split - 1] : splits && splits[split])
            || (pick(race.race_results) || []).filter(x => (x.split || 1) === split);
  const pos = x => x.class_position || x.position || 999;
  const sorted = list.slice().sort((a, b) => pos(a) - pos(b));
  const laps = sorted.length ? sorted[0].laps : 0;
  const team = sorted.some(x => Array.isArray(x.drivers) && x.teamname);
  return sorted.map(x => ({
    pos: pos(x), door: x.car_number, first: (team ? x.teamname : x.vorname) || "", last: team ? "" : x.nachname || "",
    origin: team ? null : x.origin, teamCar: team,
    out: x.dsq ? "DSQ" : x.dns ? "DNS" : x.dnf ? "DNF" : "",
    // Winner: race time without milliseconds; others: gap in tenths ("+2.2") or laps down.
    gap: x === sorted[0] ? String(x.time || "").replace(/\.\d+$/, "").replace(/^0(?=\d:)/, "")
       : laps && x.laps < laps ? `+${laps - x.laps}L`
       : "+" + String(x.gap || "").replace(/^00:/, "").replace(/^0(?=\d)/, "").replace(/(\.\d)\d+$/, "$1"),
    elo: x.ratingGain ?? null, gain: x.positionGain ?? null, me: rowIsMine(x),
  }));
}

// Rating after each race in this sim, newest first, rebuilt from the current
// rating and each race's rating change.
function ratingTrail(sim, current){
  const out = [current];
  for (const r of S.history.filter(x => x.sim_id === sim && isFinal(x))) out.push(out[out.length - 1] - (r.rating_change || 0));
  return out;
}

// This driver's finished races at a track (same sim), from the loaded history.
function trackRecord(trackName, sim){
  const rows = S.history.filter(r => r.track_name === trackName && r.sim_id === sim && isFinal(r));
  if (!rows.length) return null;
  const fin = rows.map(r => r.finishing_pos).filter(p => p > 0);
  return {
    starts: rows.length, complete: S.fullHistory,
    wins: fin.filter(p => p === 1).length, podiums: fin.filter(p => p <= 3).length,
    best: fin.length ? Math.min(...fin) : 0,
    last: {finish: rows[0].finishing_pos || 0, date: lfmDate(rows[0].race_date), elo: rows[0].rating_change ?? null},
  };
}

/* ------------------------------------------------------------------ broadcast
   Is LFM streaming the next race? YouTube: LFM schedules its broadcasts ahead of
   time ("[ENG] Caseking.de Prime Series R05 Suzuka", "Scheduled for 11/10/26"),
   so they show up before the race. Twitch only says who is live right now
   (LFM's checkBroadcaster), so the official Twitch channels appear once they're on air. */
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const GENERIC = new Set(("series season cup lfm the and del des der die das von for race grand prix circuit circuito autodromo " +
  "international raceway park ring motorsport motorsports speedway track week sprint endurance").split(" "));
const keyWords = s => norm(s).split(" ").filter(w => w.length > 2 && !GENERIC.has(w) && !/^\d+$/.test(w));
const dayKey = d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

// The streams tab's ytInitialData: one item per stream with its badge
// ("Upcoming" / "LIVE") and, when scheduled, "Scheduled for M/D/YY, h:mm AM".
function parseYouTube(html){
  const m = /var ytInitialData = (\{.*?\});<\/script>/s.exec(html);
  if (!m) return [];
  const items = [];
  const walk = o => {
    if (!o || typeof o !== "object") return;
    if (o.lockupViewModel){ items.push([o.lockupViewModel.contentId, o.lockupViewModel]); return; }
    if (o.videoRenderer){ items.push([o.videoRenderer.videoId, o.videoRenderer]); return; }
    for (const v of Object.values(o)) walk(v);
  };
  walk(JSON.parse(m[1]));
  return items.map(([id, it]) => {
    const texts = [];
    const grab = x => {
      if (!x || typeof x !== "object") return;
      for (const k of ["content", "text", "simpleText"]) if (typeof x[k] === "string") texts.push(x[k]);
      for (const v of Object.values(x)) grab(v);
    };
    grab(it);
    const title = texts.find(t => /^\[\w+\]/.test(t)) || texts.find(t => t.length > 12 && !/^(Scheduled|Streamed|Upcoming|LIVE|Now playing)/i.test(t)) || "";
    const when = texts.map(t => /Scheduled for (\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(t)).find(Boolean);
    const live = texts.some(t => /^live( now)?$/i.test(t.trim()));
    const upcoming = !live && (!!when || texts.some(t => /^upcoming$/i.test(t.trim())));
    const y = when ? Number(when[3]) : 0;
    return {id, title, url: `https://youtu.be/${id}`, lang: (/^\[(\w+)\]/.exec(title) || [])[1] || "",
            state: live ? "live" : upcoming ? "upcoming" : "past",
            date: when ? new Date(y < 100 ? 2000 + y : y, when[1] - 1, when[2]) : null};
  }).filter(v => v.id && v.title && v.state !== "past");
}

// Same series, same track, and the same day (or round number, for live streams).
function streamMatches(title, race, start, dated){
  const words = new Set(norm(title).split(" "));
  const series = keyWords(race.series);
  if (!series.length || !series.every(w => words.has(w))) return false;
  const place = keyWords(race.track && race.track.name).concat(keyWords(race.track && race.track.city));
  if (place.length && !place.some(w => words.has(w))) return false;
  const round = /\bR(\d{1,2})\b/i.exec(title);
  if (dated) return Math.abs(new Date(dayKey(dated)) - new Date(dayKey(start))) <= 864e5;
  return round && race.week ? Number(round[1]) === race.week : true;
}

let ytCache = {at: 0, items: []};
async function loadBroadcast(race, start){
  if (Date.now() - ytCache.at > BROADCAST_MS){
    try { ytCache = {at: Date.now(), items: parseYouTube(await getText(URLS.youtube))}; }
    catch (e){ ytCache.at = Date.now(); console.warn("LFM YouTube schedule fetch failed", e); }
  }
  const youtube = ytCache.items.filter(v => streamMatches(v.title, race, start, v.state === "upcoming" && v.date))
    .map(v => ({...v, lang: v.lang === "DEU" ? "DE" : v.lang === "ENG" ? "EN" : v.lang}));

  // Twitch, around race time only: official channel live with a matching title,
  // or simply live while LFM has this race on YouTube (they simulcast).
  let twitch = [];
  const near = Date.now() > start.getTime() - 3600e3 && Date.now() < start.getTime() + raceWindow(S.next);
  if (near){
    try {
      const rows = (await getJSON(URLS.live)).data || [];
      const series = keyWords(race.series);
      twitch = rows.filter(r => LFM_TWITCH[String(r.user_login).toLowerCase()])
        .filter(r => youtube.length || series.some(w => norm(r.title).split(" ").includes(w)))
        .map(r => ({channel: r.user_login.toLowerCase(), lang: LFM_TWITCH[r.user_login.toLowerCase()],
                    title: r.title, viewers: r.viewer_count || 0, url: `https://twitch.tv/${r.user_login.toLowerCase()}`}));
    } catch (e){ console.warn("LFM Twitch live check failed", e); }
  }
  if (race.liveVideo && !youtube.length && !twitch.length)
    youtube.push({id: "", title: race.series, url: race.liveVideo, lang: "", state: "upcoming", date: null});
  if (!youtube.length && !twitch.length) return null;
  return {youtube, twitch, live: twitch.length > 0 || youtube.some(v => v.state === "live"),
          langs: [...new Set(youtube.concat(twitch).map(x => x.lang).filter(Boolean))]};
}

/* ------------------------------------------------------------------ standings
   Championship position in the series of the race on screen (the next race, else
   the last result). Season events only; team events rank the car's team. */
let standingsKey = "", standingsAt = 0;
async function loadStandings(){
  if (hidden("standings")) return;
  const r = currentRace(), res = S.mode === "result" ? S.result : null;
  const src = r ? {event: r.eventId, type: r.eventType, team: r.teamRace ? r.teamName : null}
            : res ? {event: res.eventId, type: res.eventType, team: res.teamRace ? res.teamName : null} : null;
  if (!src || !src.event || (src.type && src.type !== "Season") || (res && !r && res.teamRace && !src.team)){
    standingsKey = ""; S.standings = null; return;
  }
  const key = `${src.event}:${src.team || ""}`;
  if (key === standingsKey && Date.now() - standingsAt < STANDINGS_MS) return;
  standingsKey = key; standingsAt = Date.now();
  try {
    const data = await getJSON(src.team ? URLS.teamStandings(src.event) : URLS.standings(src.event));
    if (key !== standingsKey) return;  // the series on screen changed meanwhile
    const out = src.team ? teamStanding(data, src.team) : driverStanding(data);
    const changed = JSON.stringify(out) !== JSON.stringify(S.standings);
    S.standings = out;
    if (changed && S.view) render(S);
  } catch (e){ standingsAt = 0; console.warn("LFM standings fetch failed", e); }
}
function driverStanding(data){
  for (const [cls, groups] of Object.entries(data || {})){
    if (!groups || typeof groups !== "object") continue;
    const overall = Array.isArray(groups) ? groups : groups.OVERALL;
    const me = Array.isArray(overall) && overall.find(isMe);
    if (!me) continue;
    // Divisions only matter when there's more than one.
    const divs = Array.isArray(groups) ? [] : Object.keys(groups).filter(k => k !== "OVERALL");
    const div = divs.length > 1 && Array.isArray(groups[me.division]) ? groups[me.division] : null;
    const dme = div && div.find(isMe);
    return {pos: me.position, of: overall.length, points: Math.round(Number(me.points) || 0),
            cls: cls === "OVERALL" ? "" : cls, team: false,
            division: dme ? me.division : null, divPos: dme ? dme.position : null};
  }
  return null;
}
function teamStanding(data, name){
  for (const [cls, list] of Object.entries(data || {})){
    if (!Array.isArray(list)) continue;
    const row = list.find(x => norm(x.teamname) === norm(name));
    if (row) return {pos: row.position, of: list.length, points: Math.round(Number(row.teampoints) || 0), cls, team: true};
  }
  return null;
}

/* ------------------------------------------------------------------ trends
   Rating (in the sim on screen) and safety rating after each of the last races,
   oldest first, rebuilt from the current values and each race's change. */
function trends(){
  const v = S.view;
  if (!v || hidden("trend")) return {elo: [], sr: []};
  const elo = v.rating != null ? ratingTrail(S.sim, v.rating).slice(0, TREND_SIZE + 1).reverse() : [];
  const sr = [], now = parseFloat(v.srNum);
  if (!isNaN(now)){
    sr.push(now);
    for (const r of S.history){
      if (sr.length > TREND_SIZE) break;
      if (isFinal(r)) sr.push(Math.round((sr[sr.length - 1] - (Number(r.sr_change) || 0)) * 100) / 100);
    }
    sr.reverse();
  }
  return {elo, sr};
}
function sparkSVG(vals, w, h){
  const min = Math.min(...vals), max = Math.max(...vals), pad = 5;
  const y = v => max === min ? h / 2 : h - pad - (v - min) / (max - min) * (h - 2 * pad);
  const pts = vals.map((v, i) => [pad + i * (w - 2 * pad) / (vals.length - 1), y(v)]);
  const line = pts.map(p => p.map(n => n.toFixed(1)).join(",")).join(" "), [lx, ly] = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">` +
    `<polygon points="${pad},${h} ${line} ${(w - pad).toFixed(1)},${h}" style="fill:rgba(var(--volt-rgb),.13)"/>` +
    `<polyline points="${line}" fill="none" style="stroke:var(--volt)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4" style="fill:var(--volt)"/></svg>`;
}
// Fills box with a sparkline per trend ("Rating", "Safety"): label, line, current
// value and the change over the period. Returns how many races it covers (0 = nothing shown).
function renderTrends(box, {w = 200, h = 40} = {}){
  const tr = trends();
  box.replaceChildren();
  const add = (k, vals, digits) => {
    if (vals.length < 3) return;
    const d = document.createElement("div"); d.className = "trend";
    const change = Math.round((vals[vals.length - 1] - vals[0]) * 10 ** digits) / 10 ** digits;
    d.innerHTML = `<span class="tk"></span>${sparkSVG(vals, w, h)}<span class="tv"><b></b><em></em></span>`;
    d.querySelector(".tk").textContent = t(k);
    d.querySelector("b").textContent = vals[vals.length - 1].toFixed(digits);
    const em = d.querySelector("em");
    em.className = "delta " + deltaClass(change); em.textContent = signed(change, digits);
    box.append(d);
  };
  add("Rating", tr.elo, 0);
  add("Safety", tr.sr, 2);
  return box.children.length ? Math.max(tr.elo.length, tr.sr.length) - 1 : 0;
}
// Championship position for display. With divisions the division position leads,
// as on LFM: "P50" / "Div 2 · P467 overall · 227 pts"; else "P3" / "of 106 · 6408 pts".
const standingText = st => st && (st.division && st.divPos
  ? {pos: `P${st.divPos}`, rest: [t("Div {n}", {n: st.division}), `P${st.pos} ${t("overall")}`, st.points && t("{n} pts", {n: st.points})].filter(Boolean).join(" · ")}
  : {pos: `P${st.pos}`, rest: [t("of {n}", {n: st.of}), st.points && t("{n} pts", {n: st.points})].filter(Boolean).join(" · ")});

/* ------------------------------------------------------------------ derive */
// How long a started race can still be running: its sessions plus an hour of
// overtime and result processing, and at least RACE_WINDOW_MS.
const raceWindow = n => Math.max(RACE_WINDOW_MS, n && n.length ? n.length + 3600e3 : 0);
const nextActive = () => {
  const n = S.next;
  if (!n || Date.now() > n.start.getTime() + raceWindow(n)) return false;
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
let OPTS = {};
let loadedOnce = false;

async function load(){
  const first = !loadedOnce;
  // Career stats take LFM 3-4 s to answer, so they don't hold up the first
  // render: they fill in (and re-render) whenever they arrive.
  getJSON(URLS.stats).then(v => {
    S.stats = v;
    if (loadedOnce && S.view) render(S);
  }).catch(e => console.warn("LFM stats fetch failed", e));
  const [user, widget, past] = await Promise.allSettled([
    getJSON(URLS.user), getJSON(URLS.widget), getJSON(URLS.past(first ? 40 : 10))]);
  // On failure keep showing the last good data rather than blanking the overlay.
  if (user.status === "fulfilled"){ S.user = user.value; S.okAt = Date.now(); }
  else console.warn("LFM profile fetch failed", user.reason);
  if (past.status === "fulfilled" && Array.isArray(past.value)) mergeHistory(past.value);
  // Next race: widget JSON, else the official card HTML through the proxy.
  let next, gotNext = widget.status === "fulfilled";
  if (gotNext) next = parseWidget(widget.value);
  else {
    console.warn("LFM widget fetch failed", widget.reason);
    try { next = parseCard(await getText(URLS.card)); gotNext = true; }
    catch (e){ console.warn("LFM card fetch failed", e); }
  }
  // LFM drops a race from the widget the moment it starts. Keep it while it may
  // still be running, also across reloads (OBS refreshing the source on a scene
  // switch), so the race / race day frame doesn't fall back to the last result.
  const NEXT_KEY = `lfm-next:${ID}`;
  if (gotNext && next && !DEMO) store.set(NEXT_KEY, {...next, start: next.start.getTime()});
  if (gotNext && !next && !(S.next && S.next.start <= Date.now()) && !DEMO){
    const kept = store.get(NEXT_KEY), now = Date.now();
    if (kept && kept.start <= now && now < kept.start + raceWindow(kept)) next = {...kept, start: new Date(kept.start)};
  }
  // The race length (known once the race details loaded) carries over to the fresh object.
  if (next && S.next && next.id === S.next.id && !next.length) next.length = S.next.length;
  if (gotNext && (next || !(S.next && S.next.start <= Date.now()))) S.next = next;

  // The next race's details and the last result's details load side by side.
  const done = finals();
  const last = done[0] && makeResult(done[0]);
  const wantResult = last && (Date.now() - last.date < RESULT_MS || SHOW === "result");
  const resultInfo = wantResult ? loadResultRace(last.raceId).catch(e => { console.warn("LFM result race fetch failed", e); return null; }) : null;
  if (nextActive()){
    const [race, cars] = await Promise.allSettled([getJSON(URLS.race(S.next.id)), loadCarNames()]);
    if (race.status === "fulfilled") S.race = parseRace(race.value, cars.status === "fulfilled" ? cars.value : null);
    else console.warn("LFM race fetch failed", race.reason);
  } else S.race = null;
  // A pinned sim only shows races in that sim.
  if (SIM_PIN && S.race && S.race.sim && S.race.sim !== SIM_PIN) S.next = S.race = null;
  if (S.race){
    S.race.sessionTimes = sessionTimes(S.next.start, S.race.sessions,
      // The demo squeezes sessions into minutes: no gaps, so its timeline stays as it was.
      DEMO ? {preRace: 0, overtime: 0, formation: 0, gap: 0} : S.race.timing, S.race.track && S.race.track.km);
    // Race length for the live window: the sessions, else the race length from the blurb.
    const last = S.race.sessionTimes[S.race.sessionTimes.length - 1];
    const length = last ? last.end - S.next.start : (S.race.raceMinutes || 0) * 60e3;
    if (length && S.next.length !== length){
      S.next.length = length;
      if (!DEMO) store.set(NEXT_KEY, {...S.next, start: S.next.start.getTime()});
    }
    if (S.race.track) S.race.record = trackRecord(S.race.track.name, S.race.sim);
  }
  // Broadcast check (YouTube page + Twitch): after the first render, see below.
  const checkBroadcast = OPTS.broadcast && BROADCAST && S.race && SHOW !== "result";
  if (!checkBroadcast) S.broadcast = null;

  S.result = wantResult ? last : null;
  if (S.result){
    const info = await resultInfo;
    if (info) Object.assign(S.result, info);
  }

  S.mode = nextActive() && SHOW !== "result" ? (S.next.start <= Date.now() ? "live" : "next")
         : S.result ? "result" : "idle";
  S.sim = pickSim();
  S.form = done.filter(r => r.sim_id === S.sim).slice(0, FORM_SIZE).reverse()
               .map(r => ({pos: r.finishing_pos || 0, raceId: r.race_id}));
  if (S.user){
    S.view = makeView(S.user, S.sim);
    setAccent(HEXCODE || (ID === OWNER_ID ? null : LICENCE_ACCENTS[S.view.licenceKey]), !!HEXCODE);
    checkPromotion();
  }

  // Livery: from the next race's entry, else from the last result's.
  const r = currentRace();
  const liv = S.mode === "result" ? S.result && S.result.livery : r && r.livery;
  const car = S.mode === "result" ? S.result && S.result.car : r && r.car;
  // No custom livery: the car maker's logo instead.
  const logo = S.mode === "result" ? S.result && S.result.carLogo : r && r.carLogo;
  S.livery = liv ? {url: URLS.livery(liv), car: car || ""}
           : logo ? {url: URLS.logo(logo), car: car || "", logo: true} : null;

  await document.fonts.ready;  // text fitting needs the real font; it loaded alongside the data
  loadedOnce = true;
  if (S.view){ render(S); $("stage").classList.add("ready"); }
  problem(!S.view);
  queueCelebrations();
  if (first) loadFullHistory();
  loadStandings();
  sceneTick();
  if (checkBroadcast){
    const race = S.race;
    loadBroadcast(race, S.next.start).then(b => {
      if (S.race !== race) return;  // a newer load took over
      const changed = JSON.stringify(b) !== JSON.stringify(S.broadcast);
      S.broadcast = b;
      if (changed && S.view) render(S);
    }).catch(e => console.warn("LFM broadcast check failed", e));
  }
}

// The whole race history (~1 MB for 900 races) is only needed to spot a new
// personal-best rating, so it loads once in the background.
async function loadFullHistory(){
  try {
    const rows = await getJSON(URLS.past(3000));
    if (Array.isArray(rows)){
      mergeHistory(rows); S.fullHistory = true;
      if (S.race && S.race.track) S.race.record = trackRecord(S.race.track.name, S.race.sim);
      if (S.view) render(S);
      queueCelebrations();
    }
  } catch (e){ console.warn("LFM history fetch failed", e); }
}

/* ------------------------------------------------------------------ celebrations */
// Celebrations already shown. Kept over the reload after a code update (see below).
const played = new Set((() => {
  try { const v = JSON.parse(sessionStorage.getItem("lfm-played") || "[]"); sessionStorage.removeItem("lfm-played"); return v; }
  catch { return []; }
})());
const queue = [];
let playing = false;

function celebrations(){
  const out = [], r = S.result, v = S.view;
  if (CELEBRATE === "off" || !v) return out;
  if (r && Date.now() - r.date < CELEBRATE_MS){
    const key = k => `${r.raceId}:${k}`;
    if (r.finish === 1)
      out.push({kind: "win", key: key("win"), big: t("Victory"), sub: [S.stats && S.stats.wins ? t("Win #{n}", {n: S.stats.wins}) : "", r.track]});
    else if (r.finish > 1 && r.finish <= 3)
      out.push({kind: "podium", key: key("podium"), big: t("Podium"), sub: [`P${r.finish}`, r.track]});
    if (S.fullHistory && r.elo > 0 && v.rating != null && r.sim === S.sim){
      const trail = ratingTrail(S.sim, v.rating);
      if (trail.length > 2 && v.rating > Math.max(...trail.slice(1)))
        out.push({kind: "pb", key: key("pb"), big: t("New personal best"), sub: [t("{n} rating", {n: v.rating}), signed(r.elo)]});
    }
    const starts = S.stats && S.stats.starts;
    if (starts && starts % 100 === 0) out.push({kind: "starts", key: key("starts"), big: t("{n} starts", {n: starts}), sub: [t("on Low Fuel Motorsport")]});
  }
  if (S.promo) out.push({kind: "promo", key: `promo:${S.promo.licence}`, big: t("Promoted"), sub: [t("Licence")], plate: S.promo.licence});

  // ?celebrate=win,podium,pb,promo,starts shows examples with this driver's data.
  for (const k of CELEBRATE.split(",").filter(Boolean)){
    const demo = {
      win: {big: t("Victory"), sub: [t("Win #{n}", {n: 1}), "Spa-Francorchamps"]},
      podium: {big: t("Podium"), sub: ["P2", "Spa-Francorchamps"]},
      pb: {big: t("New personal best"), sub: [t("{n} rating", {n: v.rating ?? 2000}), "+42"]},
      promo: {big: t("Promoted"), sub: [t("Licence")], plate: v.licence || "GOLD"},
      starts: {big: t("{n} starts", {n: 500}), sub: [t("on Low Fuel Motorsport")]},
    }[k];
    if (demo) out.push({...demo, kind: k, key: `demo:${k}`});
  }
  return out;
}

function queueCelebrations(){
  if (OPTS.celebrations === false) return;
  for (const c of celebrations()) if (!played.has(c.key)){ played.add(c.key); queue.push(c); }
  if (!playing) playNext();
}

function playNext(){
  const c = queue.shift();
  if (!c){ playing = false; return; }
  playing = true;
  // opts.hold(): the layout isn't showing its full scene right now (race day frame); wait.
  if (OPTS.hold && OPTS.hold()){ queue.unshift(c); setTimeout(playNext, 2000); return; }
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
  sting(c.kind);
  // Big headlines shrink to fit the stage.
  const big = el.querySelector(".big");
  const max = host.clientWidth * 0.86;
  let size = parseFloat(getComputedStyle(big).fontSize);
  while (big.scrollWidth > max && size > 24){ size -= 4; big.style.fontSize = size + "px"; }
  setTimeout(() => { el.remove(); setTimeout(playNext, 600); }, dur);
}

// A short synthesised sting with each banner: a whoosh with the band, then a
// chord that rises for the bigger moments. Off with ?sound=off.
let audio = null;
const STINGS = {win: [523.25, 659.25, 783.99, 1046.5], podium: [659.25, 783.99, 987.77], pb: [783.99, 1174.66],
                promo: [587.33, 739.99, 880, 1174.66], starts: [1046.5, 1318.51]};
function sting(kind){
  if (!SOUND) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    const t0 = audio.currentTime + 0.05, out = audio.createGain();
    out.gain.value = 0.25 * SOUND; out.connect(audio.destination);
    const len = 0.9, buf = audio.createBuffer(1, Math.round(audio.sampleRate * len), audio.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / data.length) ** 2;
    const noise = audio.createBufferSource(), band = audio.createBiquadFilter(), ng = audio.createGain();
    noise.buffer = buf; band.type = "bandpass"; band.Q.value = 1.4; ng.gain.value = 0.45;
    band.frequency.setValueAtTime(350, t0); band.frequency.exponentialRampToValueAtTime(3200, t0 + len);
    noise.connect(band).connect(ng).connect(out); noise.start(t0);
    const notes = STINGS[kind] || STINGS.podium;
    notes.forEach((f, i) => {
      const at = t0 + 0.32 + i * 0.1, tail = i === notes.length - 1 ? 1.5 : 0.45;
      for (const [type, mult, vol] of [["triangle", 1, 0.5], ["sine", 2, 0.1]]){
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = type; o.frequency.value = f * mult;
        g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol, at + 0.015);
        g.gain.exponentialRampToValueAtTime(0.001, at + tail);
        o.connect(g).connect(out); o.start(at); o.stop(at + tail + 0.05);
      }
    });
  } catch (e){ console.warn("LFM sound failed", e); }
}

/* ------------------------------------------------------------------ OBS scenes
   Starting soon and lower third can switch OBS scenes, only between two scenes:
   from SCENE_RESULT to SCENE_RACE a minute before the server opens, and back once
   LFM publishes the result. If OBS is on any other scene at that moment (race day,
   just chatting...) nothing happens. Each switch is decided once per race, shared
   by all sources. Needs the browser source's page permissions at "Advanced access
   to OBS" and both scenes to exist; otherwise it does nothing. */
const obs = window.obsstudio;
const obsCall = fn => new Promise(done => { try { obs[fn](done); } catch { done(null); } });
const SCENE_KEY = `lfm-scenes:${ID}`;
const sceneMemory = {};  // demo mode: forget on reload, so every demo run switches
const sceneDone = k => DEMO ? !!sceneMemory[k] : (store.get(SCENE_KEY) || []).includes(k);
function sceneMark(k){
  if (DEMO){ sceneMemory[k] = true; return; }
  store.set(SCENE_KEY, (store.get(SCENE_KEY) || []).concat(k).slice(-20));
}
function sceneEvent(){
  const n = S.next;
  if (S.mode !== "result" && nextActive() && n.start - Date.now() < SCENE_LEAD_MS)
    return {key: `race:${n.id}`, scene: SCENE_RACE, from: SCENE_RESULT};
  if (S.mode === "result" && S.result && Date.now() - S.result.date < 2 * 864e5)
    return {key: `result:${S.result.raceId}`, scene: SCENE_RESULT, from: SCENE_RACE, after: `race:${S.result.raceId}`};
  return null;
}
let sceneBusy = false;
async function sceneTick(){
  if (sceneBusy || !OPTS.scenes || !SCENES_ON || !obs || !obs.setCurrentScene || !S.view) return;
  const ev = sceneEvent();
  if (!ev || sceneDone(ev.key) || (ev.after && !sceneDone(ev.after))) return;
  sceneBusy = true;
  try {
    if (!(await obsCall("getControlLevel") >= 4)) return;  // 4 = advanced access
    const [scenes, cur] = await Promise.all([obsCall("getScenes"), obsCall("getCurrentScene")]);
    if (!Array.isArray(scenes) || !scenes.includes(ev.scene) || !scenes.includes(ev.from)) return;
    // Only from the expected scene: if the streamer is elsewhere, leave them be (and don't
    // switch later, e.g. when they visit the starting soon scene during a long race).
    if (cur && cur.name === ev.from) obs.setCurrentScene(ev.scene);
    sceneMark(ev.key);
  } finally { sceneBusy = false; }
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
      el.classList.toggle("brand", !!(livery && livery.logo));
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

// Team races: the other drivers sharing this car ("Drivers"), as chips (avatar or flag, name).
const crewMates = r => r && r.teamRace ? (r.crew || []).filter(d => !d.me) : [];
function renderCrew(box, crew, {avatars = true} = {}){
  box.replaceChildren();
  for (const d of crew){
    const chip = document.createElement("span"); chip.className = "cm";
    if (avatars && d.avatar){
      const img = document.createElement("img"); img.className = "cav"; img.alt = ""; img.src = d.avatar;
      img.onerror = () => img.remove(); chip.append(img);
    } else if (d.origin){
      const img = document.createElement("img"); img.className = "cfl"; img.alt = ""; img.src = flagUrl(d.origin); chip.append(img);
    }
    const name = document.createElement("span"); name.className = "cnm";
    name.textContent = [d.first, d.last].filter(Boolean).join(" ");
    chip.append(name);
    if (d.live){ const dot = document.createElement("i"); dot.className = "clv"; chip.append(dot); }
    box.append(chip);
  }
}
// "75 drivers", or "75 cars" in a team race.
const entrants = (n, race) => t(race && race.teamRace ? "{n} cars" : n == 1 ? "{n} driver" : "{n} drivers", {n});

// Scroll a field ticker back and forth when it doesn't fit its box.
function scrollTrack(track, pxS = 60){
  const dist = Math.max(0, track.scrollWidth - track.parentElement.clientWidth);
  track.getAnimations().forEach(a => a.cancel());
  if (!dist || !MOTION) return;
  track.animate([{transform:"translateX(0)"}, {transform:`translateX(${-dist}px)`}],
    {duration: dist / pxS * 1000, easing: "ease-in-out", iterations: Infinity, direction: "alternate", delay: 1500});
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
    const l = document.createElement("span"); l.className = "latest"; l.textContent = "◂ " + t("latest"); box.append(l);
  }
}

// Rotating pages: each `.page` in `pages` shows for pageMs (longer if it holds
// a scrolling field ticker), then slides up to the next. Pages with
// data-empty="1" are skipped. ?page=<title> pins one page.
// isStatic(): when true all pages are on screen at once (laid out by the page's
// CSS), so nothing scrolls; the rotation keeps running underneath.
function rotator({pages, title, bar, pageMs = 8000, scrollPxS = 90, hold = 1500, isStatic = () => false}){
  const PIN = (PARAMS.get("page") || "").toLowerCase();
  let timer = 0;
  const setTitle = page => {
    if (!title) return;
    title.textContent = page.dataset.label || page.dataset.title;
    if (page.dataset.value){
      const em = document.createElement("em"); em.textContent = page.dataset.value; title.append(em);
    }
    // Long (translated) titles shrink to fit the title column.
    title.style.fontSize = title.style.letterSpacing = "";
    const box = title.parentElement.clientWidth;
    let size = parseFloat(getComputedStyle(title).fontSize);
    if (title.scrollWidth > box) title.style.letterSpacing = ".1em";
    while (title.scrollWidth > box && size > 10){ size -= 1; title.style.fontSize = size + "px"; }
  };
  const scroll = track => {
    const dist = Math.max(0, track.scrollWidth - track.parentElement.clientWidth);
    track.getAnimations().forEach(a => a.cancel());
    if (!dist || !MOTION || isStatic()) return pageMs;
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

/* ------------------------------------------------------------------ no data
   Nothing to show yet (a wrong ID, or LFM down when the source opened): say so
   instead of staying blank, and try again every 30 s until it works. */
let notice = null, retry = 0;
function problem(on){
  clearTimeout(retry);
  if (!on){ if (notice){ notice.remove(); notice = null; } return; }
  if (!notice){ notice = document.createElement("div"); notice.className = "notice"; document.body.append(notice); }
  notice.textContent = t("Can't load LFM driver {id}. Check the ID in the URL. Trying again…", {id: ID});
  retry = setTimeout(load, 30e3);
}

/* ------------------------------------------------------------------ data age
   If LFM can't be reached for a while the overlay keeps the last data; a small
   tag says how old it is so the streamer notices. */
const STALE_MS = 10 * 60e3;
function watchAge(){
  const tag = document.createElement("div");
  tag.className = "stale"; tag.hidden = true;
  $("stage").append(tag);
  setInterval(() => {
    const age = S.okAt ? Date.now() - S.okAt : 0;
    tag.hidden = age < STALE_MS;
    if (!tag.hidden) tag.textContent = t("LFM data {n} min old", {n: Math.round(age / 60e3)});
  }, 30e3);
}

/* ------------------------------------------------------------------ updates
   OBS keeps browser sources open for days. Every few minutes the overlay checks
   whether its files changed on the server (ETag / Last-Modified) and, when they
   did, reloads itself at a quiet moment: no race within 15 minutes, no frame,
   no celebration playing. */
const UPDATE_CHECK_MS = 5 * 60e3;
const WATCHED = [location.pathname + location.search, "/lfm-card/lfm.js", "/lfm-card/lfm.css"].concat(DEMO ? ["/lfm-card/demo.js"] : []);
async function fileVersions(){
  const tags = await Promise.all(WATCHED.map(u => fetch(u, {method: "HEAD", cache: "no-store"})
    .then(r => r.ok ? r.headers.get("etag") || r.headers.get("last-modified") || "" : "").catch(() => "")));
  return tags.every(Boolean) ? tags.join("|") : null;
}
function quietMoment(){
  if (playing || (OPTS.hold && OPTS.hold())) return false;
  if (S.mode === "live") return false;
  return !(S.mode === "next" && S.next.start - Date.now() < 15 * 60e3);
}
async function watchUpdates(){
  let base = await fileVersions(), pending = false;
  setInterval(async () => {
    if (!pending){
      const now = await fileVersions();
      if (!base) base = now;
      else if (now && now !== base) pending = true;
    }
    if (pending && quietMoment()){
      try { sessionStorage.setItem("lfm-played", JSON.stringify([...played])); } catch {}
      location.reload();
    }
  }, UPDATE_CHECK_MS);
}

/* ------------------------------------------------------------------ public */
window.LFM = {
  S, PARAMS, ID, SIMS, MOTION, URLS, WX_ICONS, SESSION_NAMES, LFM_YOUTUBE, STAGE, HIDE, DEMO, hidden, t,
  $, flagUrl, countryName, pad, countdown, ago, signed, deltaClass, fitStage, fitText, tighten, overflows,
  paintLicence, paintSR, coin, rotator, renderRivals, renderForm, scrollTrack, currentRace, nextActive,
  renderCrew, crewMates, entrants, renderTrends, standingText,
  // opts.broadcast: also look up LFM's official stream of the next race.
  // opts.hold: () => true while celebrations should wait.
  // opts.celebrations: false = never play any.
  // opts.scenes: true = may switch OBS scenes (see sceneTick).
  start(fn, opts = {}){
    render = fn; OPTS = opts;
    if (HEXCODE) setAccent(HEXCODE, true);  // no flash of the default colour
    translatePage();
    watchAge();
    watchUpdates();
    const go = () => { load(); setInterval(load, DEMO ? 10e3 : REFRESH_MS); setInterval(sceneTick, 2000); };
    if (!DEMO) return go();
    const js = document.createElement("script");
    js.src = "/lfm-card/demo.js"; js.onload = js.onerror = go;
    document.head.append(js);
  },
};
})();
