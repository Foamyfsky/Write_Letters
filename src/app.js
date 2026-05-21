(() => {
  "use strict";

  const STORE_KEY = "letters-in-motion:v1";
  const MAX_GALLERY_BODIES = 18;
  const MAX_MESSAGE_LENGTH = 5200;
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
    audioNeedsGesture: false,
    keySoundCounter: 0,
    toastTimer: 0,
    revealTimer: 0,
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
    el.riverLetter = $("#riverLetter");
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
    document.addEventListener("pointerdown", unlockAudioFromGesture, { passive: true });
    document.addEventListener("keydown", unlockAudioFromGesture);

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
    el.messageInput.maxLength = MAX_MESSAGE_LENGTH;

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
      window.setTimeout(() => {
        if (!el.galleryCanvas.querySelector("canvas")) initGallerySketch();
      }, 120);
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
    const context = ensureAudioContext();
    if (!context) return;

    state.keySoundCounter += 1;
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
    gain.gain.exponentialRampToValueAtTime(0.064, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    noise.start(now);
    noise.stop(now + duration);

    if (state.keySoundCounter % 6 === 0 || Math.random() > 0.88) {
      playChimeTone(context, now + 0.015, 1320 + Math.random() * 520, 0.42, 0.018, Math.random() * 1.2 - 0.6);
    }
  }

  function ensureAudioContext() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    if (!state.audioContext) state.audioContext = new AudioContext();
    const context = state.audioContext;
    if (context.state === "suspended") {
      if (!state.audioNeedsGesture) {
        state.audioNeedsGesture = true;
        context.resume().catch(() => {});
      }
      return null;
    }
    state.audioNeedsGesture = false;
    return context;
  }

  function unlockAudioFromGesture() {
    state.audioNeedsGesture = false;
    if (state.audioContext && state.audioContext.state === "suspended") {
      state.audioContext.resume().catch(() => {});
    }
  }

  function playUnlockBloom() {
    const context = ensureAudioContext();
    if (!context) return;
    const now = context.currentTime;
    const notes = [659, 784, 988, 1175, 1319];
    notes.forEach((frequency, index) => {
      playChimeTone(context, now + index * 0.07, frequency, 1.3 + index * 0.05, 0.026, (index - 2) / 4);
    });
    playGalaxyDrone(context, now);

    const duration = 0.62;
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * duration), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      const t = i / data.length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.2);
    }

    const shimmer = context.createBufferSource();
    shimmer.buffer = buffer;
    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 1800;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.026, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    shimmer.connect(highpass);
    highpass.connect(gain);
    gain.connect(context.destination);
    shimmer.start(now);
    shimmer.stop(now + duration);
  }

  function playChimeTone(context, start, frequency, duration, volume, panValue = 0) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    const panner = context.createStereoPanner ? context.createStereoPanner() : null;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.992, start + duration);
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(frequency * 1.4, start);
    filter.Q.value = 6;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    oscillator.connect(filter);
    filter.connect(gain);
    if (panner) {
      panner.pan.setValueAtTime(panValue, start);
      gain.connect(panner);
      panner.connect(context.destination);
    } else {
      gain.connect(context.destination);
    }
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  function playGalaxyDrone(context, start) {
    const frequencies = [82.4, 123.5];
    frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(420, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(index === 0 ? 0.018 : 0.012, start + 0.5);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 8.5);
      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 8.7);
    });
  }

  function playWaterChime(strength = 1, panValue = 0) {
    const context = ensureAudioContext();
    if (!context) return;
    const now = context.currentTime;
    const base = 880 + Math.random() * 660;
    playChimeTone(context, now, base, 0.86, 0.018 * strength, panValue);
    playChimeTone(context, now + 0.018, base * 1.5, 0.52, 0.007 * strength, panValue * 0.6);
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
      let canvas;
      let papers = [];
      let hoveredId = null;
      let pressed = null;

      p.setup = () => {
        p.pixelDensity(1);
        canvas = p.createCanvas(el.galleryCanvas.clientWidth, el.galleryCanvas.clientHeight);
        canvas.parent(el.galleryCanvas);
        p.textFont("Georgia");
        rebuildLayout();
      };

      p.draw = () => {
        hoveredId = hitTest(p.mouseX, p.mouseY)?.record.id || null;
        if (canvas?.elt) canvas.elt.style.cursor = hoveredId ? "pointer" : "default";
        drawWashBackground();
        drawFaintWriting();
        drawThreads();
        drawPaperCluster();
        drawFlower();
        drawInstruction();
      };

      p.windowResized = () => {
        const width = Math.max(320, el.galleryCanvas.clientWidth);
        const height = Math.max(420, el.galleryCanvas.clientHeight);
        p.resizeCanvas(width, height);
        rebuildLayout();
      };

      p.mousePressed = () => {
        const item = hitTest(p.mouseX, p.mouseY);
        if (!item) return;
        pressed = { id: item.record.id, x: p.mouseX, y: p.mouseY };
        selectRecord(item.record.id);
      };

      p.mouseReleased = () => {
        if (!pressed) return;
        const item = hitTest(p.mouseX, p.mouseY);
        const distance = p.dist(pressed.x, pressed.y, p.mouseX, p.mouseY);
        const record = item && item.record.id === pressed.id ? item.record : null;
        pressed = null;
        if (record && distance < 12) requestOpenRecord(record);
      };

      p.cleanup = () => {};

      function rebuildLayout() {
        const count = records.length;
        const baseW = p.constrain(p.width * 0.13, 82, 128);
        const baseH = baseW * 1.32;
        const columns = p.constrain(Math.ceil(Math.sqrt(count + 1)), 2, p.width < 680 ? 3 : 5);
        const xStep = baseW * 0.78;
        const yStep = baseH * 0.38;
        const clusterTop = p.height * (p.width < 680 ? 0.43 : 0.48);
        papers = records.map((record, index) => {
          const row = Math.floor(index / columns);
          const col = index % columns;
          const centeredCol = col - (Math.min(columns, count) - 1) / 2;
          const seed = hashString(`${record.id}-${index}`);
          const jitterX = (seeded(seed, 1) - 0.5) * baseW * 0.42;
          const jitterY = (seeded(seed, 2) - 0.5) * baseH * 0.24;
          const x = p.constrain(
            p.width * 0.5 + centeredCol * xStep + jitterX + Math.sin(row * 1.7) * baseW * 0.26,
            baseW * 0.65,
            p.width - baseW * 0.65,
          );
          const y = p.constrain(clusterTop + row * yStep + jitterY, baseH * 1.25, p.height - baseH * 0.48);
          const angle = (seeded(seed, 3) - 0.5) * 0.32;
          const anchorSpread = Math.min(p.width * 0.36, Math.max(120, count * 16));
          const anchorX = p.width * 0.5 + (index - (count - 1) / 2) * (anchorSpread / Math.max(1, count - 1 || 1));
          const anchorY = p.height * 0.17 + Math.sin(index * 1.21) * 8;
          return {
            record,
            x,
            y,
            width: baseW * (0.92 + seeded(seed, 4) * 0.18),
            height: baseH * (0.9 + seeded(seed, 5) * 0.16),
            angle,
            anchorX,
            anchorY,
            seed,
          };
        });
      }

      function drawWashBackground() {
        p.background(180, 200, 201);
        p.noStroke();
        p.fill(232, 236, 226, 32);
        p.rect(p.width * 0.18, p.height * 0.14, p.width * 0.58, p.height * 0.62);
        p.fill(112, 139, 132, 28);
        p.rect(p.width * 0.25, p.height * 0.24, p.width * 0.5, p.height * 0.5);
        p.stroke(255, 248, 232, 16);
        p.strokeWeight(1);
        for (let i = 0; i < 78; i += 1) {
          const x = (i * 73) % p.width;
          const y = (i * 47) % p.height;
          p.line(x, y, Math.min(p.width, x + 58 + (i % 5) * 12), y + ((i % 3) - 1) * 2);
        }
        p.stroke(16, 28, 26, 18);
        for (let x = 22; x < p.width; x += 46) {
          p.line(x, 0, x + Math.sin(x * 0.03) * 10, p.height);
        }
      }

      function drawFaintWriting() {
        const source = records.map((record) => `${record.recipient || ""}${record.title || ""}`).join("letters");
        const glyphs = source.replace(/\s+/g, "") || "lettersinmotion";
        p.textFont("Georgia");
        p.textSize(12);
        p.fill(35, 50, 48, 34);
        p.noStroke();
        const columns = p.width < 680 ? 5 : 8;
        for (let col = 0; col < columns; col += 1) {
          const leftSide = col < columns / 2;
          const x = leftSide ? 22 + col * 23 : p.width - 30 - (columns - col - 1) * 23;
          for (let row = 0; row < 24; row += 1) {
            const index = (col * 17 + row * 3) % glyphs.length;
            p.text(glyphs.charAt(index), x + Math.sin(row * 0.7 + col) * 2, 42 + row * 22);
          }
        }
      }

      function drawThreads() {
        p.push();
        p.noFill();
        papers.forEach((item, index) => {
          const top = rotatedPoint(item, 0, -item.height * 0.5);
          const sway = Math.sin(p.frameCount * 0.012 + item.seed * 0.01) * 4;
          const controlY = p.lerp(item.anchorY, top.y, 0.52);
          p.stroke(14, 28, 26, item.record.id === state.selectedId ? 210 : 148);
          p.strokeWeight(item.record.id === state.selectedId ? 0.95 : 0.55);
          p.bezier(item.anchorX, item.anchorY, item.anchorX + sway, controlY, top.x - sway * 0.6, controlY, top.x, top.y);
          if (index % 3 === 0) {
            p.stroke(127, 40, 35, 86);
            p.bezier(item.anchorX + 2, item.anchorY, p.width * 0.5, controlY - 28, top.x, controlY + 22, top.x + 2, top.y);
          }
        });
        p.pop();
      }

      function drawPaperCluster() {
        papers.forEach((item) => {
          drawPaper(item);
        });
      }

      function drawPaper(item) {
        const selected = item.record.id === state.selectedId;
        const hovered = item.record.id === hoveredId;
        const wobble = Math.sin(p.frameCount * 0.012 + item.seed * 0.03) * 0.018;
        p.push();
        p.translate(item.x, item.y);
        p.rotate(item.angle + wobble);
        p.rectMode(p.CENTER);
        p.noStroke();
        p.fill(24, 26, 21, hovered ? 34 : 22);
        p.rect(5, 7, item.width, item.height, 2);
        p.fill(248, 238, 196);
        p.rect(0, 0, item.width, item.height, 2);
        p.stroke(selected ? p.color(123, 30, 28, 210) : p.color(88, 74, 53, 92));
        p.strokeWeight(selected ? 1.35 : 0.75);
        p.noFill();
        p.rect(0, 0, item.width, item.height, 2);
        drawPaperRules(item.width, item.height);
        drawPaperText(item);
        p.pop();
      }

      function drawPaperRules(width, height) {
        p.stroke(78, 67, 49, 58);
        p.strokeWeight(0.55);
        const margin = width * 0.14;
        const columns = 5;
        for (let i = 0; i <= columns; i += 1) {
          const x = p.lerp(-width / 2 + margin, width / 2 - margin, i / columns);
          p.line(x, -height / 2 + 12, x, height / 2 - 12);
        }
        p.line(-width / 2 + margin, -height / 2 + 12, width / 2 - margin, -height / 2 + 12);
        p.line(-width / 2 + margin, height / 2 - 12, width / 2 - margin, height / 2 - 12);
      }

      function drawPaperText(item) {
        const text = `${item.record.title || "Untitled"} ${item.record.recipient || "Private"}`.replace(/\s+/g, "");
        const glyphs = text || "letter";
        p.textAlign(p.CENTER, p.TOP);
        p.textSize(Math.max(6.4, item.width * 0.07));
        p.fill(37, 33, 28, 172);
        p.noStroke();
        const columnCount = 4;
        for (let col = 0; col < columnCount; col += 1) {
          const x = p.lerp(-item.width * 0.26, item.width * 0.26, col / Math.max(1, columnCount - 1));
          for (let row = 0; row < 8; row += 1) {
            const index = (col * 5 + row) % glyphs.length;
            p.text(glyphs.charAt(index), x, -item.height * 0.34 + row * item.height * 0.074);
          }
        }
        p.fill(123, 30, 28, 170);
        p.circle(item.width * 0.31, item.height * 0.34, item.width * 0.07);
      }

      function drawFlower() {
        const scale = p.constrain(p.width / 820, 0.74, 1.32);
        p.push();
        p.translate(p.width / 2, -36 * scale);
        p.scale(scale);
        p.noStroke();
        const petals = [
          [-155, 72, -0.5, 176, 70, [111, 17, 14]],
          [-72, 52, -0.18, 178, 92, [152, 38, 31]],
          [0, 70, 0, 138, 184, [184, 62, 51]],
          [74, 54, 0.18, 176, 94, [144, 34, 29]],
          [154, 76, 0.48, 176, 70, [100, 14, 13]],
          [0, 18, 0, 116, 116, [121, 24, 20]],
        ];
        petals.forEach(([x, y, angle, width, height, color]) => {
          p.push();
          p.translate(x, y);
          p.rotate(angle);
          p.fill(color[0], color[1], color[2], 245);
          p.ellipse(0, 0, width, height);
          p.stroke(65, 17, 16, 42);
          p.strokeWeight(0.8);
          p.line(-width * 0.28, 0, width * 0.27, 0);
          p.pop();
        });
        p.pop();
        p.noStroke();
        p.fill(14, 28, 26, 150);
        papers.forEach((item) => p.circle(item.anchorX, item.anchorY, 2.4));
      }

      function drawInstruction() {
        p.noStroke();
        p.fill(23, 33, 29, 150);
        p.textAlign(p.CENTER, p.BOTTOM);
        p.textSize(13);
        p.text("Click a hanging paper to open it with its key.", p.width / 2, p.height - 18);
      }

      function hitTest(x, y) {
        for (let i = papers.length - 1; i >= 0; i -= 1) {
          if (pointInPaper(papers[i], x, y)) return papers[i];
        }
        return null;
      }

      function pointInPaper(item, x, y) {
        const wobble = Math.sin(p.frameCount * 0.012 + item.seed * 0.03) * 0.018;
        const angle = -(item.angle + wobble);
        const dx = x - item.x;
        const dy = y - item.y;
        const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
        const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
        return Math.abs(localX) <= item.width / 2 && Math.abs(localY) <= item.height / 2;
      }

      function rotatedPoint(item, x, y) {
        const angle = item.angle;
        return {
          x: item.x + x * Math.cos(angle) - y * Math.sin(angle),
          y: item.y + x * Math.sin(angle) + y * Math.cos(angle),
        };
      }

      function hashString(value) {
        let hash = 2166136261;
        for (let i = 0; i < value.length; i += 1) {
          hash ^= value.charCodeAt(i);
          hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
      }

      function seeded(seed, salt) {
        const value = Math.sin((seed + salt * 1013) * 0.000001) * 10000;
        return value - Math.floor(value);
      }
    }, el.galleryCanvas);
  }

  function startRiver(record, plaintext) {
    window.clearTimeout(state.revealTimer);
    state.currentRiver = { record, plaintext };
    renderRiverLetter(plaintext);
    showView("river");
    playUnlockBloom();
    destroyRiverSketch();
    state.riverSketch = createRiverSketch(plaintext);
    state.revealTimer = window.setTimeout(() => {
      el.riverLetter.classList.remove("is-revealing");
    }, 15000);
  }

  function renderRiverLetter(plaintext) {
    el.riverLetter.classList.add("is-revealing");
    el.riverRecipient.textContent = plaintext.recipient ? `To ${plaintext.recipient}` : "";
    el.riverLetterTitle.textContent = plaintext.title || "Untitled letter";
    el.riverLetterMessage.textContent = plaintext.message || "";
  }

  function destroyRiverSketch() {
    if (!state.riverSketch) return;
    if (typeof state.riverSketch.cleanup === "function") state.riverSketch.cleanup();
    state.riverSketch.remove();
    state.riverSketch = null;
  }

  function createLegacyBloomSketch(plaintext) {
    return new window.p5((p) => {
      let targets = [];
      let particles = [];
      let petals = [];
      let blooms = [];
      let textBlock = null;
      let spawnIndex = 0;
      let stableAlpha = 0;
      let frameStarted = false;
      let startMillis = 0;
      const lock = { x: 0, y: 0 };
      const palette = ["#f6d34d", "#fff8b8", "#f4c845", "#ffffff", "#f3b2c7"];
      const rosePalette = ["#b84555", "#d66d8f", "#e9a8bb", "#f4c6ce", "#f2d3b1"];
      const glyphPool = [...`${plaintext.title || ""}${plaintext.message || ""}`]
        .filter((char) => char.trim() && char !== "\n");

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
          p.background(13, 42, 98);
          frameStarted = true;
        }
        drawBackground();
        drawFlowThreads();
        drawEnvelope();
        drawBouquet();
        updatePetals();
        spawnTextParticles();
        particles.forEach((particle) => {
          particle.update();
          particle.draw();
        });
        stableAlpha = easeOutCubic(p.constrain((sceneFrame() - 300) / 120, 0, 1));
        drawStableText(stableAlpha);
      };

      p.windowResized = () => {
        const width = Math.max(320, el.riverCanvas.clientWidth);
        const height = Math.max(440, el.riverCanvas.clientHeight);
        p.resizeCanvas(width, height);
        rebuildTargets();
        resetParticles();
      };

      function rebuildTargets() {
        lock.x = p.width * 0.5;
        lock.y = p.height * 0.78;
        const g = p.createGraphics(p.width, p.height);
        g.pixelDensity(1);
        g.clear();
        g.textFont("Georgia");
        g.noStroke();
        g.fill(255);

        textBlock = buildTextBlock(g, plaintext);
        const startY = textBlock.y;
        g.textSize(textBlock.size);
        g.textLeading(textBlock.leading);
        g.textAlign(p.LEFT, p.TOP);
        textBlock.lines.forEach((line, index) => {
          g.text(line, textBlock.x, startY + index * textBlock.leading);
        });

        g.loadPixels();
        targets = [];
        const step = p.width < 680 ? 5 : 4;
        let glyphIndex = 0;
        for (let y = 0; y < g.height; y += step) {
          for (let x = 0; x < g.width; x += step) {
            const alpha = g.pixels[(y * g.width + x) * 4 + 3];
            if (alpha > 36) {
              const glyph = glyphPool.length ? glyphPool[glyphIndex % glyphPool.length] : "*";
              targets.push({ x, y, glyph, index: glyphIndex });
              glyphIndex += 1;
            }
          }
        }
        const maxTargets = p.width < 680 ? 2600 : 5200;
        targets.sort((a, b) => (a.y - b.y) || (a.x - b.x));
        targets = targets.slice(0, maxTargets);
        g.remove();
        buildBloomTargets();
      }

      function buildTextBlock(g, letter) {
        const maxWidth = p.width * (p.width < 680 ? 0.78 : 0.62);
        const maxHeight = p.height * 0.42;
        const toLine = letter.recipient ? `To ${letter.recipient}` : "";
        const source = [toLine, letter.title, "", letter.message].filter((line, index) => {
          return index < 3 || String(line || "").trim();
        }).join("\n");
        let size = Math.min(34, Math.max(18, p.width / 31));
        let lines = [];
        let leading = size * 1.38;
        let wasTrimmed = false;

        while (size >= 11) {
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
        const maxLines = Math.max(5, Math.floor(maxHeight / leading));
        if (lines.length > maxLines) {
          lines = lines.slice(0, maxLines - 1);
          lines.push("...");
          wasTrimmed = true;
        }

        return {
          x: (p.width - maxWidth) / 2,
          y: Math.max(48, p.height * 0.1),
          size,
          leading,
          lines,
          wasTrimmed,
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
        petals = [];
        spawnIndex = 0;
        stableAlpha = 0;
        frameStarted = false;
        startMillis = p.millis();
        createPetals();
      }

      function sceneFrame() {
        return (p.millis() - startMillis) / 16.67;
      }

      function buildBloomTargets() {
        blooms = [];
        const centerX = p.width * 0.5;
        const topY = p.height * 0.54;
        const count = p.width < 680 ? 7 : 11;
        for (let i = 0; i < count; i += 1) {
          const row = i % 3;
          const spread = p.map(i, 0, count - 1, -1, 1);
          blooms.push({
            start: p.createVector(lock.x, lock.y - 6),
            target: p.createVector(
              centerX + spread * p.width * 0.19 + Math.sin(i * 1.9) * 16,
              topY + row * 20 + Math.cos(i * 1.4) * 14,
            ),
            radius: p.random(23, p.width < 680 ? 34 : 44),
            color: rosePalette[i % rosePalette.length],
            delay: i * 4,
            spin: p.random(-0.7, 0.7),
          });
        }
      }

      function createPetals() {
        const count = p.width < 680 ? 42 : 68;
        for (let i = 0; i < count; i += 1) {
          const angle = p.random(-p.PI * 0.95, -p.PI * 0.05);
          const distance = p.random(p.width * 0.08, p.width * 0.42);
          petals.push(new Petal(
            lock.x,
            lock.y,
            lock.x + Math.cos(angle) * distance,
            lock.y + Math.sin(angle) * distance - p.random(20, 120),
            i,
          ));
        }
      }

      function spawnTextParticles() {
        const frame = sceneFrame();
        if (frame < 62) return;
        const progress = p.constrain((frame - 62) / 250, 0, 1);
        const desiredCount = Math.floor(targets.length * easeOutCubic(progress));
        const rate = Math.max(18, Math.ceil(targets.length / 80));
        for (let i = 0; i < rate && spawnIndex < targets.length && spawnIndex <= desiredCount; i += 1) {
          const target = targets[spawnIndex];
          particles.push(new TextParticle(target, spawnIndex));
          spawnIndex += 1;
        }
      }

      function drawBackground() {
        const ctx = p.drawingContext;
        ctx.save();
        const gradient = ctx.createLinearGradient(0, 0, p.width, p.height);
        gradient.addColorStop(0, "#092a72");
        gradient.addColorStop(0.45, "#143b83");
        gradient.addColorStop(1, "#1f5aaf");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, p.width, p.height);
        ctx.restore();

        p.noStroke();
        for (let i = 0; i < 36; i += 1) {
          const x = (i * 97 + p.frameCount * 0.18) % p.width;
          const y = (i * 53) % p.height;
          p.fill(255, 248, 232, 8 + (i % 3) * 4);
          p.circle(x, y, 1.2 + (i % 4));
        }
      }

      function drawFlowThreads() {
        const frame = sceneFrame();
        p.noFill();
        p.stroke(255, 248, 232, 30);
        p.strokeWeight(1);
        for (let i = 0; i < 7; i += 1) {
          const x = p.map(i, 0, 6, p.width * 0.13, p.width * 0.87);
          p.beginShape();
          for (let y = 48; y < p.height - 30; y += 34) {
            const wave = Math.sin(y * 0.017 + i + frame * 0.012) * 16;
            p.curveVertex(x + wave, y);
          }
          p.endShape();
        }
      }

      function drawEnvelope() {
        const frame = sceneFrame();
        const open = easeOutCubic(p.constrain((frame - 24) / 80, 0, 1));
        const burst = p.constrain((frame - 38) / 50, 0, 1);
        const width = Math.min(180, p.width * 0.32);
        const height = width * 0.58;
        const x = lock.x;
        const y = lock.y + 8;

        p.push();
        p.translate(x, y);
        p.noStroke();
        p.fill(0, 0, 0, 38);
        p.rect(-width / 2 + 6, -height / 2 + 8, width, height, 8);
        p.fill(255, 248, 232, 234);
        p.rect(-width / 2, -height / 2, width, height, 8);
        p.stroke(150, 106, 67, 120);
        p.strokeWeight(1.2);
        p.line(-width / 2, -height / 2, 0, 2);
        p.line(width / 2, -height / 2, 0, 2);
        p.line(-width / 2, height / 2, -10, 0);
        p.line(width / 2, height / 2, 10, 0);
        p.noStroke();
        p.fill(255, 235, 183, 190);
        p.beginShape();
        p.vertex(-width / 2, -height / 2);
        p.vertex(0, -height / 2 - open * 52);
        p.vertex(width / 2, -height / 2);
        p.vertex(0, 2);
        p.endShape(p.CLOSE);
        p.fill(157, 45, 40, 230);
        p.circle(0, 4, 24 + Math.sin(p.frameCount * 0.17) * 1.5);
        p.fill(255, 248, 232, 220 * open);
        p.circle(0, 4, 7 + open * 4);
        p.pop();

        if (burst > 0 && burst < 1) {
          p.push();
          p.translate(lock.x, lock.y);
          p.stroke(255, 248, 184, 170 * (1 - burst));
          p.strokeWeight(1.2);
          for (let i = 0; i < 18; i += 1) {
            const angle = (i / 18) * p.TWO_PI + p.frameCount * 0.01;
            const inner = 12 + burst * 12;
            const outer = 38 + burst * 150;
            p.line(Math.cos(angle) * inner, Math.sin(angle) * inner, Math.cos(angle) * outer, Math.sin(angle) * outer);
          }
          p.pop();
        }
      }

      function drawBouquet() {
        const frame = sceneFrame();
        const global = easeOutCubic(p.constrain((frame - 18) / 120, 0, 1));
        if (global <= 0) return;

        p.push();
        p.stroke(71, 119, 103, 150 * global);
        p.strokeWeight(1.15);
        blooms.forEach((bloom) => {
          const head = window.p5.Vector.lerp(bloom.start, bloom.target, global);
          p.line(lock.x, lock.y + 6, head.x, head.y + bloom.radius * 0.42);
        });
        p.pop();

        blooms.forEach((bloom) => {
          const local = easeOutBack(p.constrain((frame - 34 - bloom.delay) / 78, 0, 1));
          if (local <= 0) return;
          const pos = window.p5.Vector.lerp(bloom.start, bloom.target, local);
          const radius = bloom.radius * local;
          drawRose(pos.x, pos.y, radius, bloom.color, bloom.spin + p.frameCount * 0.003);
        });
      }

      function updatePetals() {
        petals.forEach((petal) => {
          petal.update();
          petal.draw();
        });
      }

      function drawStableText(alpha) {
        if (!textBlock || alpha <= 0) return;
        p.push();
        p.noStroke();
        p.textFont("Georgia");
        p.textAlign(p.LEFT, p.TOP);
        p.textSize(textBlock.size);
        p.textLeading(textBlock.leading);
        p.fill(8, 21, 38, 150 * alpha);
        textBlock.lines.forEach((line, index) => {
          p.text(line, textBlock.x + 2, textBlock.y + index * textBlock.leading + 2, p.width - textBlock.x * 2);
        });
        p.fill(255, 248, 232, 235 * alpha);
        textBlock.lines.forEach((line, index) => {
          p.text(line, textBlock.x, textBlock.y + index * textBlock.leading, p.width - textBlock.x * 2);
        });
        p.pop();
      }

      class TextParticle {
        constructor(target, index) {
          const angle = p.random(-p.PI, 0);
          const radius = p.random(6, 44);
          this.pos = p.createVector(lock.x + Math.cos(angle) * radius, lock.y + Math.sin(angle) * radius);
          this.vel = p.createVector(Math.cos(angle) * p.random(1.5, 4.8), Math.sin(angle) * p.random(1.5, 4.8));
          this.acc = p.createVector(0, 0);
          this.target = p.createVector(target.x, target.y);
          this.glyph = target.glyph || "*";
          this.size = p.random(2.1, 4.8);
          this.maxSpeed = p.random(4.2, 7.8);
          this.maxForce = p.random(0.13, 0.32);
          this.color = palette[Math.floor(p.random(palette.length))];
          this.kind = index % 7 === 0 ? "glyph" : index % 11 === 0 ? "star" : "dot";
          this.phase = p.random(p.TWO_PI);
          this.settled = false;
        }

        update() {
          const desired = window.p5.Vector.sub(this.target, this.pos);
          const distance = desired.mag();
          let speed = this.maxSpeed;
          if (distance < 86) speed = p.map(distance, 0, 86, 0.05, this.maxSpeed);
          desired.setMag(speed);
          const steer = window.p5.Vector.sub(desired, this.vel);
          steer.limit(this.maxForce);
          const flowAngle = p.noise(this.pos.x * 0.004, this.pos.y * 0.004, p.frameCount * 0.008) * p.TWO_PI * 2;
          const flow = p.createVector(Math.cos(flowAngle), Math.sin(flowAngle)).mult(distance > 34 ? 0.045 : 0.012);
          this.acc.add(steer);
          this.acc.add(flow);
          this.vel.add(this.acc);
          this.vel.mult(distance < 28 ? 0.86 : 0.982);
          this.pos.add(this.vel);
          this.acc.mult(0);
          if (distance < 1.4) {
            this.pos.lerp(this.target, 0.4);
            this.vel.mult(0);
            this.settled = true;
          }
        }

        draw() {
          const ctx = p.drawingContext;
          ctx.save();
          ctx.shadowBlur = this.settled ? 7 : 15;
          ctx.shadowColor = `rgba(246, 211, 77, ${0.72 - stableAlpha * 0.42})`;
          p.noStroke();
          const particleColor = p.color(this.color);
          particleColor.setAlpha(this.settled ? 230 - stableAlpha * 150 : 235);
          p.fill(particleColor);
          if (this.kind === "glyph") {
            p.textAlign(p.CENTER, p.CENTER);
            p.textFont("Georgia");
            p.textSize(this.size * 3.2);
            p.text(this.glyph, this.pos.x, this.pos.y);
          } else if (this.kind === "star") {
            const pulse = 0.85 + Math.sin(p.frameCount * 0.08 + this.phase) * 0.22;
            drawStar(this.pos.x, this.pos.y, this.size * 0.5 * pulse, this.size * 1.38 * pulse, 5);
          } else {
            const pulse = this.settled ? 0.85 + Math.sin(p.frameCount * 0.07 + this.phase) * 0.18 : 1;
            p.circle(this.pos.x, this.pos.y, this.size * pulse);
          }
          ctx.restore();
        }
      }

      class Petal {
        constructor(startX, startY, targetX, targetY, index) {
          this.start = p.createVector(startX, startY);
          this.target = p.createVector(targetX, targetY);
          this.pos = this.start.copy();
          this.index = index;
          this.size = p.random(8, 19);
          this.delay = p.random(18, 76);
          this.phase = p.random(p.TWO_PI);
          this.color = p.random(["#f4b7c6", "#eaa3b7", "#f0c4cd", "#f2d3b1"]);
        }

        update() {
          const frame = sceneFrame();
          const t = p.constrain((frame - this.delay) / 135, 0, 1);
          const eased = easeOutCubic(t);
          this.pos = window.p5.Vector.lerp(this.start, this.target, eased);
          if (t >= 1) {
            this.pos.x += Math.sin(p.frameCount * 0.018 + this.phase) * 18;
            this.pos.y += Math.sin(p.frameCount * 0.012 + this.phase) * 9;
          }
        }

        draw() {
          const frame = sceneFrame();
          const t = p.constrain((frame - this.delay) / 135, 0, 1);
          if (t <= 0) return;
          p.push();
          p.translate(this.pos.x, this.pos.y);
          p.rotate(Math.sin(p.frameCount * 0.026 + this.phase) * 0.9);
          p.noStroke();
          p.fill(this.color + Math.floor(190 * (1 - t * 0.35)).toString(16).padStart(2, "0"));
          p.ellipse(0, 0, this.size * 0.76, this.size * 1.25);
          p.pop();
        }
      }

      function drawRose(x, y, radius, color, rotation) {
        p.push();
        p.translate(x, y);
        p.rotate(rotation);
        const ctx = p.drawingContext;
        ctx.save();
        ctx.shadowBlur = 16;
        ctx.shadowColor = "rgba(255, 190, 210, 0.45)";
        p.noStroke();
        p.fill(color);
        p.circle(0, 0, radius * 1.55);
        for (let ring = 4; ring >= 1; ring -= 1) {
          const petalsInRing = ring * 5;
          const ringRadius = radius * (ring / 5);
          p.fill(lightenColor(color, ring * 14));
          for (let i = 0; i < petalsInRing; i += 1) {
            p.push();
            const angle = (i / petalsInRing) * p.TWO_PI + ring * 0.38;
            p.rotate(angle);
            p.translate(ringRadius * 0.48, 0);
            p.ellipse(0, 0, radius * 0.22 + ring * 1.6, radius * 0.55);
            p.pop();
          }
        }
        p.fill(255, 236, 226, 180);
        p.circle(0, 0, radius * 0.22);
        ctx.restore();
        p.pop();
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

      function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
      }

      function easeOutBack(t) {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
      }

      function lightenColor(hex, amount) {
        const value = hex.replace("#", "");
        const r = Math.min(255, parseInt(value.slice(0, 2), 16) + amount);
        const g = Math.min(255, parseInt(value.slice(2, 4), 16) + amount);
        const b = Math.min(255, parseInt(value.slice(4, 6), 16) + amount);
        return `rgb(${r}, ${g}, ${b})`;
      }
    }, el.riverCanvas);
  }

  function createRiverSketch(plaintext) {
    return new window.p5((p) => {
      let canvas;
      let layout;
      let glyphs = [];
      let startMillis = 0;
      let lastChimeAt = 0;

      const blue = [38, 91, 213];
      const lineBlue = [152, 190, 230];
      const ink = [17, 23, 31];
      const gold = [231, 192, 66];
      const paper = [229, 231, 216];

      p.setup = () => {
        p.pixelDensity(1);
        canvas = p.createCanvas(
          Math.max(320, el.riverCanvas.clientWidth),
          Math.max(440, el.riverCanvas.clientHeight),
        );
        canvas.parent(el.riverCanvas);
        p.textFont("Georgia");
        resetScene();
      };

      p.draw = () => {
        const t = elapsed();
        drawBackground(t);
        drawPaperArchitecture(t);
        drawBoat(t);
        drawGlyphField(t);
        drawFinalUnfurl(t);
      };

      p.windowResized = () => {
        const width = Math.max(320, el.riverCanvas.clientWidth);
        const height = Math.max(440, el.riverCanvas.clientHeight);
        p.resizeCanvas(width, height);
        resetScene();
      };

      p.cleanup = () => {};

      function resetScene() {
        startMillis = p.millis();
        lastChimeAt = 0;
        layout = buildRiverLayout();
        glyphs = buildGlyphField();
      }

      function elapsed() {
        return (p.millis() - startMillis) / 1000;
      }

      function buildRiverLayout() {
        const text = [
          plaintext.recipient ? `To ${plaintext.recipient}` : "",
          plaintext.title || "Untitled letter",
          plaintext.message || "",
        ].join(" ");
        const clean = text.replace(/\s+/g, " ").trim() || "letters in motion";
        const compact = clean.replace(/\s+/g, "");
        const characters = [...compact];
        const columnCount = p.width < 680 ? 5 : 8;
        const page = {
          x: p.width * (p.width < 680 ? 0.49 : 0.56),
          y: p.height * 0.48,
          w: Math.min(p.width * 0.62, 520),
          h: p.height * 0.72,
        };
        const columns = [];
        const columnGap = page.w / Math.max(1, columnCount - 1);
        const top = page.y - page.h * 0.43;
        const bottom = page.y + page.h * 0.43;
        for (let i = 0; i < columnCount; i += 1) {
          const x = page.x - page.w / 2 + i * columnGap;
          const phase = i * 0.73;
          columns.push({
            x,
            top: top + Math.sin(i * 0.9) * 16,
            bottom: bottom + Math.cos(i * 0.7) * 22,
            phase,
            chars: [],
          });
        }

        characters.forEach((char, index) => {
          columns[index % columns.length].chars.push({ char, order: index });
        });

        return {
          clean,
          characters,
          columns,
          page,
          boat: {
            x: p.width * (p.width < 680 ? 0.13 : 0.14),
            y: p.height * 0.64,
            scale: p.constrain(p.width / 860, 0.58, 1.0),
          },
        };
      }

      function buildGlyphField() {
        const source = layout.characters.length ? layout.characters : [..."lettersinmotion"];
        const count = Math.min(p.width < 680 ? 116 : 174, Math.max(74, source.length * 2));
        const list = [];
        for (let i = 0; i < count; i += 1) {
          const column = layout.columns[i % layout.columns.length];
          const columnSpan = Math.max(1, column.bottom - column.top);
          const seed = hashString(`${source[i % source.length]}-${i}-${plaintext.createdAt || ""}`);
          const rowT = seeded(seed, 1);
          const startX = column.x + (seeded(seed, 2) - 0.5) * 10;
          const startY = column.top + rowT * columnSpan;
          const kindRoll = seeded(seed, 3);
          const kind = kindRoll > 0.78 ? "star" : kindRoll > 0.46 ? "moon" : kindRoll > 0.2 ? "letter" : "dot";
          list.push({
            char: source[i % source.length],
            kind,
            pathIndex: i % 3,
            pathOffset: seeded(seed, 4) * 0.16,
            startX,
            startY,
            delay: 0.85 + i * (p.width < 680 ? 0.026 : 0.018) + seeded(seed, 5) * 0.42,
            duration: 6.2 + seeded(seed, 6) * 2.4,
            size: p.lerp(7, p.width < 680 ? 14 : 17, seeded(seed, 7)),
            phase: seeded(seed, 8) * p.TWO_PI,
            chime: false,
          });
        }
        return list;
      }

      function drawBackground(t) {
        p.background(blue[0], blue[1], blue[2]);
        p.noStroke();
        p.fill(255, 255, 255, 9);
        for (let i = 0; i < 96; i += 1) {
          const x = (i * 89 + Math.sin(i) * 31) % p.width;
          const y = (i * 53 + Math.cos(i * 0.8) * 25) % p.height;
          p.rect(x, y, 1 + (i % 3), 1);
        }
        p.stroke(12, 28, 70, 18);
        p.strokeWeight(1);
        for (let x = 18; x < p.width; x += 42) {
          p.line(x + Math.sin(t * 0.08 + x) * 3, 0, x + Math.sin(t * 0.08 + x) * 6, p.height);
        }
      }

      function drawPaperArchitecture(t) {
        const reveal = easeInOutCubic(p.constrain(t / 1.7, 0, 1));
        const page = layout.page;
        p.push();
        p.noFill();
        p.stroke(lineBlue[0], lineBlue[1], lineBlue[2], 84 * reveal);
        p.strokeWeight(1);
        p.beginShape();
        p.curveVertex(page.x - page.w * 0.56, page.y - page.h * 0.45);
        p.curveVertex(page.x - page.w * 0.52, page.y - page.h * 0.46);
        p.curveVertex(page.x - page.w * 0.47, page.y - page.h * 0.08);
        p.curveVertex(page.x - page.w * 0.52, page.y + page.h * 0.45);
        p.curveVertex(page.x - page.w * 0.48, page.y + page.h * 0.48);
        p.endShape();
        p.beginShape();
        p.curveVertex(page.x + page.w * 0.53, page.y - page.h * 0.44);
        p.curveVertex(page.x + page.w * 0.55, page.y - page.h * 0.42);
        p.curveVertex(page.x + page.w * 0.47, page.y - page.h * 0.03);
        p.curveVertex(page.x + page.w * 0.54, page.y + page.h * 0.38);
        p.curveVertex(page.x + page.w * 0.5, page.y + page.h * 0.46);
        p.endShape();

        layout.columns.forEach((column, index) => {
          p.stroke(lineBlue[0], lineBlue[1], lineBlue[2], 110 * reveal);
          p.strokeWeight(index % 2 ? 0.75 : 1);
          p.beginShape();
          for (let step = 0; step <= 18; step += 1) {
            const amount = step / 18;
            const y = p.lerp(column.top, column.bottom, amount);
            const x = column.x + Math.sin(amount * p.PI * 2 + column.phase + t * 0.06) * 8;
            p.curveVertex(x, y);
          }
          p.endShape();
          drawColumnText(column, index, reveal);
        });
        p.pop();
      }

      function drawColumnText(column, index, reveal) {
        const chars = column.chars.length ? column.chars : [{ char: " " }];
        const maxChars = Math.min(chars.length, p.width < 680 ? 15 : 20);
        const step = Math.min(21, Math.max(15, (column.bottom - column.top) / Math.max(1, maxChars)));
        p.noStroke();
        p.fill(12, 18, 34, 132 * reveal);
        p.textAlign(p.CENTER, p.TOP);
        p.textSize(p.width < 680 ? 11 : 13);
        for (let i = 0; i < maxChars; i += 1) {
          const item = chars[i % chars.length];
          const x = column.x + Math.sin(i * 0.72 + index) * 2.4;
          const y = column.top + i * step;
          p.text(item.char, x, y);
        }
      }

      function drawBoat(t) {
        const boat = layout.boat;
        p.push();
        p.translate(boat.x + Math.sin(t * 0.6) * 3, boat.y + Math.sin(t * 0.9) * 2);
        p.scale(boat.scale);
        p.noStroke();
        p.fill(10, 19, 38, 28);
        p.beginShape();
        p.vertex(-66, 23);
        p.vertex(60, 20);
        p.vertex(30, 36);
        p.vertex(-36, 39);
        p.endShape(p.CLOSE);
        p.fill(218, 225, 222, 235);
        p.stroke(72, 102, 132, 135);
        p.strokeWeight(1.1);
        p.beginShape();
        p.vertex(-66, 0);
        p.vertex(72, -3);
        p.vertex(32, 28);
        p.vertex(-36, 28);
        p.endShape(p.CLOSE);
        p.line(-66, 0, -10, 24);
        p.line(72, -3, 9, 24);
        p.noFill();
        p.stroke(lineBlue[0], lineBlue[1], lineBlue[2], 110);
        p.strokeWeight(0.75);
        for (let i = 0; i < 4; i += 1) {
          const target = streamPoint(0.16 + i * 0.16, i % 3);
          p.line(42, 2, (target.x - boat.x) / boat.scale, (target.y - boat.y) / boat.scale);
        }
        p.pop();
      }

      function drawGlyphField(t) {
        drawStreamGuides(t);
        const states = glyphs.map((glyph) => glyphState(glyph, t));
        p.push();
        p.noFill();
        states.forEach((state, index) => {
          if (index % 13 !== 0 || state.alpha <= 8) return;
          p.stroke(238, 221, 151, state.alpha * 0.18);
          p.strokeWeight(0.55);
          p.line(layout.boat.x + 18, layout.boat.y - 2, state.x, state.y);
        });
        p.pop();

        states.forEach((state) => {
          if (state.alpha <= 1) return;
          drawGlyph(state);
          if (state.progress > 0.64 && !state.source.chime && t - lastChimeAt > 0.1) {
            state.source.chime = true;
            lastChimeAt = t;
            playWaterChime(0.48, p.map(state.x, 0, p.width, -0.6, 0.6));
          }
        });
      }

      function drawStreamGuides(t) {
        p.push();
        p.noFill();
        for (let pathIndex = 0; pathIndex < 3; pathIndex += 1) {
          p.stroke(lineBlue[0], lineBlue[1], lineBlue[2], 70);
          p.strokeWeight(pathIndex === 1 ? 1 : 0.75);
          p.beginShape();
          for (let i = 0; i <= 52; i += 1) {
            const amount = i / 52;
            const point = streamPoint(amount, pathIndex);
            p.curveVertex(point.x + Math.sin(t * 0.12 + i) * 1.2, point.y);
          }
          p.endShape();
        }
        p.pop();
      }

      function glyphState(glyph, t) {
        const raw = p.constrain((t - glyph.delay) / glyph.duration, 0, 1);
        const scatter = easeInOutCubic(p.constrain((t - glyph.delay) / 2.25, 0, 1));
        const pathT = p.constrain(raw + glyph.pathOffset, 0, 1);
        const target = streamPoint(pathT, glyph.pathIndex);
        const breathe = Math.sin(t * 1.1 + glyph.phase) * (1 - raw) * 7;
        const x = p.lerp(glyph.startX, target.x, scatter) + Math.sin(t * 0.9 + glyph.phase) * 3;
        const y = p.lerp(glyph.startY, target.y, scatter) + breathe;
        const alphaIn = easeInOutCubic(p.constrain((t - glyph.delay + 0.4) / 1.4, 0, 1));
        const alphaOut = 1 - easeInOutCubic(p.constrain((t - 12.6) / 2.1, 0, 1));
        return {
          source: glyph,
          kind: glyph.kind,
          char: glyph.char,
          x,
          y,
          progress: raw,
          size: glyph.size * (0.88 + Math.sin(t * 1.4 + glyph.phase) * 0.07),
          angle: glyph.phase + raw * p.PI * 1.2,
          alpha: 238 * alphaIn * alphaOut,
        };
      }

      function streamPoint(amount, pathIndex) {
        const a = p.constrain(amount, 0, 1);
        const w = p.width;
        const h = p.height;
        const variants = [
          [
            { x: w * 0.52, y: h * 0.13 },
            { x: w * 0.83, y: h * 0.12 },
            { x: w * 0.42, y: h * 0.43 },
            { x: w * 0.82, y: h * 0.58 },
          ],
          [
            { x: w * 0.19, y: h * 0.61 },
            { x: w * 0.42, y: h * 0.48 },
            { x: w * 0.72, y: h * 0.52 },
            { x: w * 0.88, y: h * 0.86 },
          ],
          [
            { x: w * 0.7, y: h * 0.18 },
            { x: w * 0.93, y: h * 0.3 },
            { x: w * 0.54, y: h * 0.72 },
            { x: w * 0.76, y: h * 0.95 },
          ],
        ];
        return cubicPoint(variants[pathIndex], a);
      }

      function drawGlyph(state) {
        p.push();
        p.translate(state.x, state.y);
        p.rotate(state.angle);
        p.noStroke();
        if (state.kind === "moon") {
          drawCrescent(0, 0, state.size, state.alpha);
        } else if (state.kind === "star") {
          p.fill(gold[0], gold[1], gold[2], state.alpha);
          drawSmallStar(0, 0, state.size * 0.38, state.size * 0.82, 5);
        } else if (state.kind === "letter") {
          p.textFont("Georgia");
          p.textAlign(p.CENTER, p.CENTER);
          p.textSize(state.size * 1.18);
          p.fill(gold[0], gold[1], gold[2], state.alpha * 0.94);
          p.text(state.char, 0, 0);
        } else {
          p.fill(246, 230, 158, state.alpha);
          p.circle(0, 0, Math.max(2, state.size * 0.24));
        }
        p.pop();
      }

      function drawCrescent(x, y, size, alpha) {
        p.fill(gold[0], gold[1], gold[2], alpha);
        p.circle(x, y, size);
        p.fill(blue[0], blue[1], blue[2], alpha);
        p.circle(x + size * 0.34, y - size * 0.08, size * 0.88);
      }

      function drawFinalUnfurl(t) {
        const show = easeInOutCubic(p.constrain((t - 10.6) / 3.2, 0, 1));
        if (show <= 0) return;
        const w = Math.min(430, p.width * 0.62);
        const h = Math.min(300, p.height * 0.5);
        const x = p.width * 0.5;
        const y = p.height * 0.56;
        p.push();
        p.translate(x, y);
        p.scale(0.92 + show * 0.08, show);
        p.noStroke();
        p.fill(paper[0], paper[1], paper[2], 208 * show);
        p.rectMode(p.CENTER);
        p.rect(0, 0, w, h, 2);
        p.stroke(80, 92, 96, 58 * show);
        p.strokeWeight(0.75);
        const columns = p.width < 680 ? 5 : 7;
        for (let i = 0; i <= columns; i += 1) {
          const cx = p.lerp(-w * 0.42, w * 0.42, i / columns);
          p.line(cx, -h * 0.42, cx, h * 0.42);
        }
        p.noStroke();
        p.fill(16, 21, 28, 190 * show);
        p.textFont("Georgia");
        p.textAlign(p.CENTER, p.TOP);
        p.textSize(Math.max(12, Math.min(16, w / 28)));
        const chars = layout.clean.replace(/\s+/g, "").slice(0, columns * 16);
        for (let col = 0; col < columns; col += 1) {
          const cx = p.lerp(-w * 0.35, w * 0.35, col / Math.max(1, columns - 1));
          for (let row = 0; row < 16; row += 1) {
            const char = chars.charAt(col * 16 + row);
            if (!char) continue;
            p.text(char, cx, -h * 0.38 + row * 16);
          }
        }
        p.pop();
      }

      function cubicPoint(points, amount) {
        const mt = 1 - amount;
        const x = mt ** 3 * points[0].x
          + 3 * mt * mt * amount * points[1].x
          + 3 * mt * amount * amount * points[2].x
          + amount ** 3 * points[3].x;
        const y = mt ** 3 * points[0].y
          + 3 * mt * mt * amount * points[1].y
          + 3 * mt * amount * amount * points[2].y
          + amount ** 3 * points[3].y;
        return { x, y };
      }

      function drawSmallStar(x, y, innerRadius, outerRadius, points) {
        p.beginShape();
        for (let i = 0; i < points * 2; i += 1) {
          const angle = -p.HALF_PI + (i * p.PI) / points;
          const radius = i % 2 === 0 ? outerRadius : innerRadius;
          p.vertex(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
        }
        p.endShape(p.CLOSE);
      }

      function hashString(value) {
        let hash = 2166136261;
        for (let i = 0; i < value.length; i += 1) {
          hash ^= value.charCodeAt(i);
          hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
      }

      function seeded(seed, salt) {
        const value = Math.sin((seed + salt * 7919) * 0.000001) * 10000;
        return value - Math.floor(value);
      }

      function easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      }
    }, el.riverCanvas);
  }

  function createPreviousRiverSketch(plaintext) {
    return new window.p5((p) => {
      const VERTEX_SHADER = `
        precision mediump float;
        attribute vec3 aPosition;
        varying vec2 vUv;

        void main() {
          vUv = aPosition.xy * 0.5 + 0.5;
          gl_Position = vec4(aPosition.xy, 0.0, 1.0);
        }
      `;
      const GALAXY_SHADER = `
        precision mediump float;
        uniform vec2 u_resolution;
        uniform float u_time;
        uniform float u_collapse;
        uniform vec4 u_ripple0;
        uniform vec4 u_ripple1;
        uniform vec4 u_ripple2;
        uniform vec4 u_ripple3;
        uniform vec4 u_ripple4;
        uniform vec4 u_ripple5;
        uniform vec4 u_ripple6;
        uniform vec4 u_ripple7;
        varying vec2 vUv;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float softStar(vec2 uv, float scale) {
          vec2 cell = floor(uv * scale);
          vec2 local = fract(uv * scale) - 0.5;
          float seed = hash(cell);
          float d = length(local);
          return smoothstep(0.034, 0.0, d) * step(0.982, seed);
        }

        float rippleContribution(vec2 uv, vec4 ripple) {
          float age = u_time - ripple.z;
          float alive = step(0.0, age) * (1.0 - smoothstep(0.8, 3.0, age)) * ripple.w;
          vec2 delta = uv - ripple.xy;
          delta.y *= 3.2;
          float d = length(delta);
          float rings = 0.0;
          rings += exp(-pow((d - age * 0.028) * 140.0, 2.0));
          rings += exp(-pow((d - age * 0.042) * 160.0, 2.0)) * 0.72;
          rings += exp(-pow((d - age * 0.058) * 185.0, 2.0)) * 0.48;
          rings += exp(-pow((d - age * 0.071) * 200.0, 2.0)) * 0.28;
          return rings * alive;
        }

        void main() {
          vec2 uv = vUv;
          float waterLine = 0.58;
          float warm = 1.0 - smoothstep(0.18, 0.72, uv.y);
          float water = smoothstep(waterLine - 0.04, waterLine + 0.08, uv.y);
          float ripple = 0.0;
          ripple += rippleContribution(uv, u_ripple0);
          ripple += rippleContribution(uv, u_ripple1);
          ripple += rippleContribution(uv, u_ripple2);
          ripple += rippleContribution(uv, u_ripple3);
          ripple += rippleContribution(uv, u_ripple4);
          ripple += rippleContribution(uv, u_ripple5);
          ripple += rippleContribution(uv, u_ripple6);
          ripple += rippleContribution(uv, u_ripple7);
          float wave = sin((uv.x * 24.0) + u_time * 0.45) * 0.006;
          wave += sin((uv.x * 9.0) - u_time * 0.22) * 0.009;
          wave += ripple * 0.014;

          float nebula = smoothstep(0.18, 0.85, sin(uv.x * 4.6 + uv.y * 5.8 + u_time * 0.035) * 0.5 + 0.5);
          vec3 darkTop = mix(vec3(0.072, 0.034, 0.095), vec3(0.024, 0.038, 0.115), u_collapse);
          vec3 warmGlow = vec3(0.68, 0.22, 0.28) * warm * (1.0 - u_collapse * 0.65);
          vec3 roseBloom = vec3(0.52, 0.14, 0.24) * warm * warm * (1.0 - u_collapse * 0.8) * 0.7;
          vec3 galaxy = vec3(0.012, 0.020, 0.068);
          galaxy += vec3(0.028, 0.066, 0.19) * smoothstep(0.08, 0.98, uv.y);
          galaxy += vec3(0.12, 0.045, 0.19) * nebula * u_collapse * 0.58;
          galaxy += vec3(0.055, 0.018, 0.11) * nebula * (1.0 - u_collapse) * 0.35;

          vec3 color = mix(darkTop + warmGlow + roseBloom, galaxy, u_collapse);
          vec3 waterColor = vec3(0.008, 0.018, 0.058)
            + vec3(0.025, 0.068, 0.21) * (1.0 - uv.y + wave)
            + vec3(0.22, 0.14, 0.04) * (1.0 - uv.y) * 0.18;
          color = mix(color, waterColor, water * u_collapse);
          color += vec3(0.85, 0.68, 0.32) * ripple * water * u_collapse * 0.55;
          float dustLane = smoothstep(0.0, 1.0, sin(uv.x * 7.2 + uv.y * 3.1 + u_time * 0.018) * 0.5 + 0.5) * 0.04;
          color += vec3(0.6, 0.4, 0.9) * dustLane * u_collapse;

          float stars = softStar(uv + vec2(u_time * 0.002, 0.0), 88.0);
          stars += softStar(uv + vec2(0.13, u_time * 0.001), 142.0) * 0.75;
          stars += softStar(uv + vec2(u_time * -0.001, 0.21), 52.0) * warm * (1.0 - u_collapse * 0.4) * 0.6;
          color += vec3(0.86, 0.91, 1.0) * stars * u_collapse;
          color += vec3(1.0, 0.62, 0.34) * stars * warm * (1.0 - u_collapse) * 0.95;

          float horizon = smoothstep(waterLine + 0.01, waterLine - 0.01, abs(uv.y - waterLine));
          color += vec3(0.25, 0.37, 0.58) * horizon * u_collapse * 0.25;

          gl_FragColor = vec4(color, 1.0);
        }
      `;

      let bgShader = null;
      let scene;
      let layout;
      let roseParticles = [];
      let glyphStars = [];
      let dust = [];
      let fireflies = [];
      let ripples = [];
      let startMillis = 0;
      let lastChimeAt = 0;
      let chimeCount = 0;

      const roseColors = [
        [244, 173, 190],
        [225, 104, 142],
        [255, 206, 214],
        [207, 73, 104],
        [246, 190, 154],
      ];

      p.setup = () => {
        p.pixelDensity(1);
        const canvas = p.createCanvas(
          Math.max(320, el.riverCanvas.clientWidth),
          Math.max(440, el.riverCanvas.clientHeight),
          p.WEBGL,
        );
        canvas.parent(el.riverCanvas);
        p.noStroke();
        bgShader = p.createShader(VERTEX_SHADER, GALAXY_SHADER);
        scene = createSceneLayer(p.width, p.height);
        resetScene();
      };

      p.draw = () => {
        const t = elapsed();
        const collapse = easeInOutCubic(p.constrain((t - 2.0) / 1.65, 0, 1));
        drawGalaxyShader(t, collapse);
        p.resetShader();
        drawSceneBuffer(t, collapse);
      };

      p.windowResized = () => {
        const width = Math.max(320, el.riverCanvas.clientWidth);
        const height = Math.max(440, el.riverCanvas.clientHeight);
        p.resizeCanvas(width, height);
        scene = createSceneLayer(width, height);
        resetScene();
      };

      p.cleanup = () => {
        if (scene && typeof scene.remove === "function") scene.remove();
      };

      function createSceneLayer(width, height) {
        if (scene && typeof scene.remove === "function") scene.remove();
        const layer = p.createGraphics(width, height);
        layer.pixelDensity(1);
        layer.textFont("Georgia");
        const canvasNode = layer.elt || layer.canvas;
        canvasNode.classList.add("cinematic-overlay");
        canvasNode.setAttribute("aria-hidden", "true");
        el.riverCanvas.appendChild(canvasNode);
        return layer;
      }

      function resetScene() {
        startMillis = p.millis();
        lastChimeAt = 0;
        chimeCount = 0;
        layout = buildLetterLayout();
        roseParticles = buildRoseParticles();
        glyphStars = buildGlyphStars();
        dust = buildDust();
        fireflies = buildFireflies();
        ripples = [];
      }

      function elapsed() {
        return (p.millis() - startMillis) / 1000;
      }

      function drawGalaxyShader(t, collapse) {
        p.shader(bgShader);
        bgShader.setUniform("u_resolution", [p.width, p.height]);
        bgShader.setUniform("u_time", t);
        bgShader.setUniform("u_collapse", collapse);
        setRippleUniforms(t);
        p.quad(-1, -1, 1, -1, 1, 1, -1, 1);
      }

      function setRippleUniforms(t) {
        const visibleRipples = ripples
          .filter((ripple) => t - ripple.born >= 0 && t - ripple.born < 3.4)
          .slice(-8);
        for (let i = 0; i < 8; i += 1) {
          const ripple = visibleRipples[i];
          const value = ripple
            ? [ripple.x / p.width, ripple.y / p.height, ripple.born, ripple.strength]
            : [0, 0, -100, 0];
          bgShader.setUniform(`u_ripple${i}`, value);
        }
      }

      function drawSceneBuffer(t, collapse) {
        scene.clear();
        const shake = emotionalShake(t);
        scene.push();
        scene.translate(shake.x, shake.y);
        drawUpperAtmosphere(t, collapse);
        drawEnvelope(t, collapse);
        updateRoseParticles(t, collapse);
        drawWaterSurface(t, collapse);
        updateGlyphStars(t, collapse);
        drawRipples(t, collapse);
        drawBoatAndPaper(t);
        scene.pop();
      }

      function drawUpperAtmosphere(t, collapse) {
        scene.noStroke();
        const glowAlpha = 92 * (1 - collapse);
        drawGlow(p.width * 0.5, p.height * 0.36, p.width * 0.5, [240, 142, 159], glowAlpha);
        scene.push();
        scene.blendMode(scene.ADD);
        fireflies.forEach((item) => {
          const driftX = Math.sin(t * item.wander + item.phase) * item.drift;
          const flowX = (item.x + t * item.speed * 22 + driftX) % (p.width + 40);
          const x = flowX - 20;
          const y = item.y + Math.sin(t * item.floatSpeed + item.phase * 1.7) * item.float;
          const twinkle = 0.62 + Math.sin(t * item.twinkle + item.phase) * 0.38;
          const alpha = item.alpha * twinkle * (1 - collapse * 0.48);
          drawGlow(x, y, item.size * 22, [255, 175, 100], alpha * 0.32);
          drawGlow(x, y, item.size * 7, [255, 245, 180], alpha * 0.68);
          scene.fill(255, 252, 218, alpha);
          scene.circle(x, y, item.size * 1.5);
        });
        scene.blendMode(scene.BLEND);
        scene.pop();
        for (let i = 0; i < dust.length; i += 1) {
          const item = dust[i];
          const drift = Math.sin(t * item.speed + item.phase) * 12;
          const y = item.y + Math.sin(t * 0.22 + item.phase) * 7;
          const alpha = item.alpha * (1 - collapse * 0.65);
          scene.fill(255, 218, 176, alpha);
          scene.circle(item.x + drift, y, item.size);
        }
      }

      function drawEnvelope(t, collapse) {
        const open = easeOutCubic(p.constrain((t - 0.5) / 0.82, 0, 1));
        const fade = 1 - easeInOutCubic(p.constrain((t - 2.05) / 1.2, 0, 1));
        if (fade <= 0.01) return;
        const cx = p.width * 0.5;
        const cy = p.height * 0.44 + Math.sin(t * 1.1) * 4 + collapse * p.height * 0.26;
        const width = Math.min(220, p.width * 0.36);
        const height = width * 0.6;
        const alpha = 230 * fade;

        scene.push();
        scene.translate(cx, cy);
        scene.noStroke();
        scene.fill(0, 0, 0, 55 * fade);
        scene.rect(-width / 2 + 8, -height / 2 + 10, width, height, 9);
        scene.fill(255, 246, 222, alpha);
        scene.rect(-width / 2, -height / 2, width, height, 9);
        scene.stroke(148, 106, 75, 120 * fade);
        scene.strokeWeight(1.1);
        scene.line(-width / 2, -height / 2, 0, 8);
        scene.line(width / 2, -height / 2, 0, 8);
        scene.line(-width / 2, height / 2, -8, 4);
        scene.line(width / 2, height / 2, 8, 4);
        scene.noStroke();
        scene.fill(255, 222, 190, 170 * fade);
        scene.beginShape();
        scene.vertex(-width / 2, -height / 2);
        scene.vertex(0, -height / 2 - open * 72);
        scene.vertex(width / 2, -height / 2);
        scene.vertex(0, 8);
        scene.endShape(scene.CLOSE);
        scene.fill(157, 45, 40, 220 * fade);
        scene.circle(0, 10, 25);
        scene.fill(255, 240, 225, 180 * open * fade);
        scene.circle(0, 10, 9 + open * 4);
        scene.pop();
      }

      function updateRoseParticles(t, collapse) {
        const burst = p.constrain((t - 0.72) / 1.0, 0, 1);
        const dissolve = p.constrain((t - 1.55) / 1.15, 0, 1);
        const pull = easeInCubic(p.constrain((t - 2.0) / 1.65, 0, 1));
        if (burst <= 0) return;

        scene.push();
        drawMemoryBurstCore(t, burst, dissolve, pull);
        scene.blendMode(scene.ADD);
        roseParticles.forEach((rose) => {
          const origin = layout.envelope;
          const explosive = easeOutCubic(burst);
          const memoryX = origin.x + rose.vx * explosive + Math.sin(t * rose.wobble + rose.phase) * 18 * (1 - pull);
          const memoryY = origin.y + rose.vy * explosive + rose.gravity * burst * burst;
          const galaxyX = p.lerp(memoryX, rose.sinkX, pull);
          const galaxyY = p.lerp(memoryY, layout.waterY + rose.sinkDepth, pull);
          const alpha = rose.alpha * (1 - dissolve * 0.7) * (1 - pull * 0.86);
          const size = rose.size * (0.55 + explosive * 0.75) * (1 - pull * 0.45);
          if (alpha <= 1 || size <= 0.5) return;
          drawRoseParticle(galaxyX, galaxyY, size, rose.color, alpha, rose.rotation + t * rose.spin);
          if (rose.index % 7 === 0) {
            scene.stroke(255, 204, 215, alpha * 0.12);
            scene.line(origin.x, origin.y, galaxyX, galaxyY);
          }
        });
        scene.blendMode(scene.BLEND);
        scene.pop();
      }

      function drawMemoryBurstCore(t, burst, dissolve, pull) {
        const origin = layout.envelope;
        const flash = Math.sin(p.constrain((t - 0.72) / 0.2, 0, 1) * p.PI);
        if (flash > 0.01) {
          scene.push();
          scene.blendMode(scene.ADD);
          drawGlow(origin.x, origin.y, p.width * 0.18, [255, 255, 255], 240 * flash);
          drawGlow(origin.x, origin.y, p.width * 0.08, [255, 245, 220], 180 * flash);
          scene.blendMode(scene.BLEND);
          scene.pop();
        }

        const release = Math.sin(p.constrain(burst, 0, 1) * p.PI) * (1 - dissolve * 0.45) * (1 - pull * 0.5);
        if (release <= 0.01) return;
        scene.push();
        scene.blendMode(scene.ADD);
        drawGlow(origin.x, origin.y, p.width * (0.26 + burst * 0.34), [255, 142, 172], 120 * release);
        drawGlow(origin.x, origin.y - 18, p.width * (0.16 + burst * 0.18), [255, 220, 175], 86 * release);
        scene.noFill();
        for (let ring = 0; ring < 8; ring += 1) {
          const radius = (24 + burst * p.width * (0.12 + ring * 0.024)) * (1 + ring * 0.07);
          scene.stroke(255, ring % 2 ? 198 : 232, ring % 2 ? 210 : 184, release * (72 - ring * 6));
          scene.strokeWeight(Math.max(0.55, 1.05 - ring * 0.05));
          scene.ellipse(origin.x, origin.y, radius * 1.65, radius * 0.72);
        }
        for (let i = 0; i < 32; i += 1) {
          const angle = (i / 32) * p.TWO_PI + t * 0.34;
          const inner = 18 + burst * 28;
          const outer = 70 + burst * p.width * 0.28 + Math.sin(i * 1.7) * 18;
          scene.stroke(255, 198, 214, release * 30);
          scene.line(
            origin.x + Math.cos(angle) * inner,
            origin.y + Math.sin(angle) * inner * 0.68,
            origin.x + Math.cos(angle) * outer,
            origin.y + Math.sin(angle) * outer * 0.68,
          );
        }
        scene.blendMode(scene.BLEND);
        scene.pop();
      }

      function drawWaterSurface(t, collapse) {
        if (collapse < 0.04) return;
        const calm = 1 - easeInOutCubic(p.constrain((t - 11.4) / 3.2, 0, 1));
        const surfaceAlpha = 78 * collapse * (0.55 + calm * 0.45);
        scene.push();
        scene.noFill();
        scene.blendMode(scene.ADD);
        scene.strokeWeight(1);
        scene.stroke(255, 214, 188, surfaceAlpha * 0.28);
        scene.line(p.width * 0.06, layout.waterY, p.width * 0.94, layout.waterY);

        for (let row = 0; row < 11; row += 1) {
          const baseY = layout.waterY + 16 + row * Math.max(12, p.height * 0.025);
          if (baseY > p.height - 20) break;
          const depth = row / 10;
          const alpha = surfaceAlpha * (1 - depth * 0.68);
          scene.stroke(row % 2 ? 126 : 188, row % 2 ? 184 : 220, 255, alpha * 0.42);
          scene.beginShape();
          for (let x = -24; x <= p.width + 24; x += 24) {
            const wave = Math.sin(x * 0.017 + t * (0.9 - depth * 0.34) + row) * (3.2 + calm * 2.2);
            const slow = Math.sin(x * 0.006 - t * 0.45 + row * 2.1) * 5.5 * (1 - depth * 0.35);
            const ripple = rippleSurfaceOffset(x, baseY, t) * collapse;
            scene.curveVertex(x, baseY + wave + slow + ripple);
          }
          scene.endShape();
        }

        for (let i = 0; i < 46; i += 1) {
          const x = (i * 83 + t * 14) % p.width;
          const y = layout.waterY + 18 + ((i * 47) % Math.max(60, p.height * 0.32));
          const pulse = 0.42 + Math.sin(t * 1.4 + i) * 0.22;
          scene.fill(174, 214, 255, 22 * collapse * pulse);
          scene.circle(x, y, 1.2 + (i % 3) * 0.7);
        }
        scene.blendMode(scene.BLEND);
        scene.pop();
      }

      function rippleSurfaceOffset(x, y, t) {
        let offset = 0;
        ripples.forEach((ripple) => {
          const age = t - ripple.born;
          if (age < 0 || age > 3.2) return;
          const radius = age * 74 * ripple.strength;
          const dx = x - ripple.x;
          const dy = (y - ripple.y) * 3.1;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const ring = Math.max(0, 1 - Math.abs(distance - radius) / 22);
          const fade = 1 - age / 3.2;
          offset += Math.sin(distance * 0.12 - age * 7.4) * ring * fade * 8 * ripple.strength;
        });
        return offset;
      }

      function updateGlyphStars(t, collapse) {
        const active = easeInOutCubic(p.constrain((t - 1.85) / 1.15, 0, 1));
        if (active <= 0) return;
        const fadeOut = 1 - easeInOutCubic(p.constrain((t - 13.4) / 2.2, 0, 1));
        const states = [];

        glyphStars.forEach((star) => {
          const local = p.constrain((t - star.start) / star.duration, 0, 1);
          if (local <= 0) return;
          const fall = easeInOutCubic(local);
          const sway = Math.sin(t * star.swaySpeed + star.phase) * star.sway * (1 - fall * 0.45);
          const wordBreath = star.isLetter ? Math.sin((1 - fall) * p.PI) * star.wordLift : 0;
          const x = p.lerp(star.skyX, star.waterX, fall) + sway;
          const y = p.lerp(star.skyY, star.waterY, fall);
          const alpha = (star.isLetter ? 232 : 178) * active * fadeOut * star.alphaScale;
          const rotate = star.rotation + t * star.spin;

          if (!star.impacted && local >= 1) {
            star.impacted = true;
            ripples.push({
              x,
              y: star.impactY || layout.waterY,
              born: t,
              strength: star.isLetter ? 1.06 : 0.62,
            });
            if (t - lastChimeAt > 0.07 && chimeCount < 64) {
              lastChimeAt = t;
              chimeCount += 1;
              playWaterChime(star.isLetter ? 1 : 0.65, p.map(x, 0, p.width, -0.65, 0.65));
            }
          }

          states.push({ star, x, y: y - wordBreath, alpha, rotate, fall });
        });

        scene.push();
        drawWordConnections(states);
        states.forEach((state) => {
          if (state.y < layout.waterY + 10) {
            drawStarOrLetter(state.x, state.y, state.star, state.alpha, state.rotate);
          }
          drawReflection(state.x, state.y, state.star, state.alpha * 0.72, state.rotate, t);
        });
        scene.pop();
      }

      function drawWordConnections(states) {
        const lastByWord = new Map();
        scene.push();
        scene.blendMode(scene.ADD);
        scene.strokeWeight(0.75);
        states
          .filter((state) => state.star.isLetter && state.star.wordId)
          .sort((a, b) => a.star.order - b.star.order)
          .forEach((state) => {
            const previous = lastByWord.get(state.star.wordId);
            if (
              previous &&
              state.star.letterInWord === previous.star.letterInWord + 1 &&
              state.y < layout.waterY + 8 &&
              previous.y < layout.waterY + 8
            ) {
              const distance = Math.hypot(state.x - previous.x, state.y - previous.y);
              if (distance < 120) {
                const alpha = Math.min(state.alpha, previous.alpha) * 0.18 * (1 - Math.max(state.fall, previous.fall) * 0.42);
                scene.stroke(255, 203, 150, alpha);
                scene.line(previous.x, previous.y, state.x, state.y);
              }
            }
            lastByWord.set(state.star.wordId, state);
          });
        scene.blendMode(scene.BLEND);
        scene.pop();
      }

      function drawRipples(t, collapse) {
        if (collapse < 0.05) return;
        scene.push();
        scene.noFill();
        scene.blendMode(scene.ADD);
        ripples = ripples.filter((ripple) => t - ripple.born < 3.4);
        ripples.forEach((ripple) => {
          const age = t - ripple.born;
          const fade = Math.max(0, 1 - age / 3.4);
          const radius = age * 74 * ripple.strength;
          const alpha = 138 * fade * collapse;
          drawGlow(ripple.x, ripple.y, radius * 0.92, [128, 187, 255], alpha * 0.12);
          for (let ring = 0; ring < 3; ring += 1) {
            const r = radius * (1 + ring * 0.34);
            const ringAlpha = alpha * (1 - ring * 0.27);
            scene.stroke(186, 224, 255, ringAlpha);
            scene.strokeWeight(Math.max(0.55, 1.35 - ring * 0.28));
            scene.ellipse(ripple.x, ripple.y, r * 2.55, r * 0.5);
          }
          scene.stroke(255, 216, 232, alpha * 0.46);
          scene.strokeWeight(0.8);
          scene.arc(ripple.x, ripple.y, radius * 1.8, radius * 0.36, p.PI * 0.08, p.PI * 0.9);
        });
        scene.blendMode(scene.BLEND);
        scene.pop();
      }

      function drawBoatAndPaper(t) {
        const appear = easeOutCubic(p.constrain((t - 9.4) / 1.4, 0, 1));
        if (appear <= 0) return;
        const paper = easeInOutCubic(p.constrain((t - 11.2) / 2.6, 0, 1));
        const cx = p.width * 0.5 + Math.sin(t * 0.34) * 12 * (1 - paper);
        const cy = layout.waterY + p.height * 0.13 + Math.sin(t * 0.7) * 3;
        const boatW = Math.min(144, p.width * 0.28);
        const paperW = Math.min(430, p.width * 0.66);
        const paperH = Math.min(300, p.height * 0.48);

        scene.push();
        scene.translate(cx, cy);
        scene.noStroke();
        scene.fill(255, 255, 255, 220 * appear * (1 - paper));
        scene.beginShape();
        scene.vertex(-boatW / 2, -8);
        scene.vertex(boatW / 2, -8);
        scene.vertex(boatW * 0.28, 20);
        scene.vertex(-boatW * 0.28, 20);
        scene.endShape(scene.CLOSE);
        scene.fill(225, 235, 250, 170 * appear * (1 - paper));
        scene.triangle(-boatW * 0.44, -8, -5, -54, 8, -8);
        scene.triangle(10, -8, boatW * 0.4, -46, boatW * 0.45, -8);

        if (paper > 0) {
          const w = p.lerp(boatW, paperW, paper);
          const h = p.lerp(64, paperH, paper);
          scene.fill(255, 248, 232, 225 * paper);
          scene.rect(-w / 2, -h / 2, w, h, 7);
          scene.stroke(157, 45, 40, 34 * paper);
          scene.strokeWeight(1);
          for (let y = -h / 2 + 42; y < h / 2 - 18; y += 28) {
            scene.line(-w / 2 + 28, y, w / 2 - 28, y);
          }
          drawFinalPaperText(-w / 2 + 30, -h / 2 + 28, w - 60, h - 54, paper);
        }
        scene.pop();
      }

      function drawFinalPaperText(x, y, width, height, alpha) {
        scene.push();
        scene.textFont("Georgia");
        scene.noStroke();
        const textAlpha = 235 * easeOutCubic(p.constrain((alpha - 0.35) / 0.65, 0, 1));
        scene.fill(23, 33, 29, textAlpha);
        scene.textAlign(scene.LEFT, scene.TOP);
        scene.textSize(layout.paperSize);
        scene.textLeading(layout.paperLeading);
        const maxLines = Math.max(2, Math.floor(height / layout.paperLeading));
        const lines = layout.paperLines.slice(0, maxLines);
        lines.forEach((line, index) => {
          scene.text(line, x, y + index * layout.paperLeading, width);
        });
        scene.pop();
      }

      function drawStarOrLetter(x, y, star, alpha, rotation) {
        scene.push();
        scene.translate(x, y);
        scene.rotate(rotation);
        scene.blendMode(scene.ADD);
        if (star.isLetter) {
          drawGlow(0, 0, star.size * 10, [255, 228, 177], alpha * 0.55);
          scene.fill(255, 252, 230, alpha);
          scene.noStroke();
          scene.textFont("Georgia");
          scene.textAlign(scene.CENTER, scene.CENTER);
          scene.textSize(star.size * 2.8);
          scene.text(star.char, 0, 0);
          const seed = star.char.charCodeAt(0);
          for (let i = 0; i < 5; i += 1) {
            const angle = (seed * 0.7 + i / 5) * Math.PI * 2 + rotation * 0.6;
            const dist = star.size * (0.9 + (i % 3) * 0.4);
            const px = Math.cos(angle) * dist;
            const py = Math.sin(angle) * dist;
            const particleAlpha = alpha * (0.28 + (i % 2) * 0.22);
            drawGlow(px, py, star.size * 2.2, [255, 200, 140], particleAlpha * 0.7);
            scene.fill(255, 230, 180, particleAlpha);
            scene.circle(px, py, star.size * 0.55);
          }
        } else {
          drawGlow(0, 0, star.size * 7, [176, 208, 255], alpha * 0.56);
          scene.fill(255, 248, 218, alpha);
          scene.noStroke();
          drawTinyStar(0, 0, star.size * 0.45, star.size * 1.3, 5);
        }
        scene.blendMode(scene.BLEND);
        scene.pop();
      }

      function drawReflection(x, y, star, alpha, rotation, t) {
        if (y < layout.waterY - 36) return;
        const depth = Math.abs(y - layout.waterY);
        const reflectedY = layout.waterY + depth * 0.65 + 12;
        if (reflectedY > p.height - 10) return;

        let rippleBend = 0;
        ripples.forEach((ripple) => {
          const age = t - ripple.born;
          const reach = 80 + age * 60;
          const influence = Math.max(0, 1 - Math.abs(x - ripple.x) / reach) * Math.max(0, 1 - age / 3.4);
          rippleBend += Math.sin(Math.abs(x - ripple.x) * 0.1 - age * 6.2) * influence * 28 * ripple.strength;
        });
        const shimmerX = Math.sin(x * 0.031 + t * 1.8 + star.phase) * 14 + Math.sin(x * 0.017 - t * 2.4) * 7;

        scene.push();
        scene.translate(x + rippleBend + shimmerX, reflectedY);
        scene.scale(1.18, -0.38);
        scene.rotate(-rotation * 0.3);
        scene.blendMode(scene.ADD);
        const reflectionColor = star.isLetter ? [255, 190, 130] : [140, 190, 255];
        drawGlow(0, 0, star.size * (star.isLetter ? 9 : 6), reflectionColor, alpha * 0.65);
        scene.fill(reflectionColor[0], reflectionColor[1], reflectionColor[2], alpha * 0.72);
        scene.noStroke();
        if (star.isLetter) {
          scene.textFont("Georgia");
          scene.textAlign(scene.CENTER, scene.CENTER);
          scene.textSize(star.size * 2.5);
          scene.text(star.char, 0, 0);
        } else {
          scene.ellipse(0, 0, star.size * 1.8, star.size * 0.9);
        }
        scene.blendMode(scene.BLEND);
        scene.pop();
      }

      function buildLetterLayout() {
        const waterY = p.height * 0.62;
        const envelope = { x: p.width * 0.5, y: p.height * 0.45 };
        const measure = p.createGraphics(10, 10);
        measure.textFont("Georgia");
        const paperWidth = Math.min(430, p.width * 0.66) - 60;
        let paperSize = Math.min(19, Math.max(12, p.width / 48));
        let paperLeading = paperSize * 1.45;
        measure.textSize(paperSize);
        const fullText = [
          plaintext.recipient ? `To ${plaintext.recipient}` : "",
          plaintext.title || "Untitled letter",
          "",
          plaintext.message || "",
        ].filter((line, index) => index < 3 || String(line).trim()).join("\n");
        const paperLines = [];
        fullText.split("\n").forEach((paragraph) => {
          if (!paragraph.trim()) {
            paperLines.push("");
            return;
          }
          paperLines.push(...wrapWords(measure, paragraph.trim(), paperWidth));
        });

        const glyphs = buildGlyphConstellations(measure, paperLines, paperWidth, paperSize);
        measure.remove();
        return { waterY, envelope, paperLines, paperSize, paperLeading, glyphs };
      }

      function buildGlyphConstellations(measure, paperLines, paperWidth) {
        const glyphLimit = p.width < 680 ? 260 : 520;
        const glyphs = [];
        let order = 0;
        let wordOrder = 0;

        paperLines.forEach((line, lineIndex) => {
          if (!line.trim() || glyphs.length >= glyphLimit) {
            wordOrder += 1;
            return;
          }

          const spans = [];
          line.replace(/\S+/g, (word, offset) => {
            spans.push({ start: offset, end: offset + word.length, index: spans.length });
            return word;
          });

          const rawWidth = Math.max(1, measure.textWidth(line));
          const scale = Math.min(1, Math.min(paperWidth, p.width * 0.76) / rawWidth);
          const startX = p.width * 0.5 - (rawWidth * scale) / 2;
          let cursor = 0;

          for (let charIndex = 0; charIndex < line.length && glyphs.length < glyphLimit; charIndex += 1) {
            const char = line.charAt(charIndex);
            const charWidth = measure.textWidth(char || " ");
            const span = spans.find((entry) => charIndex >= entry.start && charIndex < entry.end);
            if (char.trim() && span) {
              glyphs.push({
                char,
                lineIndex,
                wordId: `${lineIndex}-${span.index}`,
                wordOrder: wordOrder + span.index,
                letterInWord: charIndex - span.start,
                wordLength: span.end - span.start,
                order,
                sceneX: startX + (cursor + charWidth * 0.5) * scale,
              });
              order += 1;
            }
            cursor += charWidth;
          }

          wordOrder += Math.max(1, spans.length);
        });

        return glyphs;
      }

      function buildRoseParticles() {
        const count = p.width < 680 ? 620 : 1180;
        const list = [];
        for (let i = 0; i < count; i += 1) {
          const angle = p.random(-p.PI * 0.96, -p.PI * 0.04);
          const power = p.random(84, p.width * 0.52);
          list.push({
            index: i,
            vx: Math.cos(angle) * power,
            vy: Math.sin(angle) * power * p.random(0.65, 1.22),
            gravity: p.random(34, 210),
            sinkX: p.random(p.width * 0.08, p.width * 0.92),
            sinkDepth: p.random(-30, p.height * 0.28),
            size: p.random(1.8, 7.4),
            alpha: p.random(20, 86),
            rotation: p.random(p.TWO_PI),
            spin: p.random(-1.2, 1.2),
            wobble: p.random(1.2, 3.4),
            phase: p.random(p.TWO_PI),
            color: roseColors[i % roseColors.length],
          });
        }
        return list;
      }

      function buildGlyphStars() {
        const list = [];
        const glyphs = layout.glyphs;
        const totalLetters = Math.max(1, glyphs.length - 1);
        glyphs.forEach((glyph) => {
          const sequence = glyph.order / totalLetters;
          const wordDrift = Math.sin(glyph.wordOrder * 1.47) * p.width * 0.035;
          const skyX = p.constrain(glyph.sceneX + wordDrift + p.random(-14, 14), p.width * 0.06, p.width * 0.94);
          const waterX = p.constrain(glyph.sceneX + p.random(-9, 9), p.width * 0.08, p.width * 0.92);
          const impactY = layout.waterY + p.random(-12, 18);
          list.push({
            char: glyph.char,
            isLetter: true,
            wordId: glyph.wordId,
            wordOrder: glyph.wordOrder,
            letterInWord: glyph.letterInWord,
            order: glyph.order,
            skyX,
            skyY: p.random(-170, -26) + (glyph.lineIndex % 5) * 18,
            waterX,
            waterY: impactY + p.random(-5, 9),
            impactY,
            size: p.random(8.2, p.width < 680 ? 12.6 : 14.2),
            start: 1.9 + sequence * 4.8 + glyph.letterInWord * 0.012 + p.random(0, 0.18),
            duration: p.random(4.5, 6.9),
            phase: p.random(p.TWO_PI),
            sway: p.random(8, 28),
            swaySpeed: p.random(0.24, 0.54),
            spin: p.random(-0.18, 0.18),
            rotation: p.random(-0.8, 0.8),
            wordLift: p.random(5, 16),
            alphaScale: p.random(0.82, 1.0),
            impacted: false,
          });
        });

        const pureCount = p.width < 680 ? 95 : 170;
        for (let i = 0; i < pureCount; i += 1) {
          const impactY = layout.waterY + p.random(-16, 22);
          list.push({
            char: "*",
            isLetter: false,
            order: glyphs.length + i,
            skyX: p.random(p.width * 0.08, p.width * 0.92),
            skyY: p.random(-190, p.height * 0.18),
            waterX: p.random(p.width * 0.1, p.width * 0.9),
            waterY: impactY + p.random(-6, 10),
            impactY,
            size: p.random(2.0, 4.8),
            start: p.random(1.95, 8.2),
            duration: p.random(4.2, 7.2),
            phase: p.random(p.TWO_PI),
            sway: p.random(12, 46),
            swaySpeed: p.random(0.28, 0.72),
            spin: p.random(-0.34, 0.34),
            rotation: p.random(-0.8, 0.8),
            wordLift: 0,
            alphaScale: p.random(0.58, 0.94),
            impacted: false,
          });
        }
        return list;
      }

      function buildDust() {
        const list = [];
        for (let i = 0; i < 90; i += 1) {
          list.push({
            x: p.random(p.width),
            y: p.random(p.height * 0.05, p.height * 0.55),
            size: p.random(0.8, 2.4),
            alpha: p.random(12, 45),
            phase: p.random(p.TWO_PI),
            speed: p.random(0.35, 1.1),
          });
        }
        return list;
      }

      function buildFireflies() {
        const list = [];
        const count = p.width < 680 ? 46 : 78;
        for (let i = 0; i < count; i += 1) {
          list.push({
            x: p.random(-20, p.width + 20),
            y: p.random(p.height * 0.08, layout.waterY - 22),
            size: p.random(0.9, 2.5),
            alpha: p.random(18, 62),
            phase: p.random(p.TWO_PI),
            speed: p.random(0.08, 0.42),
            drift: p.random(12, 48),
            float: p.random(5, 18),
            floatSpeed: p.random(0.18, 0.46),
            twinkle: p.random(1.2, 2.8),
            wander: p.random(0.24, 0.68),
          });
        }
        return list;
      }

      function wrapWords(g, paragraph, maxWidth) {
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

      function drawRoseParticle(x, y, size, color, alpha, rotation) {
        scene.push();
        scene.translate(x, y);
        scene.rotate(rotation);
        drawGlow(0, 0, size * 5.2, color, alpha * 0.18);
        scene.noStroke();
        scene.fill(color[0], color[1], color[2], alpha);
        for (let i = 0; i < 5; i += 1) {
          scene.push();
          scene.rotate((i / 5) * p.TWO_PI);
          scene.ellipse(size * 0.25, 0, size * 0.9, size * 0.45);
          scene.pop();
        }
        scene.fill(255, 230, 224, alpha * 0.72);
        scene.circle(0, 0, size * 0.45);
        scene.pop();
      }

      function drawGlow(x, y, radius, color, alpha) {
        scene.noStroke();
        for (let i = 4; i >= 1; i -= 1) {
          const a = alpha * (0.07 + i * 0.035);
          scene.fill(color[0], color[1], color[2], a);
          scene.circle(x, y, radius * i * 0.5);
        }
      }

      function drawTinyStar(x, y, innerRadius, outerRadius, points) {
        scene.beginShape();
        for (let i = 0; i < points * 2; i += 1) {
          const angle = -p.HALF_PI + (i * p.PI) / points;
          const radius = i % 2 === 0 ? outerRadius : innerRadius;
          scene.vertex(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
        }
        scene.endShape(scene.CLOSE);
      }

      function emotionalShake(t) {
        const amount = 5.5 * (1 - p.constrain(Math.abs(t - 0.95) / 0.52, 0, 1));
        return {
          x: Math.sin(t * 73) * amount,
          y: Math.cos(t * 57) * amount * 0.65,
        };
      }

      function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
      }

      function easeInCubic(t) {
        return t * t * t;
      }

      function easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
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
