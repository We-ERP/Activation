# Activation & Follow-up — Ops Console

Hourly performance dashboard: **Hour → Task Group → Leader → Agent**.

## Structure
```
index.html      shell only (loads CSS/JS, holds the toolbar + #dashboard mount point)
css/style.css   all visual design (tokens live at the top as CSS variables)
js/app.js       all logic (Sheet sync, CSV processing, rendering)
```

## How it works
1. On load, `app.js` calls your Google Apps Script Web App at the `tab=Str` endpoint
   and reads:
   - column **D** → agent id
   - column **F** → task group
   - column **M** → leader name
2. You paste or upload the ticket CSV export (must contain at least
   `added_by`, `added_on`, `case_action`, `ticket_status`).
3. Each ticket's agent is looked up in the Str mapping to place it under the
   right group/leader. If an agent isn't in the mapping (or the sheet can't be
   reached), it falls back to the CSV's own `added_by_leader` column under an
   "Unmapped" group so nothing silently disappears.

## Configuring
Everything you're likely to change lives at the top of `js/app.js`:

```js
const SHEET_URL   = "...";   // your Apps Script /exec URL
const COL_USER    = 3;       // column D
const COL_GROUP   = 5;       // column F
const COL_LEADER  = 12;      // column M
const COOR        = [...];   // coordinator agent IDs
```

Colors, fonts, spacing all live as CSS variables at the top of `css/style.css`
under `:root`.

## Deploying on GitHub Pages
Push these three files/folders as-is, enable Pages on the repo, and it will
work with no build step — it's plain HTML/CSS/JS.
