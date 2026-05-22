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
    state.currentRiver = { record, plaintext };
    renderRiverLetter();
    showView("river");
    playUnlockBloom();
    destroyRiverSketch();
    state.riverSketch = createRiverSketch(plaintext);
  }

  function renderRiverLetter() {
    el.riverLetter.classList.remove("is-revealing");
    el.riverLetter.style.transition = "none";
    el.riverLetter.style.opacity = "0";
    el.riverLetter.style.pointerEvents = "none";
    el.riverLetter.setAttribute("aria-hidden", "true");
    el.riverRecipient.textContent = "";
    el.riverLetterTitle.textContent = "";
    el.riverLetterMessage.textContent = "";
  }

  function destroyRiverSketch() {
    if (!state.riverSketch) return;
    if (typeof state.riverSketch.cleanup === "function") state.riverSketch.cleanup();
    state.riverSketch.remove();
    state.riverSketch = null;
  }

  function createRiverSketch(plaintext) {
    return new window.p5((p) => {
      const MICRO_COLORS = [
        { rgb: [255, 248, 232], alpha: 1 },
        { rgb: [244, 200, 69], alpha: 1 },
        { rgb: [185, 200, 197], alpha: 1 },
        { rgb: [255, 255, 255], alpha: 0.9 },
      ];

      let backgroundLayer = null;
      let layout = null;
      let characterParticles = [];
      let microParticles = [];
      let ambientStream = [];
      let sparkles = [];
      let nebulaWisps = [];
      let startMillis = 0;
      let lastMillis = 0;
      let sparkleTarget = 40;
      let lastChimeAt = 0;
      let chimeCount = 0;

      p.setup = () => {
        p.pixelDensity(1);
        p.frameRate(60);
        const canvas = p.createCanvas(
          Math.max(320, el.riverCanvas.clientWidth),
          Math.max(440, el.riverCanvas.clientHeight),
        );
        canvas.parent(el.riverCanvas);
        p.textFont("Georgia");
        resetScene();
      };

      p.draw = () => {
        const t = elapsed();
        const now = p.millis();
        const dt = Math.min(2, Math.max(0.25, (now - lastMillis) / 16.67));
        lastMillis = now;

        p.blendMode(p.BLEND);
        p.drawingContext.drawImage(backgroundLayer, 0, 0, p.width, p.height);
        updateNebulaWisps(dt);
        drawNebulaWisps();
        drawRiverGlow(t);
        drawAmbientRiver(t);
        updateMicroParticles(t);
        updateCharacterParticles(t);
        drawBoat(t);
        updateSparkles(t);
      };

      p.windowResized = () => {
        const width = Math.max(320, el.riverCanvas.clientWidth);
        const height = Math.max(440, el.riverCanvas.clientHeight);
        p.resizeCanvas(width, height);
        resetScene();
      };

      p.cleanup = () => {
        backgroundLayer = null;
      };

      function resetScene() {
        startMillis = p.millis();
        lastMillis = startMillis;
        lastChimeAt = 0;
        chimeCount = 0;
        backgroundLayer = buildBackgroundLayer();
        layout = buildLetterLayout();
        characterParticles = buildCharacterParticles(layout.characters);
        microParticles = [];
        ambientStream = buildAmbientStream();
        nebulaWisps = buildNebulaWisps();
        sparkleTarget = Math.floor(p.random(30, 51));
        sparkles = [];
        while (sparkles.length < sparkleTarget) {
          sparkles.push(createSparkle(null, null, null, elapsed() - p.random(0, 1.1)));
        }
      }

      function elapsed() {
        return (p.millis() - startMillis) / 1000;
      }

      function buildBackgroundLayer() {
        const layer = document.createElement("canvas");
        layer.width = p.width;
        layer.height = p.height;
        const ctx = layer.getContext("2d");
        const gradient = ctx.createRadialGradient(
          p.width * 0.5,
          p.height * 0.48,
          0,
          p.width * 0.5,
          p.height * 0.5,
          Math.max(p.width, p.height) * 0.74,
        );
        gradient.addColorStop(0, "#040d21");
        gradient.addColorStop(1, "#000510");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, p.width, p.height);

        const starCount = Math.floor(p.random(140, 181));
        for (let i = 0; i < starCount; i += 1) {
          const radius = p.random(0.4, 1.2);
          const alpha = p.random(0.3, 0.9);
          ctx.fillStyle = `rgba(255,255,255,${alpha})`;
          ctx.beginPath();
          ctx.arc(p.random(p.width), p.random(p.height), radius, 0, Math.PI * 2);
          ctx.fill();
        }
        return layer;
      }

      function buildNebulaWisps() {
        const count = Math.floor(p.random(3, 6));
        const wisps = [];
        for (let i = 0; i < count; i += 1) {
          const angle = p.random(p.TWO_PI);
          const speed = p.random(0.08, 0.2);
          wisps.push({
            x: p.random(p.width),
            y: p.random(p.height * 0.16, p.height * 0.84),
            rx: p.random(80, 160),
            ry: p.random(34, 82),
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed * 0.42,
            rotation: p.random(-0.8, 0.8),
          });
        }
        return wisps;
      }

      function updateNebulaWisps(dt) {
        nebulaWisps.forEach((wisp) => {
          wisp.x += wisp.vx * dt;
          wisp.y += wisp.vy * dt;
          if (wisp.x < -wisp.rx) wisp.x = p.width + wisp.rx;
          if (wisp.x > p.width + wisp.rx) wisp.x = -wisp.rx;
          if (wisp.y < -wisp.ry) wisp.y = p.height + wisp.ry;
          if (wisp.y > p.height + wisp.ry) wisp.y = -wisp.ry;
        });
      }

      function drawNebulaWisps() {
        const ctx = p.drawingContext;
        nebulaWisps.forEach((wisp) => {
          ctx.save();
          ctx.translate(wisp.x, wisp.y);
          ctx.rotate(wisp.rotation);
          ctx.scale(wisp.rx, wisp.ry);
          const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
          gradient.addColorStop(0, "rgba(32,87,187,0.07)");
          gradient.addColorStop(1, "rgba(32,87,187,0)");
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(0, 0, 1, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        });
      }

      function buildLetterLayout() {
        const maxWidth = p.width * (p.width < 680 ? 0.9 : 0.72);
        const availableHeight = p.height * 0.44;
        const maxBase = Math.min(23, Math.max(12, p.width / 46));
        const minBase = p.width < 680 ? 4.2 : 5.4;
        let measured = null;

        for (let base = maxBase; base >= minBase; base -= 0.55) {
          measured = measureLines(base, maxWidth);
          if (measured.height <= availableHeight || base <= minBase + 0.01) break;
        }

        const x = (p.width - maxWidth) / 2;
        const y = Math.max(24, p.height * 0.07 + Math.max(0, availableHeight - measured.height) * 0.22);
        const characters = [];
        let cursorY = y;

        measured.lines.forEach((line) => {
          const lineHeight = line.blank ? measured.base * 0.82 : line.size * 1.34;
          if (!line.blank) {
            p.textSize(line.size);
            let cursorX = x;
            [...line.text].forEach((char) => {
              const charWidth = Math.max(1, p.textWidth(char || " "));
              characters.push({
                char,
                visible: /\S/.test(char),
                x: cursorX + charWidth / 2,
                y: cursorY + lineHeight * 0.52,
                size: line.size,
                section: line.section,
              });
              cursorX += charWidth;
            });
          }
          cursorY += lineHeight;
        });

        return { characters };
      }

      function measureLines(base, maxWidth) {
        const recipient = plaintext.recipient ? `To ${plaintext.recipient}` : "";
        const title = plaintext.title || "Untitled letter";
        const message = plaintext.message || "";
        const sections = [
          { section: "recipient", text: recipient, size: Math.max(4, base * 0.78) },
          { section: "title", text: title, size: Math.max(5, base * 1.36) },
          { section: "gap", text: "", size: base },
          { section: "message", text: message, size: base },
        ];
        const lines = [];
        let height = 0;

        sections.forEach((section) => {
          if (!section.text) {
            lines.push({ text: "", blank: true, size: section.size, section: section.section });
            height += base * 0.82;
            return;
          }
          p.textSize(section.size);
          wrapTextToLines(section.text, maxWidth).forEach((lineText) => {
            lines.push({ text: lineText, blank: false, size: section.size, section: section.section });
            height += section.size * 1.34;
          });
        });

        return { base, lines, height };
      }

      function wrapTextToLines(text, maxWidth) {
        const lines = [];
        String(text || "").split("\n").forEach((paragraph) => {
          if (!paragraph) {
            lines.push("");
            return;
          }

          let line = "";
          let lastSpace = -1;
          [...paragraph].forEach((char) => {
            line += char;
            if (/\s/.test(char)) lastSpace = line.length - 1;
            if (p.textWidth(line) > maxWidth && line.length > 1) {
              if (lastSpace > 0) {
                lines.push(line.slice(0, lastSpace));
                line = line.slice(lastSpace + 1);
              } else {
                lines.push(line.slice(0, -1));
                line = char;
              }
              lastSpace = line.search(/\s(?!.*\s)/);
            }
          });
          lines.push(line);
        });
        return lines;
      }

      function buildCharacterParticles(characters) {
        return characters.map((character, index) => new CharacterParticle(character, index, characters.length));
      }

      class CharacterParticle {
        constructor(character, index, total) {
          this.char = character.char;
          this.visible = character.visible;
          this.startX = character.x;
          this.startY = character.y;
          this.x = character.x;
          this.y = character.y;
          this.size = character.size;
          this.index = index;
          this.total = Math.max(1, total);
          this.targetU = p.constrain(character.x / p.width + p.random(-0.07, 0.07), 0.035, 0.965);
          this.startTime = 0.32 + (index / this.total) * Math.min(3.2, 0.9 + this.total * 0.0022) + p.random(0, 0.22);
          this.duration = p.random(1.8, 3.2) + p.constrain(character.y / p.height, 0, 1) * 0.35;
          this.tailLength = Math.floor(p.random(4, 7));
          this.tail = [];
          this.phase = p.random(p.TWO_PI);
          this.side = character.x < p.width * 0.5 ? 1 : -1;
          this.arc = p.random(18, 58) * this.side;
          this.spinDirection = p.random() > 0.5 ? 1 : -1;
          this.scale = 1;
          this.rotation = 0;
          this.dissolved = false;
        }

        update(t) {
          if (this.dissolved) return;
          if (t < this.startTime) {
            this.x = this.startX;
            this.y = this.startY;
            this.scale = 1;
            this.rotation = 0;
            return;
          }

          const local = p.constrain((t - this.startTime) / this.duration, 0, 1);
          const eased = easeInCubic(local);
          const target = riverPoint(this.targetU + Math.sin(this.phase + t * 0.22) * 0.012, t);
          const cometArc = Math.sin(local * p.PI) * this.arc * (1 - local * 0.18);
          this.x = p.lerp(this.startX, target.x, eased) + cometArc;
          this.y = p.lerp(this.startY, target.y, eased) + Math.sin(local * p.PI) * p.height * 0.08;
          this.rotation = this.spinDirection * p.TWO_PI * 2 * eased;
          this.scale = p.lerp(1, 0.08, eased);

          this.tail.unshift({
            x: this.x,
            y: this.y,
            age: 0,
            radius: p.random(1, 2),
          });
          this.tail.forEach((point) => {
            point.age += 1;
          });
          this.tail = this.tail.slice(0, this.tailLength);

          if (local >= 1) {
            this.dissolved = true;
            spawnMicroCascade(target.x, target.y, this.targetU, t);
          }
        }

        draw(t) {
          if (this.dissolved) return;
          const active = t >= this.startTime;

          p.push();
          p.blendMode(p.ADD);
          this.tail.forEach((point, tailIndex) => {
            const fade = 1 - tailIndex / Math.max(1, this.tailLength);
            p.noStroke();
            p.fill(255, 248, 232, 128 * fade);
            p.circle(point.x, point.y, point.radius * (1 + fade));
            p.fill(244, 200, 69, 68 * fade);
            p.circle(point.x, point.y, point.radius * 2.2);
          });

          if (this.visible) {
            const glow = active ? 210 : 80;
            const ctx = p.drawingContext;
            ctx.save();
            ctx.shadowBlur = active ? 18 : 7;
            ctx.shadowColor = `rgba(244, 200, 69, ${active ? 0.58 : 0.28})`;
            p.translate(this.x, this.y);
            p.rotate(this.rotation);
            p.scale(this.scale);
            p.textFont("Georgia");
            p.textAlign(p.CENTER, p.CENTER);
            p.textSize(this.size);
            p.noStroke();
            p.fill(255, 248, 232, active ? glow : 225);
            p.text(this.char, 0, 0);
            if (this.scale <= 0.16) {
              p.fill(255, 255, 255, 230);
              p.circle(0, 0, 3);
            }
            ctx.restore();
          }
          p.pop();
        }
      }

      function updateCharacterParticles(t) {
        characterParticles.forEach((particle) => {
          particle.update(t);
          particle.draw(t);
        });
      }

      function spawnMicroCascade(x, y, u, t) {
        const count = Math.floor(p.random(8, 15));
        for (let i = 0; i < count; i += 1) {
          microParticles.push(new MicroParticle(x, y, u, t, i));
        }
        for (let i = 0; i < 3; i += 1) {
          sparkles.push(createSparkle(x + p.random(-7, 7), y + p.random(-7, 7), p.random(4, 6), t));
        }
        if (t - lastChimeAt > 0.05 && chimeCount < 72) {
          lastChimeAt = t;
          chimeCount += 1;
          playWaterChime(0.55, p.map(x, 0, p.width, -0.72, 0.72));
        }
      }

      class MicroParticle {
        constructor(x, y, u, born, index) {
          this.originX = x;
          this.originY = y;
          this.x = x;
          this.y = y;
          this.u = p.constrain(u + p.random(-0.012, 0.012), 0, 1);
          this.born = born;
          this.lifetime = p.random(2.4, 4);
          this.speed = p.random(0.055, 0.12);
          this.drift = p.random(-12, 12);
          this.phase = p.random(p.TWO_PI);
          this.float = p.random(12, 30);
          this.color = MICRO_COLORS[index % MICRO_COLORS.length];
        }

        update(t) {
          const age = t - this.born;
          const progress = p.constrain(age / this.lifetime, 0, 1);
          const u = p.constrain(this.u + age * this.speed, 0, 1);
          const normal = riverNormal(u, t);
          const base = riverPoint(u, t);
          const noiseDrift = (p.noise(this.phase, age * 0.35) - 0.5) * 24;
          const drift = this.drift + Math.sin(age * 2.2 + this.phase) * 4 + noiseDrift;
          const lock = easeOutCubic(p.constrain(age * 0.9, 0, 1));
          const endFloat = easeInCubic(p.constrain((progress - 0.65) / 0.35, 0, 1)) * this.float;
          this.x = p.lerp(this.originX, base.x + normal.x * drift, lock);
          this.y = p.lerp(this.originY, base.y + normal.y * drift, lock) - endFloat;
          this.dead = progress >= 1;
        }

        draw(t) {
          const age = t - this.born;
          const progress = p.constrain(age / this.lifetime, 0, 1);
          const pulse = Math.pow(Math.max(0, Math.sin(progress * p.PI)), 0.7)
            * (0.72 + Math.sin(age * p.TWO_PI * 1.35 + this.phase) * 0.28);
          const radius = 2 * (1 - progress);
          if (radius <= 0.02 || pulse <= 0.01) return;
          p.noStroke();
          p.fill(this.color.rgb[0], this.color.rgb[1], this.color.rgb[2], 235 * this.color.alpha * pulse);
          p.circle(this.x, this.y, radius * 2);
        }
      }

      function updateMicroParticles(t) {
        p.push();
        p.blendMode(p.ADD);
        microParticles = microParticles.filter((particle) => !particle.dead);
        microParticles.forEach((particle) => {
          particle.update(t);
          particle.draw(t);
        });
        p.pop();
      }

      function buildAmbientStream() {
        const count = p.width < 680 ? 90 : 150;
        const stream = [];
        for (let i = 0; i < count; i += 1) {
          stream.push({
            u: p.random(),
            speed: p.random(0.012, 0.035),
            drift: p.random(-18, 18),
            radius: p.random(0.55, 1.35),
            alpha: p.random(38, 118),
            phase: p.random(p.TWO_PI),
            color: MICRO_COLORS[i % MICRO_COLORS.length],
          });
        }
        return stream;
      }

      function drawRiverGlow(t) {
        p.push();
        p.blendMode(p.ADD);
        p.noFill();
        for (let band = -2; band <= 2; band += 1) {
          p.stroke(185, 200, 197, 10 - Math.abs(band) * 2);
          p.strokeWeight(10 - Math.abs(band) * 2);
          p.beginShape();
          for (let i = 0; i <= 90; i += 1) {
            const u = i / 90;
            const point = riverOffsetPoint(u, band * 9, t);
            p.curveVertex(point.x, point.y);
          }
          p.endShape();
        }
        p.pop();
      }

      function drawAmbientRiver(t) {
        p.push();
        p.blendMode(p.ADD);
        ambientStream.forEach((particle) => {
          const u = (particle.u + t * particle.speed) % 1;
          const drift = particle.drift + Math.sin(t * 1.2 + particle.phase) * 5;
          const point = riverOffsetPoint(u, drift, t);
          const pulse = 0.55 + Math.sin(t * 2.1 + particle.phase) * 0.45;
          const color = particle.color;
          p.noStroke();
          p.fill(color.rgb[0], color.rgb[1], color.rgb[2], particle.alpha * color.alpha * pulse);
          p.circle(point.x, point.y, particle.radius * 2);
        });
        p.pop();
      }

      function updateSparkles(t) {
        sparkles = sparkles.filter((sparkle) => t - sparkle.born <= sparkle.duration);
        while (sparkles.length < sparkleTarget) {
          sparkles.push(createSparkle(null, null, null, t));
        }

        p.push();
        p.blendMode(p.ADD);
        sparkles.forEach((sparkle) => drawSparkle(sparkle, t));
        p.pop();
      }

      function createSparkle(x, y, radius, born) {
        const t = typeof born === "number" ? born : elapsed();
        let sparkleX = x;
        let sparkleY = y;
        if (sparkleX === null || sparkleY === null) {
          const point = riverOffsetPoint(p.random(), p.random(-38, 38), t);
          sparkleX = point.x;
          sparkleY = point.y;
        }
        return {
          x: sparkleX,
          y: sparkleY,
          born: t,
          duration: p.random(0.6, 1.1),
          radius: radius || p.random(2, 5),
          color: p.random() > 0.28 ? [255, 255, 255] : [244, 200, 69],
          driftX: p.random(-10, 10),
          driftY: p.random(-8, 8),
          rotation: p.random(p.TWO_PI),
        };
      }

      function drawSparkle(sparkle, t) {
        const progress = p.constrain((t - sparkle.born) / sparkle.duration, 0, 1);
        const alpha = Math.sin(progress * p.PI);
        if (alpha <= 0.01) return;
        const x = sparkle.x + sparkle.driftX * progress;
        const y = sparkle.y + sparkle.driftY * progress;
        const radius = sparkle.radius * (0.78 + Math.sin(progress * p.PI) * 0.35);

        p.push();
        p.translate(x, y);
        p.rotate(sparkle.rotation + progress * 0.8);
        p.stroke(sparkle.color[0], sparkle.color[1], sparkle.color[2], 245 * alpha);
        p.strokeWeight(1.05);
        p.line(-radius, 0, radius, 0);
        p.line(0, -radius, 0, radius);
        p.rotate(p.QUARTER_PI);
        p.stroke(sparkle.color[0], sparkle.color[1], sparkle.color[2], 120 * alpha);
        p.line(-radius * 0.48, 0, radius * 0.48, 0);
        p.line(0, -radius * 0.48, 0, radius * 0.48);
        p.pop();
      }

      function drawBoat(t) {
        const u = (t * 0.045) % 1;
        const base = riverPoint(u, t);
        const bob = Math.sin(t * p.TWO_PI * 0.6) * 3;
        const x = base.x;
        const y = base.y + 24 + bob;
        const w = 28;
        const h = 14;

        p.push();
        p.translate(x, y);
        p.stroke(255, 255, 255, 210);
        p.strokeWeight(1.25);
        p.noFill();
        p.line(-w / 2, 0, -w * 0.18, h * 0.42);
        p.line(-w * 0.18, h * 0.42, w * 0.16, h * 0.42);
        p.line(w * 0.16, h * 0.42, w / 2, 0);
        p.line(-w / 2, 0, 0, -h * 0.55);
        p.line(0, -h * 0.55, w / 2, 0);
        p.line(-w * 0.18, h * 0.42, 0, 0);
        p.line(0, 0, w * 0.16, h * 0.42);
        p.pop();
      }

      function riverPoint(u, t = 0) {
        const clamped = p.constrain(u, 0, 1);
        const x = p.lerp(p.width * 0.07, p.width * 0.93, clamped);
        const sigmoid = 1 / (1 + Math.exp(-8 * (clamped - 0.5)));
        const y = p.height * (0.54 + 0.22 * sigmoid)
          + Math.sin(clamped * p.TWO_PI * 1.35 + t * 0.16) * p.height * 0.035;
        return { x, y };
      }

      function riverNormal(u, t = 0) {
        const before = riverPoint(Math.max(0, u - 0.006), t);
        const after = riverPoint(Math.min(1, u + 0.006), t);
        const dx = after.x - before.x;
        const dy = after.y - before.y;
        const length = Math.hypot(dx, dy) || 1;
        return { x: -dy / length, y: dx / length };
      }

      function riverOffsetPoint(u, offset, t = 0) {
        const base = riverPoint(u, t);
        const normal = riverNormal(u, t);
        return {
          x: base.x + normal.x * offset,
          y: base.y + normal.y * offset,
        };
      }

      function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
      }

      function easeInCubic(t) {
        return t * t * t;
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
