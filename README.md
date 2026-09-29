# Orbit Roblox Launcher

Orbit is a Vercel-hosted static launcher with serverless Roblox OAuth sign-in. Roblox handles the account login; Orbit never asks for or receives the Roblox password.

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

## Local checks

Run the OAuth helper tests with:

```sh
node --test tests/roblox-oauth.test.js
```

OAuth callback testing also requires a Roblox OAuth application and an HTTPS redirect URI registered with Roblox. `vercel dev` can serve the API routes locally, but the configured redirect URI must still exactly match the Roblox application.