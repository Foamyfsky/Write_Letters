# Interactive Generative Art Messaging App

## 1. Purpose

This project is a private digital letter-writing app. A user writes a letter, seals it with an access key, sees it become a movable object in a physics gallery, and opens it as a generative particle animation.

The app has three phases:

1. Typewriter interface: collect the message with tactile visual and audio feedback.
2. Wind chime gallery: display encrypted letters as draggable hanging envelopes.
3. River of Stars: decrypt the selected letter and rebuild its text with particles.

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

`src/styles.css` controls the tactile paper interface, keyboard, modal, gallery layout, and responsive presentation.

`src/app.js` contains state management, encryption, local storage, sharing, audio feedback, the Matter.js gallery, and the p5.js river scene.

`docs/LEARNING_MATERIAL.md` explains how the project works.

## 3. Data And Privacy Model

The core data is the user's letter:

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

The saved record contains metadata for display plus encrypted content:

```js
{
  id,
  title,
  recipient,
  keyPrompt,
  createdAt,
  crypto: {
    alg: "AES-GCM",
    kdf: "PBKDF2",
    salt,
    iv,
    data
  }
}
```

The access key is not stored. The shared URL places the encrypted record in the URL fragment after `#open=...`. URL fragments are not sent to a web server during normal HTTP requests. The recipient still needs the access key to decrypt the letter.

Important limitation: this is client-side privacy, not identity-based account security. Anyone with both the encrypted link and the correct key can open the letter. For production use, add authenticated accounts, server-side access controls, rate limiting, and audited key handling.

## 4. Phase 1: Typewriter Interface

The typewriter stage uses normal HTML inputs instead of canvas. This keeps text entry accessible, selectable, and mobile-friendly.

Main parts:

- `textarea`: stores the draft message.
- Virtual keyboard: inserts characters into the textarea.
- Web Audio API: generates short randomized mechanical click sounds.
- CSS animation: makes typed glyphs float and fade.

The sound is generated instead of loaded from audio files. Each key press creates a short noise buffer, passes it through a bandpass filter, and applies a quick gain envelope. Random frequency and duration changes prevent the feedback from feeling repetitive.

The phase ends when the user selects `Seal letter`. At that point the message is encrypted and saved as an envelope record.

## 5. Phase 2: Matter.js Wind Chime Gallery

Matter.js provides a 2D physics simulation. p5.js draws the visual scene.

The gallery uses these Matter.js concepts:

- `Engine`: advances the physics simulation.
- `World`: contains all bodies and constraints.
- `Bodies.rectangle`: creates each envelope.
- Static bodies: form the floor and side walls.
- `Constraint`: connects an envelope to an anchor point.
- `MouseConstraint`: lets the user drag and toss envelopes.

Each letter is a dynamic rectangle. Each anchor point is fixed near the top of the canvas. A constraint connects the anchor to the envelope, creating a spring-like hanging motion.

Why the envelopes move as expected:

- Gravity pulls each envelope downward.
- The constraint resists stretching beyond its target length.
- Stiffness controls how strongly the string pulls back.
- Damping removes energy so the envelope settles instead of shaking forever.
- Collision resolution prevents envelopes from passing through each other.
- Mouse constraint temporarily attaches a body to the cursor, so dragging feels physical.

Opening a letter destroys the Matter.js scene before starting the particle scene. This releases the physics world and avoids running two animation systems at once.

## 6. Phase 3: p5.js River Of Stars

The river scene uses p5.js only. It converts text into particle destinations, then steers particles toward those positions.

### Text Sampling

The app creates an off-screen p5 graphics buffer:

1. Draw the decrypted title and message into the hidden buffer.
2. Read the buffer pixels with `loadPixels()`.
3. Store the coordinates of visible text pixels.
4. Limit the number of target points for performance.

Those coordinates become particle destinations.

### Particle Emitter

A paper boat moves across the screen with a sine-wave vertical motion. As it moves, it emits particles. Each new particle receives one target coordinate from the sampled text.

### Arrival Steering

Each particle uses steering behavior:

1. Compute the vector from current position to target.
2. Convert that vector into a desired velocity.
3. Subtract the current velocity to get a steering force.
4. Limit the steering force so motion remains smooth.
5. Reduce speed near the target so the particle arrives without overshooting.

This is called arrival behavior. It creates motion that feels intentional rather than linear or mechanical.

### Visual Treatment

The scene keeps a low-opacity blue overlay instead of fully clearing the canvas each frame. This leaves soft trails behind moving particles.

Particles vary in size and shape:

- small dots
- star shapes
- crescent moons

Gold, cream, and white colors make the text feel luminous against the blue river.

## 7. Efficiency Decisions

The project stays efficient by:

- using native DOM text input for writing;
- saving only encrypted payloads;
- capping rendered physics envelopes;
- destroying unused p5 and Matter.js scenes during phase transitions;
- limiting sampled particle targets;
- using one animation loop per active phase;
- generating audio clicks procedurally instead of loading many sound files.

## 8. Build Tutorial

1. Create the static HTML shell with three sections: compose, gallery, and river.
2. Add form fields for recipient, title, access key, key prompt, and message.
3. Add Web Audio API key feedback and CSS glyph animation.
4. On form submit, encrypt the plaintext letter with PBKDF2 and AES-GCM.
5. Store only the encrypted record in `localStorage`.
6. Build the gallery with Matter.js bodies, constraints, gravity, collisions, and mouse dragging.
7. When an envelope is selected, request the access key and decrypt in memory.
8. Destroy the physics sketch and start the p5.js river sketch.
9. Draw decrypted text into an off-screen buffer and sample visible pixel coordinates.
10. Emit particles from the moving boat and steer them toward the sampled text targets.
11. Keep the decrypted readable letter visible only after successful unlock.
12. Share letters by copying an encrypted URL fragment and sending the access key separately.

## 9. Production Hardening Checklist

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
