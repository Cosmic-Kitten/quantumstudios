# Orbit Roblox Launcher

Orbit is a Vercel-hosted static launcher with serverless Roblox OAuth sign-in. Roblox handles the account login; Orbit never asks for or receives the Roblox password.

The deployed site is `https://quantumstudios.vercel.app`. Game-name search and experience details use public Roblox game/search/thumbnail APIs through the Vercel functions in `api/roblox`; these features do not use Roblox account permissions. Search results may contain multiple matches, so choose the intended experience before pinning it. The Orbit Queue search requires the `/api/roblox/search` Vercel function, so a static-only preview server will not provide search results; use the deployed site or `vercel dev`.

The classic launcher is served from `index.html`. Its Explore page recommends public Roblox experiences related to up to three games in the user's local library, with options to inspect, save, or open each pick. The library remains stored in the browser and is not synced to an account. A separate session-based launcher is available at `ai.html`; it supports paginated and sortable name search, public experience details and recommendations, queue ordering/shuffle/launch controls, and a 15/30/45-minute session timer. From either edition, a game's detail view searches the web inside Orbit and draws a graph connecting the experience, gameplay topics, and guide sources. Web research uses the `/api/roblox/research` Vercel function and Bing's RSS search results; source results are unverified links and snippets. A static-only preview server cannot run these APIs; use the deployed site or `vercel dev`. The two editions have links to switch between them, but Orbit Queue does not use the Classic launcher's saved library, favorites, or recent-game data.

## Configure Roblox OAuth

1. Register an OAuth application in the Roblox Creator Dashboard.
2. Add this exact redirect URI to the application: `https://quantumstudios.vercel.app/api/roblox/callback`.
3. Enable the `openid` and `profile` scopes.
4. In Vercel project settings, add these environment variables for the deployment environments you use:

   - `ROBLOX_CLIENT_ID`: the OAuth application's client ID.
   - `ROBLOX_CLIENT_SECRET`: the OAuth application's client secret.
   - `ROBLOX_REDIRECT_URI`: `https://quantumstudios.vercel.app/api/roblox/callback`.
   - `ORBIT_SESSION_SECRET`: a random secret with at least 32 characters. Generate one with `openssl rand -base64 32`.

5. Redeploy the Vercel project and open the deployed HTTPS URL. Choose **Connect Roblox** and approve the requested scopes on Roblox.

Do not put the client secret or session secret in `index.html`, commit them, or expose them as `NEXT_PUBLIC_*` variables. The callback exchanges the authorization code on Vercel, discards the access token after reading the basic profile, and stores only an encrypted profile in an HttpOnly cookie for up to seven days.

## Configure the Turnstile website gate

The site checks visitors before serving pages, assets, or API requests. On the first visit, complete the Turnstile check; the resulting signed, HttpOnly access cookie lasts 12 hours. Use the subtle **Reset verification** button in the lower-right corner of any page to sign out and require a new check. The gate follows the Classic launcher's saved color theme and custom accent when available. Page navigations are not cached by the service worker so an offline cached page cannot bypass the gate.

In Vercel project settings, add these environment variables for the production deployment:

- `TURNSTILE_SECRET`: the secret for the existing Turnstile widget. Store it directly in Vercel; never put it in source control or browser code.
- `TURNSTILE_HOSTNAMES`: `quantumstudios.vercel.app`.
- `ORBIT_SESSION_SECRET`: the existing random secret of at least 32 characters from the Roblox OAuth setup; it signs the short-lived gate cookie.

The existing widget must allow `quantumstudios.vercel.app`. Local testing also requires `localhost` and `127.0.0.1` in the widget's allowed domains; configure `TURNSTILE_SECRET` and `TURNSTILE_HOSTNAMES=localhost,127.0.0.1` in an ignored local environment file. Production verification deliberately rejects local hostnames.

Redeploy after setting the Vercel environment variables. The gate fails closed until `TURNSTILE_SECRET` and the allowed hostname are configured.

## Local checks

Run the OAuth and public game API tests with:

```sh
node --test tests/roblox-oauth.test.js tests/roblox-games.test.js
```

OAuth callback testing also requires a Roblox OAuth application and an HTTPS redirect URI registered with Roblox. `vercel dev` can serve the API routes locally, but the configured redirect URI must still exactly match the Roblox application.