# Interactive Generative Letter App

## 1. Purpose

This project is a reusable person-to-person digital letter app. A writer creates their own message, seals it with an access key, stores the encrypted envelope in their local gallery, and shares the encrypted link with the recipient. The app does not generate or invent the emotional letter content. The animation uses the writer's typed words after the recipient unlocks the envelope.

The app has three phases:

1. Write: collect the recipient, title, access key, key prompt, and message.
2. Gallery: show the writer's own encrypted letters as hanging envelopes.
3. Galaxy River Letter: unlock the envelope, bloom a sapphire lace rose, let the real words fall as stardust rain, carry them through a boat/airplane/bird journey, and settle into a readable delivered letter.

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

`src/app.js` contains state management, encryption, local storage, sharing, Web Audio, the Matter.js gallery, and the p5.js story-based river reveal.

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

The unlock scene is now a longer story-based canvas stage. It is designed around this sequence:

1. The envelope opens after the correct key.
2. A translucent sapphire-blue lace rose unfolds from a bud into bloom.
3. Line-art butterflies emerge from the petals and spiral outward.
4. The scene opens into a midnight-blue word-rain gallery.
5. Real characters from the recipient, title, and message fall as stardust typography with moon/star details and glass-like rain threads.
6. The falling characters touch the water, create glowing ripples, and build a connected memory network.
7. A white origami boat crosses the water and trembles with nearby ripples.
8. The boat folds into a paper airplane, lifts the glowing memories upward, and shifts the palette toward pale gold dawn.
9. The lifted particles become origami birds moving through a music-sheet cityscape toward "Destination of Love".
10. The airplane unfolds into a final letter, where the words bounce into place and remain readable.

The side reading panel stays hidden during the cinematic sequence, then becomes available at the end so the complete letter can be read comfortably.

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

Those characters become `wordDrops` in the story canvas. Each visible character has:

- a stardust rain start position;
- a water impact point;
- a staggered fall time and duration;
- a glass-like rain thread;
- moon, star, and particle accents;
- an impact state that spawns ripples and chime feedback;
- a later lifted-memory state when the airplane pulls the letters upward.

The final letter layout is rebuilt separately so the message returns to a readable form after the journey.

## 8. River, Folding, And Delivery

The river reveal uses several coordinated layers:

- warm blue and pale-gold cosmic atmosphere;
- translucent sapphire lace rose and butterfly line art;
- water ripples created by actual letter-character impacts;
- a small origami boat that morphs into a paper airplane;
- lifted particles and origami birds;
- a final canvas letter plus a stable readable side panel.

The goal is not a short reveal trick. The river phase is a miniature delivery story that ends with the recipient able to read the full letter.

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
5. Start a p5.js story canvas after successful unlock.
6. Build sapphire rose, butterfly, word-rain, ripple, boat, airplane, bird, and final-letter stages.
7. Use real letter characters as the falling typography material.
8. Keep the side reading panel hidden during the story and reveal it at the end.
9. Trigger Web Audio chimes from unlock and water impacts.
10. Leave the complete delivered letter readable after the animation settles.

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
