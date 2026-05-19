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
    window.clearTimeout(state.revealTimer);
    state.currentRiver = { record, plaintext };
    renderRiverLetter(plaintext);
    showView("river");
    playUnlockBloom();
    destroyRiverSketch();
    state.riverSketch = createRiverSketch(plaintext);
    state.revealTimer = window.setTimeout(() => {
      el.riverLetter.classList.remove("is-revealing");
    }, 12800);
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

        void main() {
          vec2 uv = vUv;
          float waterLine = 0.58;
          float warm = 1.0 - smoothstep(0.18, 0.72, uv.y);
          float water = smoothstep(waterLine - 0.04, waterLine + 0.08, uv.y);
          float wave = sin((uv.x * 24.0) + u_time * 0.45) * 0.006;
          wave += sin((uv.x * 9.0) - u_time * 0.22) * 0.009;

          vec3 darkTop = mix(vec3(0.035, 0.02, 0.055), vec3(0.03, 0.035, 0.12), u_collapse);
          vec3 warmGlow = vec3(0.45, 0.16, 0.18) * warm * (1.0 - u_collapse * 0.72);
          vec3 galaxy = vec3(0.018, 0.03, 0.08);
          galaxy += vec3(0.035, 0.06, 0.18) * smoothstep(0.1, 0.95, uv.y);
          galaxy += vec3(0.08, 0.035, 0.13) * smoothstep(0.25, 0.85, sin(uv.x * 4.2 + uv.y * 5.0 + u_time * 0.04) * 0.5 + 0.5) * u_collapse * 0.38;

          vec3 color = mix(darkTop + warmGlow, galaxy, u_collapse);
          vec3 waterColor = vec3(0.008, 0.018, 0.055) + vec3(0.025, 0.055, 0.16) * (1.0 - uv.y + wave);
          color = mix(color, waterColor, water * u_collapse);

          float stars = softStar(uv + vec2(u_time * 0.002, 0.0), 88.0);
          stars += softStar(uv + vec2(0.13, u_time * 0.001), 142.0) * 0.75;
          color += vec3(0.86, 0.91, 1.0) * stars * u_collapse;

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
        p.quad(-1, -1, 1, -1, 1, 1, -1, 1);
      }

      function drawSceneBuffer(t, collapse) {
        scene.clear();
        const shake = emotionalShake(t);
        scene.push();
        scene.translate(shake.x, shake.y);
        drawUpperAtmosphere(t, collapse);
        drawEnvelope(t, collapse);
        updateRoseParticles(t, collapse);
        updateGlyphStars(t, collapse);
        drawRipples(t, collapse);
        drawBoatAndPaper(t);
        scene.pop();
      }

      function drawUpperAtmosphere(t, collapse) {
        scene.noStroke();
        const glowAlpha = 92 * (1 - collapse);
        drawGlow(p.width * 0.5, p.height * 0.36, p.width * 0.5, [240, 142, 159], glowAlpha);
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
        scene.blendMode(scene.BLEND);
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
            scene.stroke(255, 204, 215, alpha * 0.18);
            scene.line(origin.x, origin.y, galaxyX, galaxyY);
          }
        });
        scene.pop();
      }

      function updateGlyphStars(t, collapse) {
        const active = easeInOutCubic(p.constrain((t - 2.7) / 1.25, 0, 1));
        if (active <= 0) return;

        scene.push();
        glyphStars.forEach((star) => {
          const local = p.constrain((t - star.start) / star.duration, 0, 1);
          if (local <= 0) return;
          const fall = easeInOutCubic(local);
          const sway = Math.sin(t * star.swaySpeed + star.phase) * star.sway * (1 - fall * 0.45);
          const x = p.lerp(star.skyX, star.waterX, fall) + sway;
          const y = p.lerp(star.skyY, star.waterY, fall);
          const alpha = 210 * active * (1 - p.constrain((t - 11.3) / 1.8, 0, 1));
          const rotate = star.rotation + t * star.spin;

          if (!star.impacted && local >= 1) {
            star.impacted = true;
            ripples.push({ x, y: layout.waterY, born: t, strength: star.isLetter ? 1.0 : 0.62 });
            if (t - lastChimeAt > 0.08 && chimeCount < 42) {
              lastChimeAt = t;
              chimeCount += 1;
              playWaterChime(star.isLetter ? 1 : 0.65, p.map(x, 0, p.width, -0.65, 0.65));
            }
          }

          if (y < layout.waterY + 8) {
            drawStarOrLetter(x, y, star, alpha, rotate);
          }
          drawReflection(x, y, star, alpha * 0.42, rotate, t);
        });
        scene.pop();
      }

      function drawRipples(t, collapse) {
        if (collapse < 0.35) return;
        scene.push();
        scene.noFill();
        ripples = ripples.filter((ripple) => t - ripple.born < 2.4);
        ripples.forEach((ripple) => {
          const age = t - ripple.born;
          const radius = age * 46 * ripple.strength;
          const alpha = 115 * (1 - age / 2.4) * collapse;
          scene.stroke(180, 215, 255, alpha);
          scene.strokeWeight(1);
          scene.ellipse(ripple.x, ripple.y, radius * 2.4, radius * 0.52);
          scene.stroke(255, 220, 235, alpha * 0.42);
          scene.ellipse(ripple.x, ripple.y, radius * 1.3, radius * 0.28);
        });
        scene.pop();
      }

      function drawBoatAndPaper(t) {
        const appear = easeOutCubic(p.constrain((t - 8.1) / 1.2, 0, 1));
        if (appear <= 0) return;
        const paper = easeInOutCubic(p.constrain((t - 10.1) / 2.2, 0, 1));
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
        drawGlow(0, 0, star.size * 7, star.isLetter ? [255, 237, 190] : [176, 208, 255], alpha * 0.55);
        scene.fill(255, 248, 218, alpha);
        scene.noStroke();
        if (star.isLetter) {
          scene.textFont("Georgia");
          scene.textAlign(scene.CENTER, scene.CENTER);
          scene.textSize(star.size * 2.6);
          scene.text(star.char, 0, 0);
        } else {
          drawTinyStar(0, 0, star.size * 0.45, star.size * 1.3, 5);
        }
        scene.blendMode(scene.BLEND);
        scene.pop();
      }

      function drawReflection(x, y, star, alpha, rotation, t) {
        if (y < layout.waterY - 26) return;
        const reflectedY = layout.waterY + Math.abs(y - layout.waterY) * 0.55 + 8;
        let rippleBend = 0;
        ripples.forEach((ripple) => {
          const age = t - ripple.born;
          const reach = 58 + age * 52;
          const influence = Math.max(0, 1 - Math.abs(x - ripple.x) / reach) * Math.max(0, 1 - age / 2.4);
          rippleBend += Math.sin(Math.abs(x - ripple.x) * 0.11 - age * 5.2) * influence * 18 * ripple.strength;
        });
        const rippleOffset = Math.sin((x * 0.024) + t * 2.2 + star.phase) * 8 + rippleBend;
        scene.push();
        scene.translate(x + rippleOffset, reflectedY);
        scene.scale(1, -0.42);
        scene.rotate(-rotation * 0.4);
        scene.fill(180, 210, 255, alpha);
        scene.noStroke();
        if (star.isLetter) {
          scene.textFont("Georgia");
          scene.textAlign(scene.CENTER, scene.CENTER);
          scene.textSize(star.size * 2.3);
          scene.text(star.char, 0, 0);
        } else {
          scene.ellipse(0, 0, star.size * 1.5, star.size * 0.8);
        }
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

        const glyphSource = [...`${plaintext.title || ""} ${plaintext.message || ""}`].filter((char) => char.trim());
        const cappedGlyphs = glyphSource.slice(0, p.width < 680 ? 180 : 340);
        measure.remove();
        return { waterY, envelope, paperLines, paperSize, paperLeading, glyphs: cappedGlyphs };
      }

      function buildRoseParticles() {
        const count = p.width < 680 ? 360 : 760;
        const list = [];
        for (let i = 0; i < count; i += 1) {
          const angle = p.random(-p.PI * 0.96, -p.PI * 0.04);
          const power = p.random(70, p.width * 0.45);
          list.push({
            index: i,
            vx: Math.cos(angle) * power,
            vy: Math.sin(angle) * power * p.random(0.65, 1.22),
            gravity: p.random(40, 180),
            sinkX: p.random(p.width * 0.08, p.width * 0.92),
            sinkDepth: p.random(-30, p.height * 0.28),
            size: p.random(2.2, 6.8),
            alpha: p.random(28, 92),
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
        const glyphs = layout.glyphs.length ? layout.glyphs : ["*"];
        const count = Math.max(glyphs.length, p.width < 680 ? 130 : 230);
        const list = [];
        for (let i = 0; i < count; i += 1) {
          const isLetter = i < glyphs.length && i % 2 !== 0;
          list.push({
            char: isLetter ? glyphs[i % glyphs.length] : "*",
            isLetter,
            skyX: p.random(p.width * 0.12, p.width * 0.88),
            skyY: p.random(-120, p.height * 0.22),
            waterX: p.random(p.width * 0.12, p.width * 0.88),
            waterY: layout.waterY + p.random(-18, 24),
            size: isLetter ? p.random(7, 12) : p.random(2.0, 4.4),
            start: 2.8 + i * (p.width < 680 ? 0.028 : 0.018) + p.random(0, 1.2),
            duration: p.random(3.2, 5.6),
            phase: p.random(p.TWO_PI),
            sway: p.random(12, 42),
            swaySpeed: p.random(0.38, 0.82),
            spin: p.random(-0.28, 0.28),
            rotation: p.random(-0.8, 0.8),
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
