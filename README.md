# Pay Attention To Me

A battle scene where the move you pick pings your person's phone.

- Sign in with Google (Supabase Auth)
- Pair with a 6-character code
- Four attacks: **Need attention**, **Thinking of you**, **Missing you** and **MWAH**
- **Cooldowns**: 5 seconds after any attack, 3 seconds after MWAH so it can be spammed
- **Combos**: three moves in a row within a minute. The last one becomes one loud notification, and both phones get a pop-up
  - **Triple threat**: Need attention, Missing you, Thinking of you
  - **Love letter**: Thinking of you, Missing you, MWAH
  - **Heartbreaker**: MWAH, Need attention, Missing you
  - **Sweet dreams**: Missing you, Thinking of you, MWAH
- **Love shower**: spam MWAH (8 within a minute) and a gold button pops up. It sends a notification,
  and when your partner opens the app their screen floods with falling hearts
- An octopus mood toy you flip between happy / angry / sad: your partner sees it
- Real Web Push (works on iPhone once added to Home Screen, iOS 16.4+)
- All data in Supabase Postgres: profiles, pairs, push subscriptions, poke history
- Rename, leave pair, delete account

> **Upgrading from the 3-attack version?** Re-run `supabase/schema.sql` in the Supabase SQL editor.
> It widens the `pokes.level` check (now 1-9) so MWAH, the shower and the combos can be saved. Until
> you do, the new moves answer with a "re-run schema.sql" message and the old three keep working.

## The look

Two plush octopuses face off on a pixel seabed, built to feel like a 3D diorama of 8-bit
characters. Everything is full-bleed on a phone: a top bar with your partner's plate, an open
stage, and a command dock with big thumb-sized buttons. Nothing is fixed-aspect, so nothing is
cut off or left floating in empty space.

- **Camera**: swipe (or move the mouse) and the world shifts. Each layer moves by its own depth,
  so the far rocks barely move while the foreground kelp sweeps past, and the camera drifts back
  to centre when you let go (`public/world.js`).
- **Sea life**: bubbles, jellyfish, schools of fish, drifting hearts, light shafts, swaying kelp.
  It is all CSS animation, so it keeps moving even if GSAP never loads.
- **Octopus**: redrawn from the plush-toy references in `design-ref/`: round dome, flat petal
  tentacles, glossy eyes. Pink = happy, purple = angry, teal = sad. The two fighters look at each
  other, lean into a battle stance and make kiss / ouch faces when a move lands.
- **UI frames**: gold-trimmed 9-slice pixel frames with corner rivets, not gradients and borders.
  Buttons are flat pixel fills with a cooldown that drains away in chunky steps.
- **One tap sends.** The cooldown is the safety net against accidental pokes.
  (The old two-tap "select, then confirm" went away with the cursor menu.)

Tap your own octopus (or "Flip") to change its mood. The flip is saved after a short pause, and
your partner only gets a notification if the mood actually ended up different, so cycling
through all three faces stays silent.

### Art pipeline

- **Sprites** (`public/sprites.js`): drawn on tiny grids and emitted as inline SVG, one path per
  colour. No image files; change a colour in one place.
- **Backdrop + frames** (`public/art/*.png`): baked by `node tools/gen-art.js` (no dependencies).
  Edit the script and re-run it to restyle the world or the panels.
  `node tools/preview-sprites.js out.png` dumps a sprite sheet so you can check the art by eye.
- **Motion**: [GSAP](https://gsap.com) drives the attack timeline, mood flip, screen transitions,
  idle bobbing and heart particles. It is served from `node_modules` at `/vendor/gsap.js` so the
  app still animates offline. The shower is a small canvas scaled up with nearest-neighbour.
- **Fallbacks**: if GSAP fails to load, or the device asks for reduced motion, every animation
  helper lands on the same end state instantly. The app is fully usable with no animation at all.

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
