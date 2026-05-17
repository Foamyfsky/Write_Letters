(() => {
  "use strict";

  const STORE_KEY = "letters-in-motion:v1";
  const MAX_GALLERY_BODIES = 18;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const state = {
    letters: [],
    sharedRecord: null,
    sharedMode: false,
    selectedId: null,
    pendingUnlockId: null,
    unlocked: new Map(),
    gallerySketch: null,
    riverSketch: null,
    currentRiver: null,
    audioContext: null,
    toastTimer: 0,
  };

  const el = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    if (!window.crypto || !window.crypto.subtle) {
      el.composeStatus.textContent = "This browser cannot encrypt letters. Open the app on localhost or HTTPS.";
      disableForm();
      return;
    }

    state.letters = loadVault();
    state.sharedRecord = readSharedRecord();
    state.sharedMode = Boolean(state.sharedRecord);
    state.selectedId = getVisibleRecords()[0]?.id || null;

    buildKeyboard();
    bindEvents();
    renderAll();

    if (state.sharedMode) {
      showView("gallery");
      toast("Shared encrypted letter loaded. Enter the key to open it.");
    } else if (state.letters.length) {
      showView("gallery");
    } else {
      showView("compose");
    }
  }

  function cacheElements() {
    const $ = (selector) => document.querySelector(selector);
    el.composeView = $("#composeView");
    el.galleryView = $("#galleryView");
    el.riverView = $("#riverView");
    el.letterForm = $("#letterForm");
    el.recipientInput = $("#recipientInput");
    el.titleInput = $("#titleInput");
    el.accessKeyInput = $("#accessKeyInput");
    el.keyPromptInput = $("#keyPromptInput");
    el.messageInput = $("#messageInput");
    el.composeStatus = $("#composeStatus");
    el.clearDraftButton = $("#clearDraftButton");
    el.previewRecipient = $("#previewRecipient");
    el.previewTitle = $("#previewTitle");
    el.previewMessage = $("#previewMessage");
    el.floatingLetters = $("#floatingLetters");
    el.keyboard = $("#keyboard");
    el.galleryCanvas = $("#galleryCanvas");
    el.emptyGallery = $("#emptyGallery");
    el.letterList = $("#letterList");
    el.selectedLetter = $("#selectedLetter");
    el.copyLinkButton = $("#copyLinkButton");
    el.clearVaultButton = $("#clearVaultButton");
    el.vaultTitle = $("#vaultTitle");
    el.unlockModal = $("#unlockModal");
    el.unlockForm = $("#unlockForm");
    el.unlockTitle = $("#unlockTitle");
    el.unlockPrompt = $("#unlockPrompt");
    el.unlockKeyInput = $("#unlockKeyInput");
    el.unlockStatus = $("#unlockStatus");
    el.cancelUnlockButton = $("#cancelUnlockButton");
    el.toast = $("#toast");
    el.backToGalleryButton = $("#backToGalleryButton");
    el.replayRiverButton = $("#replayRiverButton");
    el.riverCanvas = $("#riverCanvas");
    el.riverRecipient = $("#riverRecipient");
    el.riverLetterTitle = $("#riverLetterTitle");
    el.riverLetterMessage = $("#riverLetterMessage");
    el.privacyPill = $("#privacyPill");
  }

  function disableForm() {
    [...el.letterForm.elements].forEach((element) => {
      element.disabled = true;
    });
  }

  function bindEvents() {
    document.querySelectorAll("[data-action='compose']").forEach((button) => {
      button.addEventListener("click", () => {
        state.sharedMode = false;
        history.replaceState(null, "", location.pathname + location.search);
        showView("compose");
      });
    });

    document.querySelectorAll("[data-action='gallery']").forEach((button) => {
      button.addEventListener("click", () => showView("gallery"));
    });

    el.letterForm.addEventListener("submit", handleSealLetter);
    el.clearDraftButton.addEventListener("click", clearDraft);
    el.copyLinkButton.addEventListener("click", copySelectedLink);
    el.clearVaultButton.addEventListener("click", clearVault);
    el.unlockForm.addEventListener("submit", handleUnlockSubmit);
    el.cancelUnlockButton.addEventListener("click", hideUnlockModal);
    el.backToGalleryButton.addEventListener("click", () => showView("gallery"));
    el.replayRiverButton.addEventListener("click", () => {
      if (state.currentRiver) startRiver(state.currentRiver.record, state.currentRiver.plaintext);
    });

    [el.recipientInput, el.titleInput, el.messageInput].forEach((input) => {
      input.addEventListener("input", updatePreview);
      input.addEventListener("keydown", handleTypingFeedback);
    });

    window.addEventListener("hashchange", () => {
      const shared = readSharedRecord();
      if (!shared) return;
      state.sharedRecord = shared;
      state.sharedMode = true;
      state.selectedId = shared.id;
      renderAll();
      showView("gallery");
    });
  }

  function showView(viewName) {
    const views = {
      compose: el.composeView,
      gallery: el.galleryView,
      river: el.riverView,
    };

    Object.entries(views).forEach(([name, node]) => {
      node.classList.toggle("is-active", name === viewName);
    });

    document.querySelectorAll(".tab-button").forEach((button) => {
      const action = button.dataset.action;
      button.classList.toggle("is-active", action === viewName || (viewName === "river" && action === "gallery"));
    });

    if (viewName === "gallery") {
      destroyRiverSketch();
      renderAll();
      requestAnimationFrame(initGallerySketch);
    }

    if (viewName === "compose") {
      destroyGallerySketch();
      destroyRiverSketch();
      updatePreview();
    }

    if (viewName === "river") {
      destroyGallerySketch();
    }
  }

  function renderAll() {
    const visibleRecords = getVisibleRecords();
    if (!state.selectedId && visibleRecords.length) {
      state.selectedId = visibleRecords[0].id;
    }

    el.privacyPill.textContent = state.sharedMode ? "Shared encrypted letter" : "Local encrypted vault";
    el.vaultTitle.textContent = state.sharedMode ? "Shared letter" : "Your letters";
    el.clearVaultButton.disabled = state.sharedMode || !state.letters.length;
    el.emptyGallery.classList.toggle("is-hidden", visibleRecords.length > 0);
    el.galleryCanvas.hidden = visibleRecords.length === 0;
    el.copyLinkButton.disabled = !getSelectedRecord();

    renderLetterList();
    renderSelectedLetter();
  }

  function getVisibleRecords() {
    return state.sharedMode && state.sharedRecord ? [state.sharedRecord] : state.letters;
  }

  function getSelectedRecord() {
    const records = getVisibleRecords();
    return records.find((record) => record.id === state.selectedId) || records[0] || null;
  }

  function renderLetterList() {
    el.letterList.replaceChildren();
    getVisibleRecords().forEach((record) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "letter-row";
      row.classList.toggle("is-selected", record.id === state.selectedId);
      row.addEventListener("click", () => {
        selectRecord(record.id);
      });

      const title = document.createElement("strong");
      title.textContent = record.title || "Untitled letter";
      const meta = document.createElement("span");
      meta.textContent = `For ${record.recipient || "someone"} - ${formatDate(record.createdAt)}`;

      row.append(title, meta);
      el.letterList.append(row);
    });
  }

  function renderSelectedLetter() {
    const record = getSelectedRecord();
    el.selectedLetter.replaceChildren();

    if (!record) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Select an envelope to unlock, share, or present it.";
      el.selectedLetter.append(empty);
      return;
    }

    const title = document.createElement("h3");
    title.textContent = record.title || "Untitled letter";

    const meta = document.createElement("div");
    meta.className = "selected-meta";
    const to = document.createElement("span");
    to.textContent = `Recipient: ${record.recipient || "Private"}`;
    const created = document.createElement("span");
    created.textContent = `Created: ${formatDate(record.createdAt)}`;
    const prompt = document.createElement("span");
    prompt.textContent = `Prompt: ${record.keyPrompt || "Access key required"}`;
    meta.append(to, created, prompt);

    const actions = document.createElement("div");
    actions.className = "form-actions";
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "primary-button";
    openButton.textContent = state.unlocked.has(record.id) ? "Present" : "Unlock";
    openButton.addEventListener("click", () => requestOpenRecord(record));

    const shareButton = document.createElement("button");
    shareButton.type = "button";
    shareButton.className = "quiet-button";
    shareButton.textContent = "Copy link";
    shareButton.addEventListener("click", () => copyLink(record));
    actions.append(openButton, shareButton);

    if (state.sharedMode) {
      const saveButton = document.createElement("button");
      saveButton.type = "button";
      saveButton.className = "quiet-button";
      saveButton.textContent = "Save encrypted copy";
      saveButton.addEventListener("click", () => saveSharedToVault(record));
      actions.append(saveButton);
    }

    el.selectedLetter.append(title, meta, actions);
  }

  function selectRecord(recordId) {
    state.selectedId = recordId;
    renderLetterList();
    renderSelectedLetter();
  }

  async function handleSealLetter(event) {
    event.preventDefault();
    const form = new FormData(el.letterForm);
    const draft = {
      recipient: cleanText(form.get("recipient")),
      title: cleanText(form.get("title")),
      accessKey: String(form.get("accessKey") || ""),
      keyPrompt: cleanText(form.get("keyPrompt")),
      message: String(form.get("message") || "").trim(),
    };

    if (!draft.recipient || !draft.title || !draft.message || draft.accessKey.trim().length < 3) {
      el.composeStatus.textContent = "Recipient, title, message, and a private key are required.";
      return;
    }

    el.composeStatus.textContent = "Sealing with browser encryption...";
    setFormBusy(true);

    try {
      const record = await encryptLetter(draft);
      upsertRecord(record);
      state.unlocked.set(record.id, {
        recipient: draft.recipient,
        title: draft.title,
        message: draft.message,
        createdAt: record.createdAt,
      });
      state.sharedMode = false;
      state.selectedId = record.id;
      el.accessKeyInput.value = "";
      saveVault();
      renderAll();
      showView("gallery");
      toast("Letter sealed. Share the link and send the key separately.");
      el.composeStatus.textContent = "";
    } catch (error) {
      console.error(error);
      el.composeStatus.textContent = "The letter could not be encrypted. Try again.";
    } finally {
      setFormBusy(false);
    }
  }

  function setFormBusy(isBusy) {
    [...el.letterForm.elements].forEach((element) => {
      if (element.id !== "clearDraftButton") element.disabled = isBusy;
    });
  }

  function clearDraft() {
    el.letterForm.reset();
    updatePreview();
    el.composeStatus.textContent = "";
  }

  function clearVault() {
    if (!state.letters.length || state.sharedMode) return;
    const ok = window.confirm("Delete all encrypted letters stored in this browser?");
    if (!ok) return;
    state.letters = [];
    state.unlocked.clear();
    state.selectedId = null;
    saveVault();
    destroyGallerySketch();
    renderAll();
    showView("compose");
    toast("Local encrypted vault cleared.");
  }

  function updatePreview() {
    const recipient = cleanText(el.recipientInput.value);
    const title = cleanText(el.titleInput.value);
    const message = el.messageInput.value.trim();
    el.previewRecipient.textContent = recipient ? `To ${recipient}` : "To someone beloved";
    el.previewTitle.textContent = title || "A little universe";
    el.previewMessage.textContent = message || "Your words will gather here as soft ink.";
  }

  function buildKeyboard() {
    const rows = ["QWERTYUIOP?", "ASDFGHJKL!", "ZXCVBNM,."];
    el.keyboard.replaceChildren();
    rows.forEach((rowText) => {
      const row = document.createElement("div");
      row.className = "keyboard-row";
      [...rowText].forEach((letter) => {
        row.append(createKeycap(letter, letter));
      });
      el.keyboard.append(row);
    });

    const commandRow = document.createElement("div");
    commandRow.className = "keyboard-row";
    commandRow.append(createKeycap("space", " ", true));
    commandRow.append(createKeycap("del", "Backspace", true));
    el.keyboard.append(commandRow);
  }

  function createKeycap(label, value, wide = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = wide ? "keycap keycap-wide" : "keycap";
    button.textContent = label;
    button.addEventListener("click", () => {
      focusMessageInput();
      if (value === "Backspace") {
        removeAtCursor(el.messageInput);
      } else {
        insertAtCursor(el.messageInput, value);
        spawnFloatingGlyph(value === " " ? "." : value);
      }
      playKeyClick();
      updatePreview();
      pulseKey(button);
    });
    return button;
  }

  function focusMessageInput() {
    el.messageInput.focus({ preventScroll: true });
  }

  function insertAtCursor(input, value) {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.value = `${input.value.slice(0, start)}${value}${input.value.slice(end)}`;
    const cursor = start + value.length;
    input.setSelectionRange(cursor, cursor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function removeAtCursor(input) {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    if (start !== end) {
      input.value = `${input.value.slice(0, start)}${input.value.slice(end)}`;
      input.setSelectionRange(start, start);
    } else if (start > 0) {
      input.value = `${input.value.slice(0, start - 1)}${input.value.slice(start)}`;
      input.setSelectionRange(start - 1, start - 1);
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function handleTypingFeedback(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length === 1 || event.key === "Backspace" || event.key === "Enter") {
      playKeyClick();
      if (event.key.length === 1) spawnFloatingGlyph(event.key);
      pulseMatchingKey(event.key);
    }
  }

  function pulseMatchingKey(key) {
    const label = key === " " ? "space" : key.toUpperCase();
    const keycap = [...el.keyboard.querySelectorAll(".keycap")].find((button) => {
      return button.textContent.toUpperCase() === label.toUpperCase();
    });
    if (keycap) pulseKey(keycap);
  }

  function pulseKey(button) {
    button.classList.add("is-active");
    window.setTimeout(() => button.classList.remove("is-active"), 130);
  }

  function spawnFloatingGlyph(glyph) {
    const span = document.createElement("span");
    span.className = "float-glyph";
    span.textContent = glyph;
    span.style.left = `${42 + Math.random() * 28}%`;
    span.style.top = `${38 + Math.random() * 28}%`;
    span.style.fontSize = `${18 + Math.random() * 12}px`;
    el.floatingLetters.append(span);
    window.setTimeout(() => span.remove(), 950);
  }

  function playKeyClick() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!state.audioContext) state.audioContext = new AudioContext();
    const context = state.audioContext;
    if (context.state === "suspended") context.resume();

    const now = context.currentTime;
    const duration = 0.045 + Math.random() * 0.025;
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * duration), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }

    const noise = context.createBufferSource();
    noise.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 900 + Math.random() * 700;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    noise.start(now);
    noise.stop(now + duration);
  }

  async function encryptLetter(draft) {
    const createdAt = new Date().toISOString();
    const id = window.crypto.randomUUID();
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = await deriveKey(draft.accessKey, salt);
    const plaintext = {
      recipient: draft.recipient,
      title: draft.title,
      message: draft.message,
      createdAt,
    };
    const cipherBuffer = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoder.encode(JSON.stringify(plaintext)),
    );

    return {
      id,
      title: draft.title,
      recipient: draft.recipient,
      keyPrompt: draft.keyPrompt || "What word or name opens this letter?",
      createdAt,
      accent: pickAccent(),
      crypto: {
        v: 1,
        alg: "AES-GCM",
        kdf: "PBKDF2",
        hash: "SHA-256",
        iterations: 180000,
        salt: bytesToBase64Url(salt),
        iv: bytesToBase64Url(iv),
        data: bytesToBase64Url(new Uint8Array(cipherBuffer)),
      },
    };
  }

  async function decryptLetter(record, accessKey) {
    const cryptoData = record.crypto;
    const salt = base64UrlToBytes(cryptoData.salt);
    const iv = base64UrlToBytes(cryptoData.iv);
    const cipherBytes = base64UrlToBytes(cryptoData.data);
    const key = await deriveKey(accessKey, salt, cryptoData.iterations);
    const plainBuffer = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      cipherBytes,
    );
    return JSON.parse(decoder.decode(plainBuffer));
  }

  async function deriveKey(accessKey, salt, iterations = 180000) {
    const normalized = String(accessKey || "").normalize("NFKC").trim();
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      encoder.encode(normalized),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  function randomBytes(length) {
    const bytes = new Uint8Array(length);
    window.crypto.getRandomValues(bytes);
    return bytes;
  }

  function pickAccent() {
    const accents = ["#9d2d28", "#2057bb", "#f4c845", "#17211d"];
    return accents[Math.floor(Math.random() * accents.length)];
  }

  function upsertRecord(record) {
    const existingIndex = state.letters.findIndex((item) => item.id === record.id);
    if (existingIndex >= 0) {
      state.letters[existingIndex] = record;
    } else {
      state.letters.unshift(record);
    }
  }

  function saveSharedToVault(record) {
    upsertRecord(record);
    saveVault();
    toast("Encrypted copy saved to this browser.");
  }

  function loadVault() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
      return Array.isArray(saved) ? saved.filter(isValidRecord) : [];
    } catch {
      return [];
    }
  }

  function saveVault() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.letters));
  }

  function isValidRecord(record) {
    return Boolean(record && record.id && record.crypto && record.crypto.data && record.crypto.iv && record.crypto.salt);
  }

  function readSharedRecord() {
    const hash = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
    if (!hash) return null;
    const params = new URLSearchParams(hash);
    const packed = params.get("open");
    if (!packed) return null;
    try {
      const record = JSON.parse(base64UrlToString(packed));
      return isValidRecord(record) ? record : null;
    } catch {
      return null;
    }
  }

  function buildShareUrl(record) {
    const packed = stringToBase64Url(JSON.stringify(record));
    return `${location.origin}${location.pathname}${location.search}#open=${packed}`;
  }

  async function copySelectedLink() {
    const record = getSelectedRecord();
    if (record) await copyLink(record);
  }

  async function copyLink(record) {
    const url = buildShareUrl(record);
    try {
      await navigator.clipboard.writeText(url);
      toast("Secure link copied. Send the access key separately.");
    } catch {
      window.prompt("Copy this secure link", url);
    }
  }

  function requestOpenRecord(record) {
    selectRecord(record.id);
    const unlocked = state.unlocked.get(record.id);
    if (unlocked) {
      startRiver(record, unlocked);
      return;
    }
    showUnlockModal(record);
  }

  function showUnlockModal(record) {
    state.pendingUnlockId = record.id;
    el.unlockTitle.textContent = record.title || "Unlock letter";
    el.unlockPrompt.textContent = record.keyPrompt || "Access key required";
    el.unlockStatus.textContent = "";
    el.unlockKeyInput.value = "";
    el.unlockModal.classList.add("is-visible");
    el.unlockModal.setAttribute("aria-hidden", "false");
    window.setTimeout(() => el.unlockKeyInput.focus(), 0);
  }

  function hideUnlockModal() {
    state.pendingUnlockId = null;
    el.unlockModal.classList.remove("is-visible");
    el.unlockModal.setAttribute("aria-hidden", "true");
    el.unlockStatus.textContent = "";
  }

  async function handleUnlockSubmit(event) {
    event.preventDefault();
    const record = getVisibleRecords().find((item) => item.id === state.pendingUnlockId);
    if (!record) return;

    el.unlockStatus.textContent = "Checking key...";
    try {
      const plaintext = await decryptLetter(record, el.unlockKeyInput.value);
      state.unlocked.set(record.id, plaintext);
      hideUnlockModal();
      startRiver(record, plaintext);
    } catch {
      el.unlockStatus.textContent = "That key did not open the letter.";
    }
  }

  function initGallerySketch() {
    const records = getVisibleRecords();
    if (!el.galleryView.classList.contains("is-active") || records.length === 0) return;
    destroyGallerySketch();
    state.gallerySketch = createGallerySketch(records.slice(0, MAX_GALLERY_BODIES));
  }

  function destroyGallerySketch() {
    if (!state.gallerySketch) return;
    if (typeof state.gallerySketch.cleanup === "function") state.gallerySketch.cleanup();
    state.gallerySketch.remove();
    state.gallerySketch = null;
  }

  function createGallerySketch(records) {
    return new window.p5((p) => {
      const {
        Engine,
        World,
        Bodies,
        Constraint,
        Mouse,
        MouseConstraint,
        Query,
      } = window.Matter;
      let canvas;
      let engine;
      let world;
      let mouseConstraint;
      let letterItems = [];
      let stringItems = [];
      let pressed = null;

      p.setup = () => {
        p.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
        canvas = p.createCanvas(el.galleryCanvas.clientWidth, el.galleryCanvas.clientHeight);
        canvas.parent(el.galleryCanvas);
        p.textFont("Georgia");
        buildWorld();
      };

      p.draw = () => {
        p.background(186, 202, 196);
        drawPaperTexture();
        Engine.update(engine, 1000 / 60);
        drawFlower();
        drawStrings();
        drawLetters();
        drawInstruction();
      };

      p.windowResized = () => {
        const width = Math.max(320, el.galleryCanvas.clientWidth);
        const height = Math.max(420, el.galleryCanvas.clientHeight);
        p.resizeCanvas(width, height);
        buildWorld();
      };

      p.mousePressed = () => {
        const hit = Query.point(
          letterItems.map((item) => item.body),
          { x: p.mouseX, y: p.mouseY },
        )[0];
        if (!hit) return;
        const item = letterItems.find((entry) => entry.body === hit);
        if (!item) return;
        pressed = { id: item.record.id, x: p.mouseX, y: p.mouseY, time: p.millis() };
        selectRecord(item.record.id);
      };

      p.mouseReleased = () => {
        if (!pressed) return;
        const distance = p.dist(pressed.x, pressed.y, p.mouseX, p.mouseY);
        const elapsed = p.millis() - pressed.time;
        const record = records.find((item) => item.id === pressed.id);
        pressed = null;
        if (record && distance < 10 && elapsed < 380) requestOpenRecord(record);
      };

      p.cleanup = () => {
        if (world) World.clear(world, false);
        if (engine) Engine.clear(engine);
      };

      function buildWorld() {
        if (world) World.clear(world, false);
        if (engine) Engine.clear(engine);
        engine = Engine.create();
        world = engine.world;
        engine.gravity.y = 0.62;
        letterItems = [];
        stringItems = [];

        const walls = [
          Bodies.rectangle(p.width / 2, p.height + 28, p.width + 80, 54, { isStatic: true }),
          Bodies.rectangle(-28, p.height / 2, 54, p.height, { isStatic: true }),
          Bodies.rectangle(p.width + 28, p.height / 2, 54, p.height, { isStatic: true }),
        ];
        World.add(world, walls);

        records.forEach((record, index) => {
          const spread = records.length === 1 ? 0.5 : index / (records.length - 1);
          const anchorX = p.lerp(p.width * 0.17, p.width * 0.83, spread);
          const anchorY = 86 + Math.sin(index * 1.7) * 18;
          const width = 118;
          const height = 74;
          const body = Bodies.rectangle(
            anchorX + p.random(-26, 26),
            230 + (index % 4) * 24,
            width,
            height,
            {
              chamfer: { radius: 6 },
              frictionAir: 0.035,
              restitution: 0.22,
              density: 0.002,
            },
          );
          body.letterId = record.id;

          const string = Constraint.create({
            pointA: { x: anchorX, y: anchorY },
            bodyB: body,
            pointB: { x: 0, y: -height / 2 },
            length: 150 + (index % 5) * 18,
            stiffness: 0.006,
            damping: 0.08,
          });

          letterItems.push({ body, record, width, height, anchorX, anchorY });
          stringItems.push(string);
          World.add(world, [body, string]);
        });

        const mouse = Mouse.create(canvas.elt);
        mouse.pixelRatio = p.pixelDensity();
        mouseConstraint = MouseConstraint.create(engine, {
          mouse,
          constraint: {
            stiffness: 0.09,
            damping: 0.18,
            render: { visible: false },
          },
        });
        World.add(world, mouseConstraint);
      }

      function drawPaperTexture() {
        p.noStroke();
        for (let i = 0; i < 70; i += 1) {
          const alpha = i % 2 === 0 ? 10 : 6;
          p.fill(255, 248, 232, alpha);
          p.rect(p.random(p.width), p.random(p.height), p.random(18, 70), 1);
        }
        p.stroke(23, 33, 29, 18);
        p.strokeWeight(1);
        for (let x = 24; x < p.width; x += 58) {
          p.line(x, 0, x + p.random(-18, 18), p.height);
        }
      }

      function drawFlower() {
        p.push();
        p.translate(p.width / 2, 4);
        p.noStroke();
        const petals = [
          [-150, 25, -0.35, 120, 70, "#5c1514"],
          [-70, 18, -0.08, 150, 88, "#8e2521"],
          [0, 26, 0, 120, 128, "#b33a31"],
          [74, 18, 0.1, 150, 86, "#8e2521"],
          [150, 25, 0.35, 120, 70, "#5c1514"],
        ];
        petals.forEach(([x, y, angle, width, height, color]) => {
          p.push();
          p.translate(x, y);
          p.rotate(angle);
          p.fill(color);
          p.ellipse(0, 0, width, height);
          p.stroke(255, 248, 232, 24);
          p.line(-width * 0.25, 0, width * 0.24, 0);
          p.pop();
        });
        p.pop();

        p.noStroke();
        p.fill(92, 21, 20, 180);
        stringItems.forEach((string) => {
          p.circle(string.pointA.x, string.pointA.y, 8);
        });
      }

      function drawStrings() {
        p.noFill();
        stringItems.forEach((string) => {
          const end = string.bodyB.position;
          const start = string.pointA;
          p.stroke(23, 33, 29, 150);
          p.strokeWeight(1.15);
          p.line(start.x, start.y, end.x, end.y - 36);
        });
      }

      function drawLetters() {
        letterItems.forEach((item) => {
          const { body, record, width, height } = item;
          const selected = record.id === state.selectedId;
          p.push();
          p.translate(body.position.x, body.position.y);
          p.rotate(body.angle);
          p.rectMode(p.CENTER);
          p.noStroke();
          p.fill(0, 0, 0, 22);
          p.rect(4, 6, width, height, 6);
          p.fill(255, 246, 217);
          p.rect(0, 0, width, height, 6);
          p.stroke(selected ? p.color(157, 45, 40) : p.color(120, 96, 62, 100));
          p.strokeWeight(selected ? 2.5 : 1);
          p.noFill();
          p.rect(0, 0, width, height, 6);
          p.stroke(120, 96, 62, 110);
          p.line(-width / 2, -height / 2, 0, 8);
          p.line(width / 2, -height / 2, 0, 8);
          p.line(-width / 2, height / 2, -8, 4);
          p.line(width / 2, height / 2, 8, 4);
          p.noStroke();
          p.fill(record.accent || "#9d2d28");
          p.circle(0, 8, 18);
          p.fill(23, 33, 29);
          p.textAlign(p.CENTER, p.CENTER);
          p.textSize(12);
          p.text(truncate(record.recipient || "Private", 16), 0, -17, width - 18);
          p.textSize(10);
          p.fill(69, 81, 75);
          p.text(truncate(record.title || "Untitled", 20), 0, 27, width - 18);
          p.pop();
        });
      }

      function drawInstruction() {
        p.noStroke();
        p.fill(23, 33, 29, 170);
        p.textAlign(p.CENTER, p.BOTTOM);
        p.textSize(13);
        p.text("Drag the envelopes. Click one to open with its key.", p.width / 2, p.height - 18);
      }
    }, el.galleryCanvas);
  }

  function startRiver(record, plaintext) {
    state.currentRiver = { record, plaintext };
    renderRiverLetter(plaintext);
    showView("river");
    destroyRiverSketch();
    state.riverSketch = createRiverSketch(plaintext);
  }

  function renderRiverLetter(plaintext) {
    el.riverRecipient.textContent = plaintext.recipient ? `To ${plaintext.recipient}` : "";
    el.riverLetterTitle.textContent = plaintext.title || "Untitled letter";
    el.riverLetterMessage.textContent = plaintext.message || "";
  }

  function destroyRiverSketch() {
    if (!state.riverSketch) return;
    state.riverSketch.remove();
    state.riverSketch = null;
  }

  function createRiverSketch(plaintext) {
    return new window.p5((p) => {
      let targets = [];
      let particles = [];
      let spawnIndex = 0;
      let boatX = -80;
      let boatY = 0;
      let frameStarted = false;
      const palette = ["#f6d34d", "#fff8b8", "#f4c845", "#ffffff"];

      p.setup = () => {
        p.pixelDensity(1);
        const canvas = p.createCanvas(
          Math.max(320, el.riverCanvas.clientWidth),
          Math.max(440, el.riverCanvas.clientHeight),
        );
        canvas.parent(el.riverCanvas);
        p.colorMode(p.RGB);
        p.textFont("Georgia");
        rebuildTargets();
        resetParticles();
      };

      p.draw = () => {
        if (!frameStarted) {
          p.background(32, 87, 187);
          frameStarted = true;
        }
        p.noStroke();
        p.fill(9, 42, 114, 34);
        p.rect(0, 0, p.width, p.height);
        drawRiverLines();
        moveBoat();
        spawnParticles();
        particles.forEach((particle) => {
          particle.update();
          particle.draw();
        });
        drawBoat();
      };

      p.windowResized = () => {
        const width = Math.max(320, el.riverCanvas.clientWidth);
        const height = Math.max(440, el.riverCanvas.clientHeight);
        p.resizeCanvas(width, height);
        rebuildTargets();
        resetParticles();
      };

      function rebuildTargets() {
        const g = p.createGraphics(p.width, p.height);
        g.pixelDensity(1);
        g.clear();
        g.textFont("Georgia");
        g.noStroke();
        g.fill(255);

        const textBlock = buildTextBlock(g, plaintext);
        const startY = Math.max(80, (p.height - textBlock.lines.length * textBlock.leading) / 2);
        g.textSize(textBlock.size);
        g.textLeading(textBlock.leading);
        g.textAlign(p.LEFT, p.TOP);
        textBlock.lines.forEach((line, index) => {
          g.text(line, textBlock.x, startY + index * textBlock.leading);
        });

        g.loadPixels();
        targets = [];
        const step = p.width < 680 ? 5 : 6;
        for (let y = 0; y < g.height; y += step) {
          for (let x = 0; x < g.width; x += step) {
            const alpha = g.pixels[(y * g.width + x) * 4 + 3];
            if (alpha > 36) targets.push({ x, y });
          }
        }
        shuffle(targets);
        const maxTargets = p.width < 680 ? 950 : 1750;
        targets = targets.slice(0, maxTargets);
        g.remove();
      }

      function buildTextBlock(g, letter) {
        const maxWidth = p.width * 0.76;
        const maxHeight = p.height * 0.72;
        const source = [letter.title, "", letter.message].join("\n");
        let size = Math.min(42, Math.max(19, p.width / 24));
        let lines = [];
        let leading = size * 1.38;

        while (size >= 14) {
          g.textSize(size);
          lines = [];
          source.split("\n").forEach((paragraph) => {
            if (!paragraph.trim()) {
              lines.push("");
            } else {
              lines.push(...wrapParagraph(g, paragraph.trim(), maxWidth));
            }
          });
          leading = size * 1.38;
          if (lines.length * leading <= maxHeight) break;
          size -= 2;
        }

        return {
          x: (p.width - maxWidth) / 2,
          size,
          leading,
          lines,
        };
      }

      function wrapParagraph(g, paragraph, maxWidth) {
        const hasSpaces = /\s/.test(paragraph);
        const tokens = hasSpaces ? paragraph.split(/\s+/) : [...paragraph];
        const lines = [];
        let line = "";
        tokens.forEach((token) => {
          const next = hasSpaces ? `${line}${line ? " " : ""}${token}` : `${line}${token}`;
          if (g.textWidth(next) <= maxWidth || !line) {
            line = next;
          } else {
            lines.push(line);
            line = token;
          }
        });
        if (line) lines.push(line);
        return lines;
      }

      function resetParticles() {
        particles = [];
        spawnIndex = 0;
        boatX = -80;
        frameStarted = false;
      }

      function moveBoat() {
        boatX += Math.max(1.2, p.width / 520);
        if (boatX > p.width + 90 && spawnIndex >= targets.length) {
          boatX = p.width + 90;
        } else if (boatX > p.width + 90) {
          boatX = -80;
        }
        boatY = p.height * 0.68 + Math.sin(p.frameCount * 0.025) * 24;
      }

      function spawnParticles() {
        const rate = Math.max(3, Math.ceil(targets.length / 360));
        for (let i = 0; i < rate && spawnIndex < targets.length; i += 1) {
          const target = targets[spawnIndex];
          particles.push(new StarParticle(boatX + p.random(-10, 18), boatY + p.random(-8, 8), target));
          spawnIndex += 1;
        }
      }

      function drawRiverLines() {
        p.noFill();
        p.stroke(255, 248, 232, 48);
        p.strokeWeight(1);
        for (let i = 0; i < 8; i += 1) {
          const x = p.map(i, 0, 7, p.width * 0.12, p.width * 0.88);
          p.beginShape();
          for (let y = 80; y < p.height - 30; y += 40) {
            p.curveVertex(x + Math.sin(y * 0.015 + i) * 18, y);
          }
          p.endShape();
        }
      }

      function drawBoat() {
        p.push();
        p.translate(boatX, boatY);
        p.noStroke();
        p.fill(255, 248, 232, 230);
        p.beginShape();
        p.vertex(-32, -4);
        p.vertex(34, -4);
        p.vertex(18, 17);
        p.vertex(-18, 17);
        p.endShape(p.CLOSE);
        p.fill(220, 230, 242, 230);
        p.triangle(-28, -4, -3, -29, 4, -4);
        p.triangle(5, -4, 26, -24, 30, -4);
        p.stroke(255, 248, 232, 120);
        p.line(34, 2, 80, -18);
        p.pop();
      }

      class StarParticle {
        constructor(x, y, target) {
          this.pos = p.createVector(x, y);
          this.vel = p.createVector(p.random(0.4, 2.4), p.random(-1.4, 1.4));
          this.acc = p.createVector(0, 0);
          this.target = p.createVector(target.x, target.y);
          this.size = p.random(2.2, 5.6);
          this.maxSpeed = p.random(3.4, 5.2);
          this.maxForce = p.random(0.12, 0.22);
          this.color = palette[Math.floor(p.random(palette.length))];
          this.kind = p.random() > 0.72 ? "moon" : p.random() > 0.5 ? "star" : "dot";
        }

        update() {
          const desired = window.p5.Vector.sub(this.target, this.pos);
          const distance = desired.mag();
          let speed = this.maxSpeed;
          if (distance < 86) speed = p.map(distance, 0, 86, 0.05, this.maxSpeed);
          desired.setMag(speed);
          const steer = window.p5.Vector.sub(desired, this.vel);
          steer.limit(this.maxForce);
          this.acc.add(steer);
          this.vel.add(this.acc);
          this.vel.mult(distance < 28 ? 0.88 : 0.985);
          this.pos.add(this.vel);
          this.acc.mult(0);
          if (distance < 1.2) {
            this.pos.lerp(this.target, 0.4);
            this.vel.mult(0);
          }
        }

        draw() {
          const ctx = p.drawingContext;
          ctx.save();
          ctx.shadowBlur = 14;
          ctx.shadowColor = "rgba(246, 211, 77, 0.75)";
          p.noStroke();
          p.fill(this.color);
          if (this.kind === "moon") {
            p.circle(this.pos.x, this.pos.y, this.size * 2.5);
            p.fill(32, 87, 187, 230);
            p.circle(this.pos.x + this.size * 0.65, this.pos.y - this.size * 0.2, this.size * 2.2);
          } else if (this.kind === "star") {
            drawStar(this.pos.x, this.pos.y, this.size * 0.55, this.size * 1.45, 5);
          } else {
            p.circle(this.pos.x, this.pos.y, this.size);
          }
          ctx.restore();
        }
      }

      function drawStar(x, y, innerRadius, outerRadius, points) {
        p.beginShape();
        for (let i = 0; i < points * 2; i += 1) {
          const angle = -p.HALF_PI + (i * p.PI) / points;
          const radius = i % 2 === 0 ? outerRadius : innerRadius;
          p.vertex(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
        }
        p.endShape(p.CLOSE);
      }
    }, el.riverCanvas);
  }

  function bytesToBase64Url(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64UrlToBytes(value) {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function stringToBase64Url(value) {
    return bytesToBase64Url(encoder.encode(value));
  }

  function base64UrlToString(value) {
    return decoder.decode(base64UrlToBytes(value));
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function formatDate(value) {
    const date = value ? new Date(value) : new Date();
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function truncate(value, maxLength) {
    const text = String(value || "");
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
  }

  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  function toast(message) {
    window.clearTimeout(state.toastTimer);
    el.toast.textContent = message;
    el.toast.classList.add("is-visible");
    state.toastTimer = window.setTimeout(() => {
      el.toast.classList.remove("is-visible");
    }, 3200);
  }
})();
