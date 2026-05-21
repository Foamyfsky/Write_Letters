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

`src/app.js` contains the full application logic: state management, encryption, local storage, sharing, audio, the p5.js gallery installation, and the p5.js Galaxy River animation.

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

The gallery is a restrained hanging-paper installation:

- a large red flower canopy sits above the scene;
- thin dark threads descend from the flower;
- encrypted letters appear as ivory ruled papers rather than cartoon envelopes;
- each paper uses vertical micro-type to suggest handwritten columns;
- selecting a paper opens the unlock modal.

The gallery is a local vault. It is built from encrypted records stored in `localStorage`. The visual priority is deliberate linework, paper weight, and quiet composition rather than bouncy physics.

## Galaxy River Phase

After a correct key, the app starts the p5.js Galaxy River sketch. The sequence is designed as a flat illustrated paper-river:

1. A cobalt blue field opens with pale ruled paper lines.
2. The decrypted words appear as vertical handwritten columns.
3. A small paper boat anchors the left side of the composition.
4. Gold moon, star, dot, and letter glyphs detach from the columns.
5. The glyphs sweep through thin curved paths like musical notation or constellation sorting.
6. Fine threads connect selected glyphs back to the boat.
7. A final pale paper field unfurls into readable vertical columns.
8. The side reading panel fades in after the cinematic reveal.

The readable message is deliberately delayed. During the animation, the text is treated as living material rather than static UI copy.

## Text as Motion

The river sketch builds a layout from the decrypted recipient, title, and message. It removes excess whitespace, places the characters into vertical columns, then converts selected characters into moving glyph records:

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

Those records become a typography particle field. Each glyph has a column origin, a path assignment, a delay, a duration, a symbol type, and a size. During the reveal, characters move from readable columns into sweeping constellation curves.

## River Effect Details

The current river implementation follows these design principles:

- thin deliberate lines replace halos and bloom;
- letterforms are treated as physical objects with origin, weight, and direction;
- gold symbols are limited to moons, stars, dots, and selected letters;
- the blue field stays flat and graphic rather than cinematic;
- motion is organized by sweeping curves rather than random particle drift;
- density is restrained so the composition stays poetic and legible.

The result should feel closer to a handmade poetic diagram than a generic galaxy animation.

## Rendering Pipeline

The redesigned Galaxy River sketch uses a single p5.js 2D canvas:

1. Draw the cobalt blue paper field and subtle grain.
2. Draw pale ruled paper architecture and vertical handwriting columns.
3. Draw the paper boat and its thin guide threads.
4. Move gold glyphs from text columns into constellation curves.
5. Unfurl the final pale paper field before the side reading panel appears.

This is intentionally simpler than the previous WEBGL shader approach. The aesthetic depends on typography, line quality, and composition, not rendered light effects.

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
- p5.js for generative drawing;
- Matter.js is still loaded but is no longer required by the current gallery sketch;
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
5. Watch for the redesigned effects: flower-and-thread gallery, ivory hanging papers, blue paper river, vertical handwriting columns, gold moon/star glyphs, sweeping curves, paper boat, and final readable paper.
6. Copy a secure link and confirm the encrypted `#open=` flow can be opened and decrypted with the access key.

## Future Improvements

The next useful additions would be:

- theme presets for different occasions and relationships;
- optional local keyword rules that map message tone to color, motion, and sound settings;
- exportable keepsake images or videos;
- accessibility controls for reduced motion and reduced audio;
- account-backed storage for production use.

Manim is not a good fit for the core experience because this app depends on live user text, unlock timing, browser audio, and interactive rendering. It would only be useful if the goal changed from personalized interactive letters to pre-rendered videos.
