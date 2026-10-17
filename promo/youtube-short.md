# Orbit — YouTube Short

Output: `orbit-shorts.mp4` (1080×1920, 9:16, H.264 + AAC, ~39s)

## Title (pick one)

- Orbit — the launcher that puts your Roblox games one click away
- Stop scrolling Roblox. Start launching with Orbit.
- Orbit: your Roblox library, one screen, one click

## Description

Orbit is a free, browser-based launcher for Roblox games. Save the experiences
you actually play, paste any game link or place ID, queue up a whole session
with a built-in session clock, and switch themes and accents until it feels
like yours. Sign-in and launching still happen on the official Roblox website —
Orbit never asks for your password.

Try it: https://quantumstudios.vercel.app

Features in this short:
0:00 Save your library
0:10 Paste a link, go straight there
0:16 Three themes, any accent
0:22 Search, queue, session clock

#Roblox #RobloxGames #RobloxLauncher #Gaming #Orbit

## Hashtags / tags

Roblox, Roblox launcher, Roblox game library, Roblox queue, Roblox tips,
gaming launcher, Roblox session timer, quantum studios

## Notes

- Everything you see is the real product UI. Footage was captured in a headless
  Chromium at 720×1280 (a phone-sized viewport) with real clicks, typing,
  scrolling, theme switches and a real game search → queue flow, then upscaled
  to 1080×1920. User data (game library, settings) came from the same
  localStorage keys the app writes.
- The deployed site sits behind a Cloudflare Turnstile gate, so pages were
  recorded from the same HTML served locally. Nothing else is faked.
- Captions avoid the Shorts overlay zones (top ~220px, bottom ~420px), and the
  progress bar sits above the caption area.
- Re-render with `node promo/build.mjs`; re-capture footage first with
  `node promo/capture.mjs` (expects a static server on :4173).
