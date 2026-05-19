# Interactive Generative Letter App

## 1. Purpose

This project is a reusable person-to-person digital letter app. A writer creates their own message, seals it with an access key, stores the encrypted envelope in their local gallery, and shares the encrypted link with the recipient. The app does not generate or invent the emotional letter content. The animation uses the writer's typed words after the recipient unlocks the envelope.

The app has three phases:

1. Write: collect the recipient, title, access key, key prompt, and message.
2. Gallery: show the writer's own encrypted letters as hanging envelopes.
3. Galaxy River Letter: unlock the envelope, release a brief rose-memory burst, collapse into cosmic water, turn the user's letters into falling star-glyphs, and reveal the readable letter at the end.

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

`src/styles.css` controls the paper interface, layout, keyboard, modal, gallery, reading panel, and final reveal transition.

`src/app.js` contains state management, encryption, local storage, sharing, Web Audio, the Matter.js gallery, and the p5.js WEBGL cinematic reveal.

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

The unlock scene is a cinematic p5.js WEBGL stage. It is designed around this emotional sequence:

1. Warm darkness and a sealed floating envelope.
2. The envelope opens after the correct key.
3. A brief burst of soft pink rose particles explodes outward like compressed memories.
4. The warm bloom dissolves and collapses downward into deep blue cosmic water.
5. The writer's typed characters become falling star-glyphs.
6. Star-glyphs hit the water, create ripples, bend reflections, and trigger delicate chimes.
7. Motion slows into silence.
8. A small white boat appears on the water and transforms into paper.
9. The letter becomes fully readable at the end.

The side reading panel stays hidden during the cinematic reveal and fades in only after the final paper moment, so early typography behaves as living motion instead of static UI text.

## 7. Text As Living Particles

The reveal does not use a sample letter. It reads characters from the decrypted user message:

```js
const glyphSource = [...`${plaintext.title || ""} ${plaintext.message || ""}`]
  .filter((char) => char.trim());
```

Those characters become `glyphStars`. Some falling stars draw the actual letters; others draw pure star shapes. Each glyph has:

- sky start position;
- water impact position;
- fall duration;
- sway and spin;
- reflected position;
- impact state for ripple and sound triggering.

The early scene prioritizes emotional motion. Full readability is intentionally delayed until the final boat-to-paper transformation and the reading panel fade-in.

## 8. Water And Reflections

The WEBGL canvas uses a shader for the galaxy and water atmosphere:

- upper warmth fades into darkness;
- the lower half becomes indigo cosmic water;
- procedural stars appear in the distance;
- moving wave terms create subtle water motion.

Foreground particles are rendered into a transparent p5 graphics buffer and composited over the WEBGL shader. Water impacts create ripple objects. Reflections are mirrored and displaced by both soft wave motion and nearby ripple influence, so falling letters appear to bend when they touch the water.

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
2. Use CSS for paper, layout, accessibility, and final panel transitions.
3. Encrypt the user's letter with Web Crypto before saving.
4. Use Matter.js for the writer's physical envelope gallery.
5. Start a p5.js WEBGL canvas after successful unlock.
6. Draw the galaxy and water atmosphere with a shader.
7. Render particles, glyphs, ripples, reflections, boat, and paper into a transparent graphics buffer.
8. Composite the buffer over the shader.
9. Trigger Web Audio chimes from unlock and water impacts.
10. Reveal the stable readable message only at the final stage.
