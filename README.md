# LFM Card

A live OBS overlay for [Low Fuel Motorsport](https://lowfuelmotorsport.com) drivers. It shows your LFM rating, licence and safety rating, counts down to your next race, shows your result afterwards and celebrates wins, podiums and promotions.

**Use it at [lavaro.net/lfm-card](https://lavaro.net/lfm-card/).** Paste your LFM ID, pick a layout, copy the URL into an OBS browser source. Nothing to install.

Unofficial and fan-made; all race data comes from LFM's public API.

## Layouts

| Layout | URL | OBS source size |
|---|---|---|
| Card | `/lfm-card/<id>` | 1600 × 900 |
| Lower third | `/lfm-card/<id>?layout=lower-third` | 1600 × 200 |
| Starting soon | `/lfm-card/<id>?layout=starting-soon` | 1920 × 1080 |

## Features

- **Next race**: series, split, countdown, track, car, door number, seed, SOF, weather, session lengths and a scrolling list of the drivers around you.
- **Starting soon scene**: countdown, session schedule (practice / qualifying / race times), track with your record there, the full entry list with drivers who are streaming, career stats and form.
- **Official broadcast**: shows when LFM is streaming your race, on YouTube (scheduled streams, so it appears ahead of time) or live on the official LFM Twitch channels.
- **Live**: switches to a LIVE state from lights out until the result is published.
- **Results**: start → finish, places gained, rating and SR change, incidents, best lap, and a form guide of the last 10 finishes.
- **Livery flip**: the avatar flips to a picture of your car in your LFM custom livery every 30 s.
- **Celebrations**: banners for a win, a podium, a new personal-best rating, a licence promotion and every 100th start.
- **Multi-sim**: ACC, AC, AC EVO, LMU, AMS2 and RaceRoom. It follows the sim of your next race unless you pin one.
- **Ambient motion**: slow light sweeps and glints so the overlay never looks frozen.

All URL options (`sim`, `flip`, `page`, `celebrate`, `motion`, `show`, `broadcast`) are documented on the [manual page](https://lavaro.net/lfm-card/#options).

## How it works

Plain HTML, CSS and JavaScript with no build step and no backend beyond a static web server.

```
web/
  lfm.js              shared data layer: loads LFM data, works out the state, celebrations, widgets
  lfm.css             shared styles: fonts, plates, coin flip, page rotator, celebrations, motion
  card.html           full card
  lower-third.html    lower third
  starting-soon.html  starting-soon / result scene
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
| Car names | `…/api/lists/getCars` |
| Livery screenshot | `…/api/liveries/screenshot/<base64 livery id>?width=1200` |
| Next race | `api.lowfuelmotorsport.de/api/licenseWidgetUserData/<id>` (the JSON behind LFM's own card) |
| Next race, fallback | `api.lowfuelmotorsport.de/lfmlicense/<id>` (official card HTML; not CORS-enabled, so proxied by nginx at `/lfm-api/lfmlicense/`) |
| Official LFM Twitch channels live now | `…/api/checkBroadcaster` |
| Official LFM YouTube broadcasts | `youtube.com/@LowFuelMotorsport/streams` (proxied and cached 10 min by nginx at `/lfm-api/youtube-streams`) |

Data refreshes every two minutes; the YouTube schedule every ten.

A broadcast counts as this race's when the stream title has the series name and the track (or its city), and it's scheduled for the race day, e.g. `[ENG] Caseking.de Prime Series R05 Suzuka`. Twitch has no public schedule, so the official channels only show once they're live and their title mentions the series (or the race is also on YouTube).

## Self-hosting

1. Copy `web/` to `<site root>/lfm-card/`.
2. Use `nginx/lfm-card.conf` (or port its routes to your server). The layout routing is required. The `/lfm-api/` proxies are a fallback for the next race and the YouTube broadcast check; without them those parts just stay empty.
3. Provide the assets the pages load from the site root, or edit the paths:
   - `/fonts/GeneralSans-*.woff2`: [General Sans](https://www.fontshare.com/fonts/general-sans) from Fontshare (Regular, Italic, Medium, MediumItalic, Semibold, SemiboldItalic, Bold, BoldItalic).
   - `/logo.svg`: shown for Lavaro Racing drivers (team id `LAVARO_TEAM_ID` in `lfm.js`). Swap in your own.
   - `/favicon.svg`.

`web/lfm-logo.svg` is the Low Fuel Motorsport logo and belongs to LFM.

## Licence

MIT. See [LICENSE](LICENSE).
