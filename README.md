# The Magical Camera (rpgwalk)

A walking game in one web page. You carry a clockwork camera that is wound by walking. It holds three plates per walk. At the end you develop them in a darkroom, and your reflection on the walk decides which creature was hiding in each photo.

Prototype v0, built 11 Nov 2026. Everything is in `index.html`. No build step, no account, no server. Design decisions and screenshots: [`docs/DESIGN.md`](docs/DESIGN.md).

## The loop

1. **Take the camera.** One tap. This is where the phone asks for motion, camera and location.
2. **Load a roll.** Hold the canister. If you forget, the camera loads itself the first time you raise it.
3. **Raise it.** Hold the phone upright at eye height and keep still. It unfolds and starts to mount. A soft tone breathes with you (4 seconds in, 6 out) and rises as the mount completes. Wobble and it wavers. Lower the phone and it folds, no plate spent.
4. **Squeeze.** After 60 seconds the viewfinder opens. Press and hold anywhere to fire the shutter.
5. **Walk on.** The first plate of a walk is free. Each later plate needs about 5 minutes of walking (about 500 steps or 360 m). The brass gauge shows the pressure building.
6. **Pull the roll**, then the darkroom: pull the chain for the red light, write how the walk was, pour your words into the tray, rock the tray to develop each plate, hang it, and pull the chain again for white light.
7. **The drying line.** Tap a print to read its back. Creatures with a location are pinned on the map, and the compass on the camera points to the nearest one.

## Who paints the creature

Set in the workshop (link at the bottom of the brass plate).

| Painter | What leaves the phone | Status |
|---|---|---|
| Clockwork | Nothing | Tested. Always the fallback. |
| Pollinations (free, no key) | A short text description: mood plus up to five words from the reflection | Not verified. A test request from the build machine was refused. |
| Hugging Face, FLUX.1 Kontext | The photo | Not tested. Needs a token. |

## Limits of a web page

- The page sleeps when the phone is locked. Winding then relies on GPS distance, credited when you open it again. Step counting and the in-pocket sounds only work while the page is open.
- No vibration on iPhone Safari. Haptics need a native app.
- Portrait only. The iPhone ring switch must be on to hear anything.

## Credits

- Typefaces: IM Fell English and IM Fell English SC by Igino Marini, Caveat by Impallari Type (SIL OFL), Special Elite by Astigmatic (Apache 2.0), via Google Fonts.
- Map: Leaflet by Volodymyr Agafonkin (BSD-2). Map data © OpenStreetMap contributors.
- Optional painting: Pollinations.ai; FLUX.1 Kontext [dev] by Black Forest Labs through Hugging Face Inference Providers.
- Design references: the Professor Layton games (Level-5), Wii-era gesture play (Nintendo), and the tray-rocking of a wet darkroom.
- All sounds are synthesised in the browser. The camera, gauge, darkroom and clockwork creatures are drawn in code. No third-party art, 3D models or audio samples are used yet.
