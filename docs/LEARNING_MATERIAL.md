# Interactive Generative Letter App

## 1. Purpose

This project is a reusable person-to-person digital letter app. A writer creates their own message, seals it with an access key, stores the encrypted envelope in their local gallery, and shares the encrypted link with the recipient. The app does not generate or invent the emotional letter content. The animation uses the writer's typed words after the recipient unlocks the envelope.

The app has three phases:

1. Write: collect the recipient, title, access key, key prompt, and message.
2. Gallery: show the writer's own encrypted letters as hanging envelopes.
3. Galaxy River Letter: unlock the envelope, turn the actual recipient/title/message characters into canvas particles, dissolve them into a Milky Way-like river stream, and keep the letter experience entirely inside the p5 canvas.

Plaintext is not saved to browser storage. Saved and shared letters contain encrypted data only.

## 2. Project Structure

```text
Write_Letters/
  index.html
  src/
    app.js
    styles.css
  docs/
    LEARNING_MATERIAL.md
```

`index.html` defines the application sections and loads `p5.js`, `Matter.js`, the stylesheet, and the app logic.

`src/styles.css` controls the paper interface, layout, keyboard, modal, gallery, and river container.

`src/app.js` contains state management, encryption, local storage, sharing, Web Audio, the Matter.js gallery, and the p5.js canvas-based river reveal.

## 3. Data And Privacy Model

The plaintext letter exists as:

```js
{
  recipient,
  title,
  message,
  createdAt
}
```

Before saving:

1. The user enters an access key.
2. PBKDF2 derives an AES key from the access key and a random salt.
3. AES-GCM encrypts the plaintext letter.
4. Only the encrypted record is saved to `localStorage`.

The access key is not stored. Shared letters place the encrypted record in the URL fragment after `#open=...`, and the recipient still needs the access key to decrypt it.

Important limitation: this is client-side privacy, not account security. Anyone with both the encrypted link and the correct key can open the letter. A production product should add accounts, server-side access controls, rate limiting, revocation, and audited key handling.

## 4. Write Phase

The write phase uses native HTML inputs for accessibility and reliability. The message field currently allows up to 5,200 characters.

Typing feedback is procedural:

- short filtered noise creates a soft key click;
- occasional sine tones create a crystalline shimmer;
- floating glyphs visually respond to typing.

No paid audio API or asset service is used.

## 5. Gallery Phase

Matter.js provides the hanging-envelope gallery:

- each encrypted letter is a dynamic rectangle;
- a constraint connects each envelope to an anchor point;
- gravity, damping, and collisions make the gallery feel physical;
- mouse constraints let users drag and open envelopes.

This preserves the person-to-person mechanism: the gallery is built from the writer's own sealed letters.

## 6. Galaxy River Letter Phase

The unlock scene is now the "Milky Way Letter Dissolution" canvas stage. It is designed around this sequence:

1. A deep radial cosmic background appears with static stars and drifting blue nebula wisps.
2. Every character from the recipient, title, and message is placed at its natural reading position on the canvas.
3. On reveal, each character accelerates downward and inward toward an S-curved river axis.
4. Characters rotate through two full turns, shrink from full size to a small mote, and leave short luminous comet tails.
5. Each river impact spawns crystal micro-particles and extra sparkle flashes.
6. The micro-particles flow along the S-curve with small perpendicular drift, pulsing instead of linearly fading.
7. A small line-art paper boat floats left-to-right near the lower edge of the river path.

The side reading panel is hidden when the river animation starts. The canvas is the letter; there is no final DOM-text fade-in for the river content.

## 7. Text As Living Particles

The reveal does not use a sample letter. It reads characters from the decrypted recipient, title, and message:

```js
const letterText = [
  plaintext.recipient ? `To ${plaintext.recipient}` : "",
  plaintext.title || "Untitled letter",
  "",
  plaintext.message || ""
].join("\n");
const characters = [...letterText];
```

Those characters become `CharacterParticle` objects. Whitespace still affects the natural layout, while visible characters draw as canvas glyphs. Each particle has:

- its natural reading position;
- a river impact point on the sigmoid/S-curve;
- a staggered start time and fall duration;
- a 4-6 point luminous tail;
- 0 to 720 degree rotation;
- 1.0 to 0.08 scale collapse;
- an impact state that spawns micro-particles, sparkles, and chime feedback.

The early scene starts readable only because the characters begin in normal letter layout. Readability then dissolves into pattern as the letter becomes the river.

## 8. River Stream And Sparkles

The river is a sigmoid/S-curved particle path across the canvas:

- ambient river motes keep the path visible;
- character impacts spawn 8-14 micro-particles;
- micro-particles cycle through cream, gold, pale blue-gray, and white;
- each micro-particle lives for 2.4-4 seconds, pulses with a sine wave, shrinks from 2px to 0, and floats upward near the end of life;
- a continuous pool of crystal sparkles appears near the river and impact flashes add extra sparkle bursts.

The draw order is: static background and nebula, river particle stream, falling character particles, the small paper boat, then crystal sparkles.

## 9. Sound Design

The audio is generated with the Web Audio API:

- typing: quiet filtered clicks and occasional shimmer tones;
- unlock: fragile bell cascade and low ambient drone;
- water impacts: small glass-like chimes, throttled so the scene stays restrained.

The design avoids cinematic booms. The sound should feel fragile, quiet, deep, and luminous.

## 10. Free Technical Stack

The project uses free browser-native and open-source tools:

- HTML and CSS;
- p5.js;
- Matter.js;
- Web Crypto API;
- Web Audio API;
- browser `localStorage`.

No paid API is required for the current version.

## 11. Future Theme System

A later version can add user-defined templates without paid AI APIs by using structured choices and keyword matching:

```js
const themes = {
  birthday: {
    palette: ["#ffd166", "#ef476f", "#ffffff"],
    motion: "bright-burst",
    sound: "clear-chime"
  },
  farewell: {
    palette: ["#d8dee9", "#8f9aa7", "#ffffff"],
    motion: "slow-river",
    sound: "soft-bell"
  },
  childhoodFriend: {
    palette: ["#f7c59f", "#70d6ff", "#ffffff"],
    motion: "playful-orbit",
    sound: "music-box"
  }
};
```

Users can choose relationship, occasion, mood, and intensity. Natural-language descriptions can be interpreted locally with keyword rules before any AI API is considered.

## 12. Build Workflow

1. Build the HTML structure for writing, gallery, and reveal.
2. Use CSS for paper, layout, accessibility, and the river container.
3. Encrypt the user's letter with Web Crypto before saving.
4. Use Matter.js for the writer's physical envelope gallery.
5. Start a p5.js canvas after successful unlock.
6. Build the static star background once, then animate nebula wisps in the draw loop.
7. Create one canvas particle per letter character and move it from reading layout into the S-curved river.
8. Spawn river micro-particles and sparkle impacts when characters dissolve.
9. Draw the paper boat and continuously refresh the sparkle pool.
10. Trigger Web Audio chimes from unlock and river impacts.

## 13. GitHub Pages Deployment

This app is a static site, so it can be published with GitHub Pages:

1. Push the latest `main` branch to GitHub.
2. Open the repository on GitHub.
3. Go to Settings -> Pages.
4. Under "Build and deployment", choose "Deploy from a branch".
5. Choose branch `main` and folder `/root`.
6. Save and wait for GitHub to publish the site.

After it finishes, the public URL should be:

```text
https://foamyfsky.github.io/Write_Letters/
```
