# LFM Card

A live OBS overlay for [Low Fuel Motorsport](https://lowfuelmotorsport.com) drivers. It shows your LFM rating, licence and safety rating, counts down to your next race, shows your result afterwards and celebrates wins, podiums and promotions.

**Use it at [lavaro.net/lfm-card](https://lavaro.net/lfm-card/).** Paste your LFM ID, pick a layout, copy the URL into an OBS browser source. Nothing to install.

Unofficial and fan-made; all race data comes from LFM's public API.

## Layouts

| Layout | URL | OBS source size (16:9 / 21:9 / 32:9 at 1080p) |
|---|---|---|
| Card | `/lfm-card/<id>` | 1920 × 1080 / 2560 × 1080 / 3840 × 1080 |
| Lower third | `/lfm-card/<id>?layout=lower-third` | 1600 × 200 / 2100 × 200 / 3200 × 200 |
| Starting soon | `/lfm-card/<id>?layout=starting-soon` | 1920 × 1080 / 2560 × 1080 / 3840 × 1080 |
| Race day | `/lfm-card/<id>?layout=race-day` | 1920 × 1080 / 2560 × 1080 / 3840 × 1080 |
| Mini | `/lfm-card/<id>?layout=mini` | 800 × 160 at any aspect (533 × 107 for 720p) |

The overlay follows the source size from 16:9 up to 32:9 and uses the extra width (wider stats, side panel, longer entry list). For 1440p multiply by 4/3, e.g. 3440 × 1440 or 5120 × 1440; it stays sharp at any size.

## Features

- **Next race**: series, split, countdown, track, car, door number, seed, SOF, weather, session lengths and a scrolling list of the drivers around you.
- **Starting soon scene**: countdown, session schedule (practice / qualifying / race times), track with your record there, the full entry list with drivers who are streaming, career stats and form.
- **Race day**: one full-screen source for the whole race. Starting soon scene until a minute before the server opens, then a frame along the top and bottom (session, time left, track, conditions, you and the field) with the game visible in the middle, then the full-screen result and celebrations.
- **Official broadcast**: shows when LFM is streaming your race, on YouTube (scheduled streams, so it appears ahead of time) or live on the official LFM Twitch channels.
- **Live**: switches to a LIVE state from lights out until the result is published, also after the source is refreshed mid-race.
- **Results**: start → finish, places gained, rating and SR change, incidents, best lap, and a form guide of the last 10 finishes. DNF in the form means LFM has no finishing position for that race (retired, or didn't start / left early).
- **Livery flip**: the avatar flips to a picture of your car in your LFM custom livery every 30 s (the car maker's logo without one).
- **Celebrations**: banners for a win, a podium, a new personal-best rating, a licence promotion and every 100th start.
- **Multi-sim**: ACC, AC, AC EVO, LMU, AMS2 and RaceRoom. It follows the sim of your next race unless you pin one.
- **Results table**: after the race, the finishing order of your class in your split with gaps and rating changes.
- **Demo race**: `?demo=1` runs a made-up race with your real profile (countdown, sessions, frame, win, results) in about five and a half minutes, for setting up scenes any day.
- **Languages**: `?lang=de|es|fr|it|nl|pt`.
- **Make it yours**: `hide=` parts you don't want, `frame=top|bottom` for the race day frame, `bg=off` for a transparent background.
- **Updates itself**: the overlay notices new code on the server and reloads at a quiet moment (not during or just before a race). A small tag warns when LFM data is more than 10 minutes old.
- **Your colours**: the accent follows your licence colour, or set your own with `HEXCODE=FF0033`.
- **Ambient motion**: slow light sweeps and glints so the overlay never looks frozen.

All URL options (`aspect`, `HEXCODE`, `demo`, `lang`, `hide`, `frame`, `bg`, `sim`, `flip`, `page`, `celebrate`, `motion`, `show`, `broadcast`) are documented on the [manual page](https://lavaro.net/lfm-card/#options).

## How it works

Plain HTML, CSS and JavaScript with no build step and no backend beyond a static web server.

```
web/
  lfm.js              shared data layer: loads LFM data, works out the state, celebrations, widgets, translations
  lfm.css             shared styles: fonts, plates, coin flip, page rotator, celebrations, motion
  card.html           full card
  lower-third.html    lower third
  starting-soon.html  starting-soon / result scene, and the race day frame (layout=race-day)
  mini.html           mini card for low-resolution streams
  demo.js             made-up race for ?demo=1 (loaded only then)
  index.html          manual + URL builder
nginx/lfm-card.conf   example server config
```

Data sources (LFM's JSON API is CORS-open, so the browser calls it directly):

| What | Endpoint |
|---|---|
| Profile, ratings per sim | `api3.lowfuelmotorsport.com/api/users/getUserData/<id>` |
| Career stats | `…/api/users/getUserStats/<id>` |
| Race history and results | `…/api/users/getUsersPastRaces/<id>?start=0&limit=N` |
| Race details, entry list, results | `…/api/race/<raceId>` |
| Car names and maker logos | `…/api/lists/getCars` (`thumbnail` → `cdn.lowfuelmotorsport.com/images/manufacturers/<file>`) |
| Livery screenshot | `…/api/liveries/screenshot/<base64 livery id>?width=1200` |
| Next race | `api.lowfuelmotorsport.de/api/licenseWidgetUserData/<id>` (the JSON behind LFM's own card) |
| Next race, fallback | `api.lowfuelmotorsport.de/lfmlicense/<id>` (official card HTML; not CORS-enabled, so proxied by nginx at `/lfm-api/lfmlicense/`) |
| Official LFM Twitch channels live now | `…/api/checkBroadcaster` |
| Official LFM YouTube broadcasts | `youtube.com/@LowFuelMotorsport/streams` (proxied and cached 10 min by nginx at `/lfm-api/youtube-streams`) |

Data refreshes every two minutes; the YouTube schedule every ten. Career stats take LFM a few seconds to answer, so they load in the background and fill in after the first render.

A broadcast counts as this race's when the stream title has the series name and the track (or its city), and it's scheduled for the race day, e.g. `[ENG] Caseking.de Prime Series R05 Suzuka`. Twitch has no public schedule, so the official channels only show once they're live and their title mentions the series (or the race is also on YouTube).

## Self-hosting

1. Copy `web/` to `<site root>/lfm-card/`.
2. Use `nginx/lfm-card.conf` (or port its routes to your server). The layout routing is required. The `/lfm-api/` proxies are a fallback for the next race and the YouTube broadcast check; without them those parts just stay empty.
3. Provide the assets the pages load from the site root, or edit the paths:
   - `/fonts/GeneralSans-*.woff2`: [General Sans](https://www.fontshare.com/fonts/general-sans) from Fontshare (Regular, Italic, Medium, MediumItalic, Semibold, SemiboldItalic, Bold, BoldItalic).
   - `/logo.svg`: shown for Lavaro Racing drivers (team id `LAVARO_TEAM_ID` in `lfm.js`). Swap in your own.
   - `/favicon.svg`.
4. The self-update check compares the `ETag` / `Last-Modified` headers of the overlay files, which nginx sends by default. Make sure a CDN in front doesn't strip them or cache the files (the example config sends `no-cache`).

`web/lfm-logo.svg` is the Low Fuel Motorsport logo and belongs to LFM.

## Licence

MIT. See [LICENSE](LICENSE).
