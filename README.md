# FarmGear Zim

Hire or buy farm equipment in Zimbabwe. Plain HTML, CSS and JavaScript, no build step.

## Run in SPCK Editor
1. Open the `farmgear-zim` folder in SPCK.
2. Open `index.html` and tap Preview.

## Supabase
Already connected to the Supabase project "FarmGear Zim". The tables (`profiles`, `listings`), the `media` photo bucket and the security rules are set up, and `config.js` holds the project URL and public anon key.

To use your own project instead, run `supabase.sql` in the SQL Editor of a new project and replace the two values in `config.js`. The anon key is safe to ship because the security rules limit what each user can do. Never put the service_role key in the app.

## Sign-up emails
New accounts must confirm their email before signing in (Supabase default). To skip that while testing, turn off "Confirm email" in Supabase under Authentication > Providers > Email.

## Files
- `index.html`: page structure and splash screen
- `style.css`: design
- `app.js`: app logic, Supabase calls, photo upload
- `config.js`: Supabase URL and key
- `supabase.sql`: database and storage setup
