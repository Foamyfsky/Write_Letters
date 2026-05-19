# Interactive Generative Letter App

## 1. Purpose

This project is a private digital letter-writing app for person-to-person messages. A writer creates a letter, seals it with an access key, stores it in their own local gallery, and shares an encrypted link. A recipient unlocks the letter with the key and sees the sealed message bloom into a particle animation before settling into readable text.

The app has three phases:

1. Typewriter interface: collect the message with tactile visual and audio feedback.
2. Wind chime gallery: display encrypted letters as draggable hanging envelopes owned by this browser.
3. Blooming Letter: open an envelope with the key, burst a neutral bouquet from the seal, and rebuild the actual letter text with particles.

The plaintext letter is never saved to browser storage. Saved and shared letters contain encrypted data only.

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

`index.html` defines the three application phases and loads `p5.js`, `Matter.js`, the stylesheet, and the app logic.

`src/styles.css` controls the paper interface, layout, keyboard, modal, gallery, reading panel, and responsive presentation.

`src/app.js` contains state management, encryption, local storage, sharing, audio feedback, the Matter.js gallery, and the p5.js text-particle reveal.

## 3. Data And Privacy Model

The core plaintext data is:

```js
{
  recipient,
  title,
  message,
  createdAt
}
```

Before saving, the app encrypts this object in the browser:

1. The user enters an access key.
2. PBKDF2 derives an AES key from the access key and a random salt.
3. AES-GCM encrypts the plaintext letter.
4. The encrypted record is saved to `localStorage`.

The saved record contains display metadata plus encrypted content:

```js
{
  id,
  title,
  recipient,
  keyPrompt,
  createdAt,
  accent,
  crypto: {
    v,
    alg,
    kdf,
    hash,
    iterations,
    salt,
    iv,
    data
  }
}
```

The access key is not stored. The shared URL places the encrypted record in the URL fragment after `#open=...`. URL fragments are not sent to a web server during normal HTTP requests. The recipient still needs the access key to decrypt the letter.

Important limitation: this is client-side privacy, not account security. Anyone with both the encrypted link and the correct key can open the letter. For production use, add authenticated accounts, server-side access controls, rate limiting, and audited key handling.

## 4. Phase 1: Typewriter Interface

The typewriter stage uses native HTML inputs so writing remains accessible, selectable, and mobile-friendly.

Main parts:

- `textarea`: stores the draft message, currently up to 5,200 characters.
- Virtual keyboard: inserts characters into the textarea.
- Web Audio API: generates short mechanical clicks and occasional crystalline chime tones.
- CSS animation: makes typed glyphs float and fade above the paper preview.

The typing sound is procedural. Each key press creates a short noise buffer, filters it with a bandpass filter, and shapes it with a gain envelope. Every few keystrokes, a quiet sine-wave chime is layered above the click, giving the feeling of wind chimes or tiny stars without loading audio files.

## 5. Phase 2: Matter.js Wind Chime Gallery

Matter.js provides a 2D physics simulation. p5.js draws the gallery.

The gallery uses these Matter.js concepts:

- `Engine`: advances the physics simulation.
- `World`: contains all bodies and constraints.
- `Bodies.rectangle`: creates each envelope.
- Static bodies: form the floor and side walls.
- `Constraint`: connects an envelope to an anchor point.
- `MouseConstraint`: lets the user drag and toss envelopes.

Each encrypted letter becomes a hanging envelope. Gravity pulls it down, the constraint acts like a string, damping removes excess motion, and collisions keep envelopes from passing through each other. This supports the person-to-person mechanism: the writer's gallery is built from letters they personally wrote and sealed.

## 6. Phase 3: Blooming Letter

The unlock scene uses p5.js. It is designed so the animation belongs to the actual letter, not to a generic star background.

### Text Sampling

The app creates an offscreen p5 graphics buffer:

1. Build a text block from the recipient, title, and message.
2. Draw that text into a hidden `createGraphics()` buffer.
3. Call `loadPixels()` on the hidden buffer.
4. Store the coordinates of visible text pixels.
5. Convert those coordinates into particle targets.

Those target points preserve the shape of the typed words. Some moving particles also draw real glyphs from the letter text, so the message appears as both readable language and luminous motion.

Long letters remain fully readable in the paper panel. The canvas reveal samples as much text as can fit gracefully; if the canvas text block is trimmed, the full unlocked letter still appears in the reading panel.

### Unlock Bouquet

When the envelope opens, the wax seal becomes the origin point for a neutral floral burst:

- rose-like blooms grow from the seal using procedural p5 shapes;
- muted reds, blush tones, cream, and green stems match the existing paper and blue-night palette;
- drifting petals and lock rays create the burst without making the effect exclusively romantic.

No image asset or paid service is required. The bouquet is drawn with circles, ellipses, lines, alpha, easing, and shadow blur.

### Particle Motion

The letter particles use arrival steering:

1. Compute the vector from the particle to its text target.
2. Convert that vector into a desired velocity.
3. Subtract the current velocity to get a steering force.
4. Add a small noise-based flow-field force.
5. Slow the particle near the target so it settles instead of overshooting.

The noise field makes the motion feel airy and organic. The arrival force makes the particles eventually stabilize into the sampled letter.

The major reveal stages use elapsed time instead of raw frame counts. That keeps the unlock, bouquet, particle formation, and stable reading state moving at the intended pace even if a browser slows animation frames in the background.

### Stable Reading State

During the first seconds, the paper panel is slightly blurred and dimmed. After the bloom and particle reveal, the panel becomes fully readable. This keeps the opening ritual connected to the final letter instead of showing a separate animation beside an already-finished message.

## 7. Web Audio

The app uses the Web Audio API directly:

- typing click: short filtered noise burst;
- typing shimmer: occasional high sine tone;
- unlock bloom: small cascade of sine tones plus a high-passed shimmer burst.

This keeps the app free and self-contained. Browser autoplay policies may require the sound to begin only after a user gesture such as typing, clicking, or unlocking.

## 8. Future Theme System

The next expansion can add user-selectable regimes without paid AI APIs. A free version can use structured options and keyword matching:

```js
const themes = {
  birthday: {
    palette: ["#ffd166", "#ef476f", "#ffffff"],
    motion: "burst",
    sound: "bright-chime",
    shapes: ["spark", "confetti", "dot"]
  },
  farewell: {
    palette: ["#d8dee9", "#8f9aa7", "#ffffff"],
    motion: "slow-rise",
    sound: "soft-bell",
    shapes: ["light", "petal", "dot"]
  },
  childhoodFriend: {
    palette: ["#f7c59f", "#70d6ff", "#ffffff"],
    motion: "playful-orbit",
    sound: "music-box",
    shapes: ["spark", "paper-plane", "dot"]
  }
};
```

Users can choose relationship, occasion, mood, and animation intensity. Natural-language descriptions can be interpreted locally with keyword rules before any AI API is considered.

## 9. Build Tutorial

1. Create an HTML shell with compose, gallery, and reading sections.
2. Use CSS to make the interface feel like paper, ink, envelopes, and a quiet night stage.
3. Use native form fields for the actual writing experience.
4. Add procedural typing audio with Web Audio.
5. On submit, encrypt the plaintext letter with PBKDF2 and AES-GCM.
6. Save only the encrypted record in `localStorage`.
7. Use Matter.js to hang sealed envelopes in the writer's gallery.
8. On unlock, decrypt the letter in memory.
9. Draw the decrypted words into an offscreen p5 buffer.
10. Sample visible pixels from that buffer as particle destinations.
11. Emit particles and glyphs from the envelope seal.
12. Add a procedural bouquet burst from the same seal point.
13. Let particles settle into the sampled text.
14. Reveal the stable paper panel for full reading.

## 10. Production Hardening Checklist

For a hosted multi-user product, add:

- authenticated user accounts;
- server-side encrypted storage;
- per-letter permission lists;
- link expiration and revocation;
- rate limiting for unlock attempts;
- recovery flows for lost keys;
- content backup and export controls;
- accessibility testing with keyboard and screen readers;
- mobile performance testing on low-power devices.
