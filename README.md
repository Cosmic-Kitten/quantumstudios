# Orbit Roblox Launcher

Orbit is a Vercel-hosted static launcher with serverless Roblox OAuth sign-in. Roblox handles the account login; Orbit never asks for or receives the Roblox password.

The deployed site is `https://quantumstudios.org`. Game-name search and experience details use public Roblox game/search/thumbnail APIs through the Vercel functions in `api/roblox`; these features do not use Roblox account permissions. Search results may contain multiple matches, so choose the intended experience before pinning it. The Orbit Queue search requires the `/api/roblox/search` Vercel function, so a static-only preview server will not provide search results; use the deployed site or `vercel dev`.

The classic launcher is served from `index.html`. A separate session-based launcher is available at `ai.html`; it supports paginated and sortable name search, public experience details and recommendations, queue ordering/shuffle/launch controls, and a 15/30/45-minute session timer. From either edition, a game's detail view searches the web inside Orbit and draws a graph connecting the experience, gameplay topics, and guide sources. Web research uses the `/api/roblox/research` Vercel function and Bing's RSS search results; source results are unverified links and snippets. A static-only preview server cannot run these APIs; use the deployed site or `vercel dev`. The two editions have links to switch between them, but Orbit Queue does not use the Classic launcher's saved library, favorites, or recent-game data.

## Configure Roblox OAuth

1. Register an OAuth application in the Roblox Creator Dashboard.
2. Add this exact redirect URI to the application: `https://quantumstudios.org/api/roblox/callback`.
3. Enable the `openid` and `profile` scopes.
4. In Vercel project settings, add these environment variables for the deployment environments you use:

   - `ROBLOX_CLIENT_ID`: the OAuth application's client ID.
   - `ROBLOX_CLIENT_SECRET`: the OAuth application's client secret.
   - `ROBLOX_REDIRECT_URI`: `https://quantumstudios.org/api/roblox/callback`.
   - `ORBIT_SESSION_SECRET`: a random secret with at least 32 characters. Generate one with `openssl rand -base64 32`.

5. Redeploy the Vercel project and open the deployed HTTPS URL. Choose **Connect Roblox** and approve the requested scopes on Roblox.

Do not put the client secret or session secret in `index.html`, commit them, or expose them as `NEXT_PUBLIC_*` variables. The callback exchanges the authorization code on Vercel, discards the access token after reading the basic profile, and stores only an encrypted profile in an HttpOnly cookie for up to seven days.

## Local checks

Run the OAuth and public game API tests with:

```sh
node --test tests/roblox-oauth.test.js tests/roblox-games.test.js
```

OAuth callback testing also requires a Roblox OAuth application and an HTTPS redirect URI registered with Roblox. `vercel dev` can serve the API routes locally, but the configured redirect URI must still exactly match the Roblox application.