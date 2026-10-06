# Pay Attention To Me

A 2D battle scene where the move you pick pings your person's phone.

- Sign in with Google (Supabase Auth)
- Pair with a 6-character code
- Three attack options: **Need Attention**, **Thinking of You**, **Missing You**
- An octopus mood toy you flip between happy / angry / sad — your partner sees it
- Real Web Push (works on iPhone once added to Home Screen, iOS 16.4+)
- All data in Supabase Postgres: profiles, pairs, push subscriptions, poke history
- 10-second cooldown, rename, leave pair, delete account

## The look

A Pokemon-style battle screen in valentine shades — white, red, pink and light blue.
Both of you are an octopus mood toy on a platform, each with a status box showing
your name, your current mood and an "attention" bar that fills when the other
person sends something and fades over a few hours. Underneath is a message box and
a 2x2 move grid with a `▶` cursor, exactly like picking an attack.

Tapping a move selects it; tapping the selected move sends it. That second tap is
deliberate — a poke wakes someone's phone, so it shouldn't happen by brushing the
screen. The message box says which move is armed.

Tap your own octopus to flip its mood. The flip is saved after a short pause, and
your partner only gets a notification if the mood actually ended up different —
so cycling through all three faces stays silent.

- **Art**: every sprite is inline SVG in `public/sprites.js`. No image assets to
  load, nothing to re-export when a colour changes.
- **Motion**: [GSAP](https://gsap.com) drives the attack timeline, mood flip,
  screen transitions, idle bobbing and the heart particles. It is served from
  `node_modules` at `/vendor/gsap.js` so the app still animates offline.
- **Fallbacks**: if GSAP fails to load, or the device asks for reduced motion,
  every animation helper lands on the same end state instantly. The app is fully
  usable with no animation at all.
- **Palette**: fixed. The game keeps its valentine colours in dark mode, the same
  way a game looks the same whatever the phone is set to.

## How it fits together

```
Browser ──Google sign-in──▶ Supabase Auth ──▶ session (access token) in browser
Browser ──API call + Bearer token──▶ Node server ──verifies token──▶ Supabase Auth
                                     Node server ──secret key──▶ Supabase Postgres
                                     Node server ──web-push──▶ partner's phone
```

The browser never reads tables directly. RLS is on with no policies, so the
publishable key can't touch any data; only the server (secret key) can.

## Setup (about 15 minutes)

### 1. Supabase project
1. Create a free project at [supabase.com](https://supabase.com).
2. **SQL Editor** → paste all of `supabase/schema.sql` → **Run**.
   (Already running an older copy? Re-run the same file — it is safe to re-run and
   adds the `mood` column the octopus toy needs. Until you do, flipping the mood
   returns an error and everything else keeps working.)
3. **Project Settings → API Keys**: copy the Project URL, the **publishable** key and the **secret** key.

### 2. Google OAuth client
1. [Google Cloud Console](https://console.cloud.google.com) → create a project.
2. **APIs & Services → OAuth consent screen**: External, add app name + your email.
   Scopes: just the defaults (`email`, `profile`, `openid`).
3. **Credentials → Create credentials → OAuth client ID → Web application**.
4. **Authorized redirect URIs**: add
   `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`
   (Supabase shows this exact URL on the Google provider page.)
5. Copy the **Client ID** and **Client secret**.

### 3. Connect them
1. Supabase → **Authentication → Sign In / Providers → Google** → enable, paste Client ID + secret, save.
2. Supabase → **Authentication → URL Configuration**:
   - **Site URL**: your production URL (e.g. `https://patm.onrender.com`)
   - **Redirect URLs**: add `http://localhost:3000/**` and your production URL with `/**`

### 4. Run it
```bash
cp .env.example .env      # fill in the Supabase values
npm install
npm start                 # http://localhost:3000
```

For production, also set VAPID keys (`npx web-push generate-vapid-keys`).
If they change, every saved push subscription stops working.

### Testing on your phone
Push and Google sign-in both need HTTPS. Use a tunnel and add its URL to
Supabase's Redirect URLs:
```bash
npx localtunnel --port 3000     # or: cloudflared tunnel --url http://localhost:3000
```

## Deploy (free)
Render, Railway or Fly.io. No disk needed anymore since everything lives in Supabase.
Set the same env vars as `.env`. Add the deployed URL to Supabase's Site URL / Redirect URLs.

## Google consent screen: testing vs published
While the consent screen is in **Testing**, only Google accounts you add as test users can sign in.
Click **Publish app** to let anyone in. With only `email`/`profile` scopes, Google doesn't require a review.

## iPhone setup (for users)
1. Open the site in Safari → sign in with Google
2. Share → **Add to Home Screen**
3. Open it from the Home Screen icon, sign in again if asked, tap **Enable** for notifications

The Home Screen app has its own storage on iOS, so signing in once in Safari
doesn't carry over. Test the sign-in redirect inside the Home Screen app on a
real iPhone before launch.

## Data model
| Table | What |
| --- | --- |
| `profiles` | one per Google user: name, avatar, `pair_id`, `last_poke_at`, `mood` |
| `pairs` | share code; deleted automatically when the last member leaves |
| `push_subscriptions` | one per device; dead ones are pruned when a push returns 404/410 |
| `pokes` | history: who, level, when |

Deleting a user in Supabase Auth cascades to their profile and subscriptions.
`join_pair` / `leave_pair` are SQL functions so two people can't grab the same slot at once.

## Files
```
server.js              Express API, auth middleware, web-push
db.js                  every Supabase query
supabase/schema.sql    tables, RLS, join/leave functions
public/index.html      screens: title, pair up, waiting, battle, menu
public/style.css       the 2D game look (boxes, palette, scene layout)
public/sprites.js      all the art, as inline SVG
public/ui.js           every animation (GSAP, with a no-motion fallback)
public/app.js          client: Supabase Auth, API calls, push subscribe
public/sw.js           service worker: notifications + offline shell
```

The app icon is `public/icons/icon.svg`. The PNG icons in that folder are from the
earlier design — regenerate them from the SVG if you want the manifest icons to
match (the SVG is listed first, so browsers that support it already use it).

## Going to TestFlight later
1. Wrap with Capacitor: `npm i @capacitor/core @capacitor/cli @capacitor/ios && npx cap init && npx cap add ios`
2. Swap Web Push for native push (`@capacitor/push-notifications` + an APNs key)
3. Google sign-in inside a native app needs a deep-link redirect (e.g. `patm://auth`) added to Supabase's Redirect URLs
4. Archive in Xcode → App Store Connect → TestFlight → enable a public link

Needs a Mac with Xcode and the $99/yr Apple Developer Program. Builds expire after 90 days.
