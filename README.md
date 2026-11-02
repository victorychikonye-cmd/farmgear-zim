# FarmGear Zim

Hire or buy farm equipment, sell crops and livestock, and check recorded market prices in Zimbabwe.
Plain HTML, CSS and JavaScript, no build step. Works on GitHub Pages, as a PWA and in an Android WebView/TWA app.

## Run in SPCK Editor
Open the folder, open `index.html`, tap Preview.

## Supabase
Connected to the "FarmGear Zim" project (`config.js` holds the URL and public anon key only).
Never put a service_role key in the app.
For a new project run, in order: `supabase.sql`, `messaging.sql`, `marketplace.sql`, `community.sql`.
Then make yourself admin: `update public.user_profiles set role='admin' where email='YOU@EXAMPLE.COM';`

## Prices are recorded, not live
No agricultural prices are built in. Administrators add each price with a source and date (Profile > Admin dashboard > Prices).
Prices older than their product's limit are labelled Outdated; products with no data show "Price unavailable".

## Files
- `index.html`, `style.css`: page and design
- `app.js`: shell, sign-in, equipment, messages, shared helpers (`window.FG`)
- `market.js`: produce marketplace, buy requests, enquiries
- `prices.js`: market prices, comparison, history charts, alerts
- `community.js`: farmer community (tips, questions, comments)
- `admin.js`: admin dashboard
- `sw.js`, `manifest.json`, `icon-*.png`: PWA
- `supabase.sql`, `messaging.sql`, `marketplace.sql`, `community.sql`: database
