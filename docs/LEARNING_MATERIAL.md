# Letters in Motion - Learning Material

## Overview

Letters in Motion is a browser-based app for writing, sealing, sharing, and opening private digital letters. The experience is intentionally personal: the app never invents the message. It uses the writer's own words as the source material for the final generative animation.

The project has three user-facing phases:

1. Write a letter with a recipient, title, access key, optional key prompt, and message.
2. Store the sealed letter in a local encrypted gallery.
3. Unlock the letter into a cinematic Galaxy River reveal built from the decrypted text.

Plaintext is kept out of browser storage. The saved gallery and shared links contain encrypted records only.

## Project Structure

```text
Write_Letters/
  index.html
  src/
    app.js
    styles.css
  docs/
    LEARNING_MATERIAL.md
```

`index.html` defines the compose, gallery, unlock, and river sections. It loads p5.js, Matter.js, the stylesheet, and the application script.

`src/styles.css` controls the responsive layout, paper forms, gallery panels, modal states, canvas containers, and final letter reveal.

`src/app.js` contains the full application logic: state management, encryption, local storage, sharing, audio, Matter.js physics, and the p5.js Galaxy River animation.

## Privacy Model

Each letter is converted into this plaintext object before encryption:

```js
{
  recipient,
  title,
  message,
  createdAt
}
```

The save flow is:

1. The writer enters an access key.
2. The browser derives an AES key using PBKDF2 and a random salt.
3. The plaintext object is encrypted with AES-GCM.
4. Only the encrypted payload, salt, IV, key prompt, and metadata are stored.

The access key is not stored. A shared link places the encrypted record in the URL fragment after `#open=...`; the recipient still needs the access key to decrypt it.

This is client-side privacy, not complete account security. A production service should add user accounts, server-side authorization, revocation, rate limiting, audit logging, and a reviewed key-management design.

## Compose Phase

The compose view favors reliable native controls:

- short text inputs collect recipient, title, access key, and key prompt;
- the message textarea accepts up to 5,200 characters;
- a live paper preview mirrors the writer's content;
- floating glyphs and soft Web Audio clicks respond to typing.

The app does not call an AI service or a paid media API. All visual and audio feedback is generated in the browser.

## Gallery Phase

The gallery uses Matter.js to make sealed letters feel physical:

- each letter is represented as a hanging envelope body;
- constraints attach envelopes to anchor points;
- gravity, damping, and collision settings provide weight;
- mouse constraints let the user drag and select envelopes.

The gallery is a local vault. It is built from encrypted records stored in `localStorage`, and selecting an envelope opens the unlock modal.

## Galaxy River Phase

After a correct key, the app starts the p5.js Galaxy River sketch. The sequence is designed as a short emotional arc:

1. A sealed envelope floats in warm darkness.
2. A bright rose-memory burst opens the scene.
3. The atmosphere collapses into a cold galaxy river.
4. The user's words become falling star-glyphs.
5. Star-glyphs hit the water, trigger chimes, and create concentric ripples.
6. Reflections stretch and shimmer across the water surface.
7. A paper boat appears and opens into a readable letter.
8. The side reading panel fades in after the cinematic reveal.

The readable message is deliberately delayed. During the animation, the text is treated as living material rather than static UI copy.

## Text as Motion

The river sketch builds a layout from the decrypted recipient, title, and message. It wraps those lines to fit the final paper, then converts each visible character into a glyph record:

```js
{
  char,
  lineIndex,
  wordId,
  wordOrder,
  letterInWord,
  order,
  sceneX
}
```

Those records become falling `glyphStars`. Each one receives a sky position, a water impact position, duration, sway, spin, alpha scale, and impact state. Sequential letters from the same word can draw fine connection lines, echoing generative typography sketches where language moves between readable order and abstract structure.

## River Effect Details

The current river implementation follows the project guide's priority fixes:

- the shader uses a stronger warm-to-cold color split;
- nebula color and a soft dust lane make the background less flat;
- water ripples use four slower shader rings instead of two fast rings;
- canvas ripples become visible early in the collapse;
- letter glyphs render with orbiting micro-stars;
- reflections use warm letter colors, cool star colors, horizontal shimmer, and wider scaling;
- fireflies have larger additive halos;
- the rose-memory burst has an early white flash and denser additive rings;
- star timing begins during the collapse instead of after it.

The result should feel less like a static glowing-letter scene and more like a physical river where the user's words become light, water, sound, and reflection.

## Rendering Pipeline

The Galaxy River sketch uses two layers:

1. A WEBGL shader draws the atmospheric background, galaxy, stars, water color, and shader-side ripple light.
2. A transparent p5 graphics layer draws envelopes, rose particles, fireflies, glyph stars, ripples, reflections, boat, and paper text.

The transparent layer is composited above the shader. This keeps the background efficient while allowing detailed 2D drawing for letter particles and foreground effects.

## Sound Design

The sound system uses the Web Audio API:

- typing produces quiet filtered clicks and occasional shimmer tones;
- unlocking starts a soft bell cascade and ambient bloom;
- water impacts trigger small glass-like chimes;
- impact sounds are throttled so dense glyph falls stay gentle.

The sound direction is restrained: fragile, luminous, and close to the letter rather than loud or cinematic.

## Technical Stack

The project runs as a static browser app using free web technologies:

- HTML and CSS;
- p5.js for generative drawing and shaders;
- Matter.js for the gallery physics;
- Web Crypto API for encryption;
- Web Audio API for procedural sound;
- browser `localStorage` for the encrypted vault.

No backend or paid API is required for the current version.

## Local Development

Run the app from the project root with a simple static server:

```powershell
python -m http.server 4173
```

Then open:

```text
http://localhost:4173/
```

Using `localhost` is preferable to opening the HTML file directly because browser cryptography and sharing behavior are most reliable in a local secure-context equivalent.

## Validation Checklist

Use this checklist after changing the project:

1. Load the compose view and confirm the form, preview, keyboard, and typing feedback work.
2. Seal a letter and confirm only encrypted data is saved.
3. Open the gallery and confirm envelopes render, move, and can be selected.
4. Unlock a letter with the correct key and confirm the river animation starts.
5. Watch for the guide-aligned effects: bright burst, warm-to-cold collapse, falling glyphs, early ripples, stronger reflections, firefly halos, chimes, boat, and final readable paper.
6. Copy a secure link and confirm the encrypted `#open=` flow can be opened and decrypted with the access key.

## Future Improvements

The next useful additions would be:

- theme presets for different occasions and relationships;
- optional local keyword rules that map message tone to color, motion, and sound settings;
- exportable keepsake images or videos;
- accessibility controls for reduced motion and reduced audio;
- account-backed storage for production use.

Manim is not a good fit for the core experience because this app depends on live user text, unlock timing, browser audio, and interactive rendering. It would only be useful if the goal changed from personalized interactive letters to pre-rendered videos.
