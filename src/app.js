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
    const accents = ["#7b3931", "#526f73", "#b9954e", "#151817"];
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
        p.background(197, 189, 163);
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
          p.fill(247, 238, 216, alpha);
          p.rect(p.random(p.width), p.random(p.height), p.random(18, 70), 1);
        }
        p.stroke(21, 24, 23, 20);
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
          [-150, 25, -0.35, 120, 70, "#4f201d"],
          [-70, 18, -0.08, 150, 88, "#6e3831"],
          [0, 26, 0, 120, 128, "#895346"],
          [74, 18, 0.1, 150, 86, "#6e3831"],
          [150, 25, 0.35, 120, 70, "#4f201d"],
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
    state.riverSketch = createEditorialRiverSketch(plaintext, () => showCompletedRiverLetter(plaintext));
    state.revealTimer = window.setTimeout(() => {
      showCompletedRiverLetter(plaintext);
    }, 39800);
  }

  function renderRiverLetter(plaintext) {
    el.riverLetter.classList.remove("is-revealing");
    el.riverLetter.style.transition = "none";
    el.riverLetter.style.opacity = "0";
    el.riverLetter.style.pointerEvents = "none";
    el.riverLetter.setAttribute("aria-hidden", "true");
    el.riverRecipient.textContent = plaintext.recipient ? `To ${plaintext.recipient}` : "";
    el.riverLetterTitle.textContent = plaintext.title || "Untitled letter";
    el.riverLetterMessage.textContent = plaintext.message || "";
  }

  function showCompletedRiverLetter(plaintext) {
    el.riverRecipient.textContent = plaintext.recipient ? `To ${plaintext.recipient}` : "";
    el.riverLetterTitle.textContent = plaintext.title || "Untitled letter";
    el.riverLetterMessage.textContent = plaintext.message || "";
    el.riverLetter.style.opacity = "1";
    el.riverLetter.style.pointerEvents = "auto";
    el.riverLetter.style.filter = "none";
    el.riverLetter.style.transform = "none";
    el.riverLetter.setAttribute("aria-hidden", "false");
  }

  function destroyRiverSketch() {
    window.clearTimeout(state.revealTimer);
    if (!state.riverSketch) return;
    if (typeof state.riverSketch.cleanup === "function") state.riverSketch.cleanup();
    state.riverSketch.remove();
    state.riverSketch = null;
  }

  function createEditorialRiverSketch(plaintext, onComplete) {
    return new window.p5((p) => {
      const STORY_END = 39.2;
      const palette = {
        night: [8, 12, 27],
        midnight: [14, 25, 49],
        dawn: [196, 178, 132],
        paper: [232, 224, 202],
        paperLight: [246, 239, 221],
        paperDeep: [184, 170, 137],
        ink: [18, 21, 22],
        lace: [238, 236, 226],
        ochre: [191, 155, 77],
        blueWing: [83, 163, 187],
        mutedTeal: [86, 139, 139],
        rust: [143, 80, 62],
      };
      const fragmentColors = [
        [245, 238, 219],
        [225, 211, 169],
        [186, 202, 196],
        [205, 185, 132],
      ];
      const cityColors = [
        [215, 204, 169],
        [142, 173, 163],
        [191, 139, 121],
        [92, 101, 115],
        [184, 170, 137],
        [109, 137, 158],
      ];

      let staticStars = [];
      let fogBands = [];
      let butterflies = [];
      let wordDrops = [];
      let ripples = [];
      let birds = [];
      let paperFibers = [];
      let cityPieces = [];
      let collageWords = [];
      let finalLayout = null;
      let startMillis = 0;
      let waterY = 0;
      let completed = false;
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
        drawStoryBackground(t);
        drawMoonAndStars(t);
        drawCityscapeMusic(t);
        drawWaterStage(t);
        drawEnvelope(t);
        drawLaceBloom(t);
        drawButterflies(t);
        drawTypographicCascade(t);
        drawWordRain(t);
        drawRipples(t);
        drawMemoryThreads(t);
        drawBoatPlaneAndBirds(t);
        drawDestination(t);
        drawFinalLetter(t);
        drawForegroundGrain(t);

        if (!completed && t > STORY_END) {
          completed = true;
          if (typeof onComplete === "function") onComplete();
        }
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
        waterY = p.height * 0.69;
        completed = false;
        lastChimeAt = 0;
        chimeCount = 0;
        collageWords = buildCollageWords();
        staticStars = buildStaticStars();
        fogBands = buildFogBands();
        paperFibers = buildPaperFibers();
        cityPieces = buildCityPieces();
        butterflies = buildButterflies();
        wordDrops = buildWordDrops();
        birds = buildBirds();
        ripples = [];
        finalLayout = buildFinalLetterLayout();
      }

      function elapsed() {
        return (p.millis() - startMillis) / 1000;
      }

      function buildFullText() {
        return [
          plaintext.recipient ? `To ${plaintext.recipient}` : "",
          plaintext.title || "Untitled letter",
          "",
          plaintext.message || "",
        ].filter((line, index) => index < 3 || String(line).trim()).join("\n");
      }

      function buildCollageWords() {
        const words = buildFullText()
          .replace(/[^\w\s'-]/g, " ")
          .split(/\s+/)
          .filter((word) => word.length > 1)
          .slice(0, 220);
        if (words.length) return words;
        return ["letter", "memory", "love", "arrival", "quiet", "home"];
      }

      function buildStaticStars() {
        const count = p.width < 680 ? 80 : 125;
        const stars = [];
        for (let i = 0; i < count; i += 1) {
          stars.push({
            x: p.random(p.width),
            y: p.random(p.height * 0.02, p.height * 0.72),
            r: p.random(0.35, 1.25),
            phase: p.random(p.TWO_PI),
            alpha: p.random(42, 145),
            warm: p.random() > 0.48,
          });
        }
        return stars;
      }

      function buildFogBands() {
        const bands = [];
        for (let i = 0; i < 9; i += 1) {
          bands.push({
            y: p.random(p.height * 0.27, p.height * 0.84),
            width: p.random(p.width * 0.42, p.width * 1.05),
            height: p.random(18, 54),
            speed: p.random(0.025, 0.08),
            phase: p.random(p.TWO_PI),
          });
        }
        return bands;
      }

      function buildPaperFibers() {
        const count = p.width < 680 ? 230 : 390;
        const fibers = [];
        for (let i = 0; i < count; i += 1) {
          fibers.push({
            x: p.random(p.width),
            y: p.random(p.height),
            length: p.random(8, 74),
            angle: p.random(-0.18, 0.18) + (p.random() > 0.8 ? p.HALF_PI : 0),
            alpha: p.random(8, 34),
            weight: p.random(0.35, 0.9),
            warm: p.random() > 0.45,
          });
        }
        return fibers;
      }

      function buildCityPieces() {
        const count = p.width < 680 ? 13 : 22;
        const baseY = p.height * 0.79;
        const pieces = [];
        for (let i = 0; i < count; i += 1) {
          const spread = count === 1 ? 0.5 : i / (count - 1);
          const w = p.random(28, 64) * (p.width < 680 ? 0.72 : 1);
          const h = p.random(54, 168) * (p.width < 680 ? 0.72 : 1);
          pieces.push({
            x: p.lerp(-18, p.width - 18, spread) + p.random(-16, 16),
            y: baseY - h + p.random(-8, 22),
            w,
            h,
            color: cityColors[i % cityColors.length],
            roof: i % 4,
            textIndex: i % collageWords.length,
          });
        }
        return pieces;
      }

      function buildButterflies() {
        const count = p.width < 680 ? 9 : 15;
        const list = [];
        for (let i = 0; i < count; i += 1) {
          list.push({
            delay: 4.15 + i * 0.16 + p.random(0, 0.38),
            duration: p.random(6.4, 9.2),
            angle: (i / count) * p.TWO_PI + p.random(-0.36, 0.36),
            radius: p.random(100, Math.min(p.width, p.height) * 0.43),
            size: p.random(0.65, 1.17),
            phase: p.random(p.TWO_PI),
          });
        }
        return list;
      }

      function buildWordDrops() {
        const chars = [...buildFullText()].filter((char) => /\S/.test(char));
        const maxDrops = p.width < 680 ? 300 : 540;
        const desired = Math.min(maxDrops, Math.max(110, chars.length * 2 + collageWords.length * 2));
        const list = [];
        const span = Math.max(1, desired - 1);
        let charIndex = 0;
        for (let i = 0; i < desired; i += 1) {
          const u = i / span;
          const useWord = collageWords.length > 0 && i % 7 === 3;
          const raw = useWord ? collageWords[i % collageWords.length] : chars[charIndex % Math.max(1, chars.length)] || "x";
          if (!useWord) charIndex += 1;
          const text = stylizeFragment(raw, i, useWord);
          const streamX = p.width * 0.36
            + Math.sin(u * p.TWO_PI * 1.35) * p.width * 0.055
            + Math.sin(u * p.TWO_PI * 6.2) * p.width * 0.018;
          const targetX = streamX + p.random(-36, 36) * (p.width < 680 ? 0.65 : 1);
          const targetY = waterY - 8
            + Math.sin(u * p.TWO_PI * 2.35) * p.height * 0.036
            + p.random(-9, 14);
          list.push({
            text,
            index: i,
            isWord: useWord,
            start: 7.0 + u * 9.6 + p.random(0, 0.95),
            duration: p.random(4.5, 7.4),
            startX: targetX + p.random(-p.width * 0.085, p.width * 0.085),
            startY: p.random(-p.height * 0.5, -24) - u * p.height * 0.16,
            targetX,
            targetY,
            size: useWord ? p.random(7, 15) : p.random(12, 29),
            sway: p.random(8, 31),
            phase: p.random(p.TWO_PI),
            font: i % 5 === 0 ? "Times New Roman" : i % 3 === 0 ? "Courier New" : "Georgia",
            bold: useWord || i % 11 === 0,
            rotation: p.random(-0.38, 0.38),
            symbolSeed: Math.floor(p.random(fragmentColors.length)),
            impacted: false,
          });
        }
        return list;
      }

      function stylizeFragment(raw, index, isWord) {
        const text = String(raw || "").trim();
        if (!text) return "";
        if (!isWord) return index % 8 === 0 ? text.toUpperCase() : text;
        const clipped = text.length > 12 ? text.slice(0, 12) : text;
        return index % 5 === 0 ? clipped.toUpperCase() : clipped;
      }

      function buildBirds() {
        const count = p.width < 680 ? 20 : 38;
        const list = [];
        for (let i = 0; i < count; i += 1) {
          list.push({
            delay: 24.4 + p.random(0, 2.8),
            duration: p.random(6.1, 8.8),
            lane: i / Math.max(1, count - 1),
            size: p.random(8, 18),
            phase: p.random(p.TWO_PI),
            color: p.random() > 0.3 ? palette.paperLight : [216, 202, 158],
          });
        }
        return list;
      }

      function buildFinalLetterLayout() {
        const paperW = Math.min(p.width * 0.86, 670);
        const paperH = Math.min(p.height * 0.78, 540);
        const x = (p.width - paperW) / 2;
        const y = Math.max(24, (p.height - paperH) / 2);
        const padding = Math.max(22, Math.min(44, paperW * 0.078));
        let baseSize = Math.min(20, Math.max(11, p.width / 48));
        let lines = [];

        while (baseSize >= 9) {
          lines = [];
          const textWidth = paperW - padding * 2;
          const sections = [
            {
              text: plaintext.recipient ? `To ${plaintext.recipient}` : "",
              size: baseSize * 0.82,
              role: "recipient",
              font: "Courier New",
              bold: true,
            },
            {
              text: plaintext.title || "Untitled letter",
              size: baseSize * 1.34,
              role: "title",
              font: "Times New Roman",
              bold: true,
            },
            { text: "", size: baseSize, role: "gap", font: "Georgia", bold: false },
            { text: plaintext.message || "", size: baseSize, role: "message", font: "Georgia", bold: false },
          ];
          sections.forEach((section) => {
            if (!section.text) {
              lines.push({ text: "", size: section.size, role: section.role, font: section.font, bold: section.bold });
              return;
            }
            p.textFont(section.font);
            p.textStyle(section.bold ? p.BOLD : p.NORMAL);
            p.textSize(section.size);
            wrapText(section.text, textWidth).forEach((line) => {
              lines.push({ text: line, size: section.size, role: section.role, font: section.font, bold: section.bold });
            });
          });
          const height = lines.reduce((sum, line) => sum + line.size * (line.role === "gap" ? 0.86 : 1.42), 0);
          if (height <= paperH - padding * 2 || baseSize <= 9) break;
          baseSize -= 1;
        }

        const glyphs = [];
        let cursorY = y + padding;
        let order = 0;
        const maxY = y + paperH - padding * 0.62;
        lines.forEach((line) => {
          const lineHeight = line.size * (line.role === "gap" ? 0.86 : 1.42);
          if (cursorY + lineHeight > maxY) return;
          p.textFont(line.font);
          p.textStyle(line.bold ? p.BOLD : p.NORMAL);
          p.textSize(line.size);
          let cursorX = x + padding;
          [...line.text].forEach((char) => {
            const width = p.textWidth(char || " ");
            glyphs.push({
              char,
              x: cursorX,
              y: cursorY,
              size: line.size,
              role: line.role,
              font: line.font,
              bold: line.bold || (line.role === "message" && /[A-Z]/.test(char) && order % 19 === 0),
              order,
            });
            order += 1;
            cursorX += width;
          });
          cursorY += lineHeight;
        });
        p.textStyle(p.NORMAL);

        return { x, y, w: paperW, h: paperH, padding, glyphs };
      }

      function wrapText(text, maxWidth) {
        const lines = [];
        String(text || "").split("\n").forEach((paragraph) => {
          if (!paragraph.trim()) {
            lines.push("");
            return;
          }
          const hasSpaces = /\s/.test(paragraph);
          const tokens = hasSpaces ? paragraph.split(/\s+/) : [...paragraph];
          let line = "";
          tokens.forEach((token) => {
            const next = hasSpaces ? `${line}${line ? " " : ""}${token}` : `${line}${token}`;
            if (p.textWidth(next) <= maxWidth || !line) {
              line = next;
            } else {
              lines.push(line);
              line = token;
            }
          });
          if (line) lines.push(line);
        });
        return lines;
      }

      function drawStoryBackground(t) {
        const dawn = smoothstep(23.5, 33.5, t);
        const ctx = p.drawingContext;
        const top = mixColor(palette.night, [82, 83, 85], dawn * 0.58);
        const mid = mixColor(palette.midnight, [150, 145, 122], dawn * 0.72);
        const bottom = mixColor([19, 24, 34], [220, 203, 156], dawn);
        const gradient = ctx.createLinearGradient(0, 0, p.width, p.height);
        gradient.addColorStop(0, rgba(top[0], top[1], top[2], 1));
        gradient.addColorStop(0.48, rgba(mid[0], mid[1], mid[2], 1));
        gradient.addColorStop(1, rgba(bottom[0], bottom[1], bottom[2], 1));
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, p.width, p.height);

        p.noStroke();
        p.fill(6, 9, 17, 68 * (1 - dawn));
        p.rect(0, 0, p.width, p.height);
        drawFog(t, dawn);
        drawPaperFibers(0.62 + dawn * 0.44);
      }

      function drawFog(t, dawn) {
        p.noStroke();
        fogBands.forEach((band, index) => {
          const x = ((t * band.speed * 42 + band.phase * 70 + index * 97) % (p.width + band.width)) - band.width * 0.5;
          const alpha = 10 + dawn * 18;
          p.fill(207, 202, 181, alpha);
          p.ellipse(x, band.y + Math.sin(t * 0.15 + band.phase) * 9, band.width, band.height);
        });
      }

      function drawPaperFibers(alphaScale) {
        p.push();
        p.noFill();
        paperFibers.forEach((fiber) => {
          const color = fiber.warm ? palette.paperDeep : [142, 154, 155];
          p.stroke(color[0], color[1], color[2], fiber.alpha * alphaScale);
          p.strokeWeight(fiber.weight);
          const dx = Math.cos(fiber.angle) * fiber.length;
          const dy = Math.sin(fiber.angle) * fiber.length;
          p.line(fiber.x, fiber.y, fiber.x + dx, fiber.y + dy);
        });
        p.pop();
      }

      function drawMoonAndStars(t) {
        const dawn = smoothstep(23.5, 33.5, t);
        p.push();
        staticStars.forEach((star) => {
          const twinkle = 0.68 + Math.sin(t * 0.92 + star.phase) * 0.32;
          const color = star.warm ? palette.paperLight : [190, 206, 207];
          p.noStroke();
          p.fill(color[0], color[1], color[2], star.alpha * twinkle * (1 - dawn * 0.72));
          p.circle(star.x, star.y, star.r * 2);
        });
        p.pop();

        const moonX = p.width * 0.82;
        const moonY = p.height * 0.15;
        const moonFade = 1 - smoothstep(27, 34, t);
        if (moonFade <= 0) return;
        p.push();
        drawGlow(moonX, moonY, 76, palette.paperLight, 16 * moonFade);
        p.noStroke();
        p.fill(245, 240, 221, 205 * moonFade);
        p.circle(moonX, moonY, 32);
        p.fill(15, 24, 45, 218 * moonFade);
        p.circle(moonX + 11, moonY - 2, 32);
        p.pop();
      }

      function drawEnvelope(t) {
        const appear = 1 - smoothstep(4.65, 5.85, t);
        if (appear <= 0) return;
        const open = smoothstep(0.6, 2.35, t);
        const lift = smoothstep(1.7, 3.45, t);
        const cx = p.width * 0.5;
        const cy = p.height * 0.57 - lift * p.height * 0.21;
        const w = Math.min(216, p.width * 0.36);
        const h = w * 0.58;

        p.push();
        p.translate(cx, cy);
        p.noStroke();
        p.fill(0, 0, 0, 44 * appear);
        p.rect(-w / 2 + 9, -h / 2 + 10, w, h, 5);
        drawPaperRect(-w / 2, -h / 2, w, h, 5, appear);
        p.stroke(88, 79, 60, 118 * appear);
        p.strokeWeight(1.1);
        p.line(-w / 2, -h / 2, 0, 6);
        p.line(w / 2, -h / 2, 0, 6);
        p.line(-w / 2, h / 2, -8, 2);
        p.line(w / 2, h / 2, 8, 2);
        p.noStroke();
        p.fill(239, 232, 211, 205 * appear);
        p.beginShape();
        p.vertex(-w / 2, -h / 2);
        p.vertex(0, -h / 2 - open * 70);
        p.vertex(w / 2, -h / 2);
        p.vertex(0, 6);
        p.endShape(p.CLOSE);
        p.stroke(92, 84, 68, 72 * appear);
        p.line(-w / 2, -h / 2, 0, -h / 2 - open * 70);
        p.line(w / 2, -h / 2, 0, -h / 2 - open * 70);
        p.noStroke();
        p.fill(116, 48, 45, 188 * appear);
        p.circle(0, 7, 24);
        p.fill(218, 190, 119, 130 * open * appear);
        p.circle(0, 7, 9 + open * 3);
        p.pop();
      }

      function drawLaceBloom(t) {
        const bloom = smoothstep(2.0, 7.15, t);
        const fade = 1 - smoothstep(11.4, 14.3, t);
        if (bloom <= 0 || fade <= 0) return;
        const cx = p.width * 0.5;
        const cy = p.height * 0.32 + Math.sin(t * 0.42) * 4;
        const scale = Math.min(p.width, p.height) / 620;
        const tremor = Math.sin(t * 5.6) * 0.018 + Math.sin(t * 3.1) * 0.014;

        p.push();
        p.translate(cx, cy);
        p.rotate(Math.sin(t * 0.18) * 0.08 + tremor);
        p.scale(scale);
        drawGlow(0, 0, 238 * bloom, palette.lace, 13 * fade);

        for (let ring = 4; ring >= 0; ring -= 1) {
          const petals = 6 + ring * 2;
          const ringBloom = p.constrain((bloom - ring * 0.075) / 0.62, 0, 1);
          const depth = p.map(ring, 0, 4, 0.55, 1);
          for (let i = 0; i < petals; i += 1) {
            const breeze = Math.sin(t * (1.35 + ring * 0.08) + i * 1.7) * 0.045;
            const angle = (i / petals) * p.TWO_PI + ring * 0.31 + breeze;
            const length = p.lerp(24, 82 + ring * 19, ringBloom) * depth;
            const width = p.lerp(10, 30 + ring * 7, ringBloom) * depth;
            const offset = ring * 10 * ringBloom;
            drawLacePetal(angle, offset, length, width, ring, i, fade, ringBloom);
          }
        }

        drawBloomThreads(fade, bloom, t);
        p.noStroke();
        p.fill(238, 236, 226, 156 * fade);
        p.circle(0, 0, 24 * bloom);
        p.fill(196, 165, 99, 96 * fade);
        p.circle(0, 0, 8 * bloom);
        p.pop();
      }

      function drawLacePetal(angle, offset, length, width, ring, index, alpha, bloom) {
        p.push();
        p.rotate(angle);
        p.translate(offset, 0);
        p.rotate(Math.sin(index + ring) * 0.18 * (1 - bloom));
        const rich = p.map(ring, 0, 4, 0.48, 1);
        p.fill(236, 234, 224, (22 + rich * 26) * alpha);
        p.stroke(239, 237, 229, (86 + rich * 26) * alpha);
        p.strokeWeight(1.05);
        p.beginShape();
        p.vertex(0, 0);
        p.bezierVertex(length * 0.17, -width * 0.98, length * 0.76, -width * 0.76, length, 0);
        p.bezierVertex(length * 0.76, width * 0.76, length * 0.17, width * 0.98, 0, 0);
        p.endShape(p.CLOSE);

        const ctx = p.drawingContext;
        ctx.save();
        ctx.setLineDash([1.6, 3.4]);
        p.noFill();
        p.stroke(250, 247, 236, 72 * alpha);
        p.strokeWeight(0.72);
        for (let i = 1; i <= 5; i += 1) {
          const u = i / 6;
          p.arc(length * (0.14 + u * 0.13), 0, width * (0.9 + u), width * (0.34 + u * 0.18), -0.92, 0.92);
          p.line(length * 0.08, 0, length * (0.24 + u * 0.62), Math.sin(i + ring) * width * 0.34);
        }
        ctx.restore();

        p.stroke(255, 252, 240, 56 * alpha);
        p.strokeWeight(1);
        for (let i = 0; i < 9; i += 1) {
          const u = (i + 0.5) / 9;
          p.point(length * u, Math.sin(u * Math.PI * 6 + ring) * width * 0.36);
        }
        p.pop();
      }

      function drawBloomThreads(alpha, bloom, t) {
        p.stroke(232, 229, 216, 74 * alpha);
        p.strokeWeight(0.65);
        for (let i = 0; i < 12; i += 1) {
          const angle = -p.PI * 0.88 + (i / 11) * p.PI * 0.76;
          const x = Math.cos(angle) * (46 + i * 4) * bloom;
          const y = Math.sin(angle) * 28 * bloom + 68 * bloom;
          const dangle = Math.sin(t * 2 + i) * 2.2;
          p.line(x, y - 28, x + dangle, y + 20);
          p.noStroke();
          p.fill(232, 229, 216, 102 * alpha);
          p.ellipse(x + dangle, y + 23, 4, 7);
          p.stroke(232, 229, 216, 74 * alpha);
        }
      }

      function drawButterflies(t) {
        butterflies.forEach((butterfly) => {
          const local = p.constrain((t - butterfly.delay) / butterfly.duration, 0, 1);
          if (local <= 0 || local >= 1) return;
          const rise = easeOutCubic(local);
          const cx = p.width * 0.5;
          const cy = p.height * 0.32;
          const angle = butterfly.angle + rise * p.TWO_PI * 1.2;
          const radius = butterfly.radius * rise;
          const x = cx + Math.cos(angle) * radius;
          const y = cy + Math.sin(angle) * radius * 0.58 - rise * p.height * 0.2;
          const alpha = Math.sin(local * Math.PI);
          drawButterfly(x, y, butterfly.size * (0.82 + rise * 0.52), angle, alpha, t + butterfly.phase);
        });
      }

      function drawButterfly(x, y, scale, angle, alpha, wingT) {
        const flap = 0.76 + Math.sin(wingT * 9.2) * 0.24;
        p.push();
        p.translate(x, y);
        p.rotate(angle * 0.18);
        p.scale(scale);
        p.stroke(11, 14, 16, 145 * alpha);
        p.strokeWeight(1.2);
        p.fill(palette.blueWing[0], palette.blueWing[1], palette.blueWing[2], 136 * alpha);
        drawWing(-1, flap);
        drawWing(1, flap);
        p.noFill();
        p.stroke(235, 232, 218, 92 * alpha);
        p.strokeWeight(0.55);
        for (let i = -2; i <= 2; i += 1) {
          p.line(i * 7, -20, i * 4, 22);
          p.line(-28, i * 6, 28, i * 5);
        }
        p.stroke(13, 15, 16, 170 * alpha);
        p.strokeWeight(1.1);
        p.line(0, -9, 0, 15);
        p.line(0, -8, -7, -16);
        p.line(0, -8, 7, -16);
        p.pop();
      }

      function drawWing(side, flap) {
        p.beginShape();
        p.vertex(0, -3);
        p.bezierVertex(side * 14 * flap, -24, side * 36 * flap, -16, side * 23, 2);
        p.bezierVertex(side * 17, 11, side * 8, 9, 0, 3);
        p.endShape(p.CLOSE);
        p.beginShape();
        p.vertex(0, 4);
        p.bezierVertex(side * 12 * flap, 13, side * 30 * flap, 20, side * 11, 25);
        p.bezierVertex(side * 4, 20, side * 2, 13, 0, 4);
        p.endShape(p.CLOSE);
        p.noFill();
        p.line(0, 0, side * 22 * flap, -4);
        p.line(0, 5, side * 16 * flap, 16);
        p.fill(palette.blueWing[0], palette.blueWing[1], palette.blueWing[2], 116);
      }

      function drawWaterStage(t) {
        const appear = smoothstep(5.7, 8.25, t);
        if (appear <= 0) return;
        const dawn = smoothstep(23.5, 33.5, t);
        const ctx = p.drawingContext;
        const gradient = ctx.createLinearGradient(0, waterY - 92, 0, p.height);
        gradient.addColorStop(0, rgba(22, 28, 38, 0));
        gradient.addColorStop(0.2, rgba(64, 74, 83, 0.16 * appear));
        gradient.addColorStop(0.58, rgba(15 + dawn * 80, 25 + dawn * 80, 42 + dawn * 65, 0.56 * appear));
        gradient.addColorStop(1, rgba(7 + dawn * 110, 12 + dawn * 90, 22 + dawn * 45, 0.82 * appear));
        ctx.fillStyle = gradient;
        ctx.fillRect(0, waterY - 100, p.width, p.height - waterY + 100);

        p.push();
        p.noFill();
        for (let i = 0; i < 10; i += 1) {
          p.stroke(218, 208, 176, (16 - i * 0.9) * appear);
          p.strokeWeight(i % 3 === 0 ? 1.1 : 0.7);
          p.beginShape();
          for (let x = -24; x <= p.width + 24; x += 26) {
            const y = waterY + Math.sin(x * 0.013 + t * 0.48 + i) * (2.5 + i * 1.2) + i * 7.2;
            p.curveVertex(x, y);
          }
          p.endShape();
        }
        p.stroke(28, 29, 26, 34 * appear);
        for (let i = 0; i < 18; i += 1) {
          const y = waterY + 16 + i * 9;
          p.line(0, y + Math.sin(t + i) * 1.4, p.width, y + Math.cos(t * 0.5 + i) * 1.4);
        }
        p.pop();
      }

      function drawTypographicCascade(t) {
        const active = smoothstep(7.0, 10.2, t) * (1 - smoothstep(22.3, 25.0, t));
        if (active <= 0) return;
        const centerX = p.width * 0.35;
        p.push();
        p.noFill();
        for (let band = -5; band <= 5; band += 1) {
          const widthAlpha = 22 - Math.abs(band) * 2.6;
          p.stroke(7, 8, 8, widthAlpha * active);
          p.strokeWeight(3.2 - Math.abs(band) * 0.18);
          p.beginShape();
          for (let y = -20; y <= waterY + 48; y += 34) {
            const x = centerX
              + Math.sin(y * 0.014 + t * 0.22 + band) * 42
              + band * 8
              + Math.sin(y * 0.041 + band) * 7;
            p.curveVertex(x, y);
          }
          p.endShape();
        }

        p.textAlign(p.LEFT, p.CENTER);
        p.textFont("Times New Roman");
        p.textStyle(p.NORMAL);
        for (let row = 0; row < 60; row += 1) {
          const y = -20 + row * 13 + ((t * 12 + row * 3) % 13);
          if (y > waterY + 35) continue;
          const side = row % 2 === 0 ? -1 : 1;
          const x = centerX
            + Math.sin(row * 0.72 + t * 0.2) * 38
            + side * (34 + (row % 5) * 12);
          const word = collageWords[row % collageWords.length];
          p.textSize(5.5 + (row % 4) * 0.8);
          p.fill(row % 3 === 0 ? 236 : 16, row % 3 === 0 ? 231 : 18, row % 3 === 0 ? 214 : 18, (row % 3 === 0 ? 80 : 92) * active);
          p.text(row % 6 === 0 ? word.toUpperCase() : word, x, y);
        }

        p.stroke(240, 235, 216, 38 * active);
        p.strokeWeight(0.85);
        for (let i = 0; i < 21; i += 1) {
          const x = centerX - 54 + i * 5.4 + Math.sin(t * 0.34 + i) * 7;
          p.line(x, 0, x + Math.sin(i) * 15, waterY - 14);
        }
        p.pop();
      }

      function drawWordRain(t) {
        const rainAppear = smoothstep(6.45, 9.1, t);
        if (rainAppear <= 0) return;
        p.push();
        wordDrops.forEach((drop) => {
          const local = p.constrain((t - drop.start) / drop.duration, 0, 1);
          if (local <= 0) return;
          if (local < 1) {
            const fall = easeInOutCubic(local);
            const x = p.lerp(drop.startX, drop.targetX, fall)
              + Math.sin(t * 1.04 + drop.phase) * drop.sway * (1 - fall * 0.68);
            const y = p.lerp(drop.startY, drop.targetY, fall);
            drawRainThread(x, y, drop, fall, rainAppear);
            drawConstellationFragment(x, y, drop, 1 - fall * 0.14, rainAppear);
          } else {
            if (!drop.impacted) {
              drop.impacted = true;
              ripples.push({ x: drop.targetX, y: drop.targetY, born: t, strength: p.random(0.72, 1.22) });
              if (t - lastChimeAt > 0.075 && chimeCount < 70) {
                lastChimeAt = t;
                chimeCount += 1;
                playWaterChime(0.34, p.map(drop.targetX, 0, p.width, -0.7, 0.7));
              }
            }
            drawSettledOrLiftedDrop(drop, t);
          }
        });
        p.textStyle(p.NORMAL);
        p.pop();
      }

      function drawRainThread(x, y, drop, fall, alpha) {
        p.push();
        p.stroke(225, 220, 203, 42 * alpha * (1 - fall * 0.12));
        p.strokeWeight(drop.isWord ? 0.55 : 0.72);
        p.line(x, Math.max(0, y - 132), x + Math.sin(drop.phase) * 5, y - 8);
        p.stroke(18, 19, 18, 28 * alpha);
        p.line(x + 1.5, Math.max(0, y - 116), x + Math.sin(drop.phase) * 4, y - 6);
        p.pop();
      }

      function drawConstellationFragment(x, y, drop, scale, alpha) {
        p.push();
        p.translate(x, y);
        p.rotate(drop.rotation * 0.35);
        p.scale(scale);
        drawGlow(0, 0, drop.size * 1.9, palette.paperLight, 8 * alpha);
        p.textFont(drop.font);
        p.textStyle(drop.bold ? p.BOLD : p.NORMAL);
        p.textAlign(p.CENTER, p.CENTER);
        p.textSize(drop.size);
        p.noStroke();
        p.fill(5, 6, 7, 88 * alpha);
        p.text(drop.text, 1.4, 1.7);
        p.fill(242, 236, 217, 220 * alpha);
        p.text(drop.text, 0, 0);

        const symbols = ["*", "o", ".", "+"];
        for (let i = 0; i < 4; i += 1) {
          const angle = drop.phase + i * 1.55;
          const radius = drop.size * (0.42 + (i % 3) * 0.2);
          const sx = Math.cos(angle) * radius;
          const sy = Math.sin(angle) * radius;
          const color = fragmentColors[(drop.symbolSeed + i) % fragmentColors.length];
          p.fill(color[0], color[1], color[2], 112 * alpha);
          if (i % 2 === 0) {
            drawTinyMoon(sx, sy, 2.4);
          } else {
            p.textStyle(p.NORMAL);
            p.textSize(5.5);
            p.text(symbols[(drop.symbolSeed + i) % symbols.length], sx, sy);
          }
        }
        p.textStyle(p.NORMAL);
        p.pop();
      }

      function drawSettledOrLiftedDrop(drop, t) {
        const lift = smoothstep(22.05, 26.15, t);
        if (lift <= 0) {
          const pulse = 0.58 + Math.sin(t * 2.3 + drop.phase) * 0.25;
          p.push();
          p.translate(drop.targetX, drop.targetY + Math.sin(t + drop.phase) * 1.8);
          p.rotate(drop.rotation);
          p.textFont(drop.font);
          p.textStyle(drop.bold ? p.BOLD : p.NORMAL);
          p.textAlign(p.CENTER, p.CENTER);
          p.textSize(drop.isWord ? drop.size * 0.92 : Math.min(18, drop.size * 0.72));
          p.fill(10, 11, 10, (drop.isWord ? 72 : 56) * pulse);
          p.text(drop.text, 0, -4);
          p.noStroke();
          p.fill(224, 209, 159, 52 * pulse);
          p.circle(0, 2, drop.isWord ? 2.1 : 2.8);
          p.textStyle(p.NORMAL);
          p.pop();
          return;
        }

        if (lift < 1 && drop.index % 2 === 0) {
          const plane = airplanePoint(t);
          const delay = (drop.index % 64) / 64;
          const local = p.constrain((lift - delay * 0.45) / 0.72, 0, 1);
          if (local <= 0) return;
          const curve = Math.sin(local * Math.PI) * p.height * 0.2;
          const x = p.lerp(drop.targetX, plane.x - 42 + Math.sin(drop.phase) * 32, local);
          const y = p.lerp(drop.targetY, plane.y + Math.cos(drop.phase) * 22, local) - curve;
          p.push();
          p.stroke(220, 202, 151, 38 * (1 - local));
          p.strokeWeight(0.85);
          p.line(drop.targetX, drop.targetY, x, y);
          p.noStroke();
          p.fill(242, 236, 218, 154 * (1 - local * 0.35));
          p.circle(x, y, 2.7 * (1 - local * 0.45));
          p.pop();
        }
      }

      function drawRipples(t) {
        ripples = ripples.filter((ripple) => t - ripple.born < 6.4);
        if (!ripples.length) return;
        p.push();
        p.noFill();
        ripples.forEach((ripple) => {
          const age = t - ripple.born;
          const fade = Math.max(0, 1 - age / 6.4);
          for (let i = 0; i < 3; i += 1) {
            const radius = (age * 23 + i * 17) * ripple.strength;
            p.stroke(225, 205, 145, 34 * fade * (1 - i * 0.18));
            p.strokeWeight(0.92);
            p.ellipse(ripple.x, ripple.y, radius * 2.65, radius * 0.5);
            p.stroke(21, 22, 20, 14 * fade);
            p.ellipse(ripple.x + 1, ripple.y + 1, radius * 2.45, radius * 0.44);
          }
        });
        p.pop();
      }

      function drawMemoryThreads(t) {
        const active = smoothstep(14, 20.2, t) * (1 - smoothstep(25.4, 29, t));
        if (active <= 0) return;
        const points = wordDrops.filter((drop) => drop.impacted && drop.index % 12 === 0);
        p.push();
        p.noFill();
        for (let i = 1; i < points.length; i += 1) {
          const a = points[i - 1];
          const b = points[i];
          p.stroke(216, 197, 142, 19 * active);
          p.strokeWeight(0.72);
          p.line(a.targetX, a.targetY, b.targetX, b.targetY);
        }
        p.pop();
      }

      function drawBoatPlaneAndBirds(t) {
        if (t < 8.6) return;
        const boat = boatPoint(t);
        const tremble = recentRippleTremble(t, boat.x);
        const fold = smoothstep(19.9, 22.35, t);
        const takeoff = smoothstep(22.05, 26.2, t);

        if (takeoff <= 0.02) {
          drawBoatPlaneMorph(boat.x, boat.y + tremble, fold, t);
        } else if (takeoff < 1) {
          const plane = airplanePoint(t);
          drawLiftTrails(plane, t);
          drawPaperAirplane(plane.x, plane.y, plane.angle, 1.0, 232);
        }

        drawBirds(t);
      }

      function boatPoint(t) {
        const u = smoothstep(8.5, 19.9, t);
        return {
          x: p.lerp(p.width * 0.09, p.width * 0.64, u),
          y: waterY + 23 + Math.sin(t * p.TWO_PI * 0.58) * 3,
        };
      }

      function airplanePoint(t) {
        const u = smoothstep(22.05, 26.6, t);
        const x0 = p.width * 0.64;
        const y0 = waterY + 8;
        const x1 = p.width * 0.54;
        const y1 = p.height * 0.31;
        const x2 = p.width * 0.86;
        const y2 = p.height * 0.19;
        const x = quadratic(x0, x1, x2, u);
        const y = quadratic(y0, y1, y2, u);
        const dx = quadraticDerivative(x0, x1, x2, u);
        const dy = quadraticDerivative(y0, y1, y2, u);
        return { x, y, angle: Math.atan2(dy, dx) };
      }

      function recentRippleTremble(t, x) {
        let tremble = 0;
        ripples.forEach((ripple) => {
          const age = t - ripple.born;
          const reach = age * 35 + 42;
          const influence = Math.max(0, 1 - Math.abs(x - ripple.x) / reach) * Math.max(0, 1 - age / 4.4);
          tremble += Math.sin(age * 9.2) * influence * 3.4;
        });
        return tremble;
      }

      function drawBoatPlaneMorph(x, y, fold, t) {
        p.push();
        p.translate(x, y);
        p.fill(245, 240, 224, 30);
        p.stroke(244, 239, 221, 220);
        p.strokeWeight(1.35);
        if (fold < 0.02) {
          const w = 43;
          p.noFill();
          p.line(-w / 2, 0, -w * 0.18, 13);
          p.line(-w * 0.18, 13, w * 0.16, 13);
          p.line(w * 0.16, 13, w / 2, 0);
          p.line(-w / 2, 0, 0, -18);
          p.line(0, -18, w / 2, 0);
          p.line(-w * 0.18, 13, 0, 0);
          p.line(0, 0, w * 0.16, 13);
          p.stroke(30, 29, 25, 50);
          p.line(-w * 0.18, 14, w * 0.16, 14);
        } else {
          const wing = p.lerp(22, 48, fold);
          const nose = p.lerp(-3, 44, fold);
          const tail = p.lerp(-22, -28, fold);
          p.fill(245, 240, 224, 52 + fold * 16);
          p.beginShape();
          p.vertex(tail, -5);
          p.vertex(nose, 0);
          p.vertex(tail, 12);
          p.vertex(-7, 1 + Math.sin(t * 3) * 1.1);
          p.endShape(p.CLOSE);
          p.line(-7, 1, tail + 8, -11);
          p.line(-7, 1, tail + 8, 18);
          p.line(-7, 1, wing * 0.45, 0);
        }
        p.pop();
      }

      function drawPaperAirplane(x, y, angle, scale, alpha) {
        p.push();
        p.translate(x, y);
        p.rotate(angle);
        p.scale(scale);
        p.noStroke();
        p.fill(0, 0, 0, alpha * 0.16);
        p.beginShape();
        p.vertex(-29, -8);
        p.vertex(40, 4);
        p.vertex(-29, 19);
        p.vertex(-10, 4);
        p.endShape(p.CLOSE);
        p.stroke(244, 239, 221, alpha);
        p.strokeWeight(1.28);
        p.fill(244, 239, 221, alpha * 0.22);
        p.beginShape();
        p.vertex(-30, -10);
        p.vertex(42, 0);
        p.vertex(-30, 17);
        p.vertex(-9, 2);
        p.endShape(p.CLOSE);
        p.line(-9, 2, -28, -10);
        p.line(-9, 2, -25, 19);
        p.line(-9, 2, 42, 0);
        p.stroke(28, 27, 24, alpha * 0.28);
        p.line(-6, 4, 28, 0);
        p.pop();
      }

      function drawLiftTrails(plane, t) {
        p.push();
        p.noFill();
        for (let i = 0; i < 7; i += 1) {
          p.stroke(218, 197, 139, 42 - i * 4);
          p.strokeWeight(0.9);
          p.beginShape();
          p.curveVertex(plane.x - i * 18, plane.y + Math.sin(t + i) * 10);
          p.curveVertex(plane.x - i * 27, plane.y + 17 + i * 6);
          p.curveVertex(plane.x - i * 48, waterY - i * 4);
          p.curveVertex(plane.x - i * 80, waterY + 24 + Math.sin(i) * 9);
          p.endShape();
        }
        p.pop();
      }

      function drawCityscapeMusic(t) {
        const appear = smoothstep(24.05, 29.4, t);
        if (appear <= 0) return;
        p.push();
        p.noFill();
        p.stroke(226, 211, 166, 54 * appear);
        p.strokeWeight(0.95);
        for (let staff = 0; staff < 5; staff += 1) {
          p.beginShape();
          for (let x = -24; x < p.width + 48; x += 34) {
            const y = p.height * 0.4 + staff * 15 + Math.sin(x * 0.014 + t * 0.22) * 17;
            p.curveVertex(x, y);
          }
          p.endShape();
        }

        const baseY = p.height * 0.8;
        cityPieces.forEach((piece, index) => {
          const rise = smoothstep(24.05 + index * 0.05, 28.1 + index * 0.04, t);
          if (rise <= 0) return;
          const y = p.lerp(baseY + 30, piece.y, rise);
          drawCityPiece(piece, y, appear * rise, index);
        });

        p.stroke(31, 30, 27, 70 * appear);
        p.strokeWeight(1.1);
        p.line(p.width * 0.04, baseY - 16, p.width * 0.94, baseY - 16);
        p.line(p.width * 0.05, baseY - 9, p.width * 0.96, baseY - 9);
        drawTinyTrain(baseY - 26, appear);
        drawBareTree(p.width * 0.88, baseY - 18, 66, appear);
        p.pop();
      }

      function drawCityPiece(piece, y, alpha, index) {
        const c = piece.color;
        p.noStroke();
        p.fill(0, 0, 0, 35 * alpha);
        p.rect(piece.x + 4, y + 5, piece.w, piece.h, 2);
        p.fill(c[0], c[1], c[2], 176 * alpha);
        p.rect(piece.x, y, piece.w, piece.h, 2);
        p.stroke(26, 25, 23, 72 * alpha);
        p.strokeWeight(0.85);
        p.noFill();
        p.rect(piece.x, y, piece.w, piece.h, 2);
        if (piece.roof === 1) {
          p.fill(c[0] * 0.78, c[1] * 0.78, c[2] * 0.78, 150 * alpha);
          p.triangle(piece.x - 2, y, piece.x + piece.w / 2, y - piece.w * 0.42, piece.x + piece.w + 2, y);
        } else if (piece.roof === 2) {
          p.fill(32, 31, 29, 98 * alpha);
          p.rect(piece.x + piece.w * 0.62, y - 16, piece.w * 0.22, 16);
        }
        p.textFont(index % 2 === 0 ? "Courier New" : "Times New Roman");
        p.textStyle(index % 5 === 0 ? p.BOLD : p.NORMAL);
        p.textAlign(p.LEFT, p.TOP);
        p.noStroke();
        p.fill(24, 24, 22, 84 * alpha);
        p.textSize(Math.max(5.5, Math.min(9, piece.w / 7)));
        const word = collageWords[piece.textIndex % collageWords.length];
        for (let line = 0; line < 5; line += 1) {
          const yy = y + 8 + line * 11;
          if (yy > y + piece.h - 8) break;
          const text = line % 2 === 0 ? word : collageWords[(piece.textIndex + line) % collageWords.length];
          p.text(text.slice(0, Math.max(3, Math.floor(piece.w / 7))), piece.x + 5, yy);
        }
        p.stroke(242, 236, 214, 48 * alpha);
        p.strokeWeight(0.7);
        for (let yy = y + 17; yy < y + piece.h - 8; yy += 19) {
          p.line(piece.x + 5, yy, piece.x + piece.w - 6, yy);
        }
        p.textStyle(p.NORMAL);
      }

      function drawTinyTrain(y, alpha) {
        p.noStroke();
        p.fill(33, 33, 31, 76 * alpha);
        p.rect(p.width * 0.12, y, p.width * 0.24, 15, 2);
        p.fill(222, 211, 181, 82 * alpha);
        for (let i = 0; i < 9; i += 1) {
          p.rect(p.width * 0.13 + i * 18, y + 4, 9, 5);
        }
      }

      function drawBareTree(x, y, h, alpha) {
        p.stroke(24, 24, 22, 88 * alpha);
        p.strokeWeight(1.1);
        p.line(x, y, x, y - h);
        for (let i = 0; i < 10; i += 1) {
          const yy = y - h * (0.25 + i * 0.065);
          const side = i % 2 === 0 ? -1 : 1;
          p.line(x, yy, x + side * (18 + i * 2), yy - (12 + i * 1.5));
        }
      }

      function drawBirds(t) {
        const appear = smoothstep(24.75, 27.1, t);
        if (appear <= 0) return;
        birds.forEach((bird, index) => {
          const local = p.constrain((t - bird.delay) / bird.duration, 0, 1);
          if (local <= 0 || local >= 1) return;
          const u = easeInOutCubic(local);
          const startX = p.width * (0.35 + (index % 6) * 0.036);
          const startY = p.height * (0.28 + (index % 5) * 0.036);
          const endX = p.width * (0.74 + bird.lane * 0.2);
          const endY = p.height * (0.16 + Math.sin(bird.lane * Math.PI) * 0.2);
          const x = p.lerp(startX, endX, u);
          const y = p.lerp(startY, endY, u) + Math.sin(t * 2 + bird.phase) * 11;
          const alpha = Math.sin(local * Math.PI) * 214 * appear;
          drawOrigamiBird(x, y, bird.size, Math.sin(t + bird.phase) * 0.23, bird.color, alpha, index);
        });
      }

      function drawOrigamiBird(x, y, size, tilt, color, alpha, index) {
        p.push();
        p.translate(x, y);
        p.rotate(tilt);
        p.stroke(18, 18, 16, alpha * 0.48);
        p.strokeWeight(0.75);
        p.fill(color[0], color[1], color[2], alpha * 0.22);
        p.beginShape();
        p.vertex(0, 0);
        p.vertex(-size * 1.45, -size * 0.42);
        p.vertex(-size * 0.28, size * 0.18);
        p.vertex(0, 0);
        p.vertex(size * 1.45, -size * 0.42);
        p.vertex(size * 0.3, size * 0.18);
        p.endShape();
        p.stroke(color[0], color[1], color[2], alpha);
        p.line(-size * 0.28, size * 0.18, 0, size * 0.74);
        p.line(size * 0.3, size * 0.18, 0, size * 0.74);
        if (index % 3 === 0) {
          p.stroke(25, 25, 22, alpha * 0.24);
          p.line(-size * 0.9, -size * 0.2, size * 0.92, -size * 0.18);
        }
        p.pop();
      }

      function drawDestination(t) {
        const appear = smoothstep(27.55, 31.4, t);
        if (appear <= 0) return;
        const x = p.width * 0.76;
        const y = p.height * 0.18;
        p.push();
        drawGlow(x, y, 120, palette.dawn, 16 * appear);
        p.noStroke();
        p.fill(232, 224, 202, 188 * appear);
        p.rect(x - 112, y - 24, 224, 46, 3);
        p.fill(20, 20, 18, 42 * appear);
        p.rect(x - 105, y + 24, 210, 5, 1);
        p.stroke(38, 35, 29, 88 * appear);
        p.strokeWeight(0.9);
        p.noFill();
        p.rect(x - 103, y - 17, 206, 32, 2);
        p.noStroke();
        p.fill(38, 34, 28, 205 * appear);
        p.textAlign(p.CENTER, p.CENTER);
        p.textFont("Times New Roman");
        p.textStyle(p.BOLD);
        p.textSize(Math.min(24, Math.max(15, p.width / 44)));
        p.text("Destination of Love", x, y - 1);
        p.textStyle(p.NORMAL);
        drawDestinationHouses(x, y + 70, appear);
        p.pop();
      }

      function drawDestinationHouses(cx, baseY, alpha) {
        const houses = [
          [-70, 28, 42, palette.paperLight],
          [-28, 24, 54, palette.mutedTeal],
          [12, 34, 44, palette.paperDeep],
          [60, 25, 50, palette.rust],
        ];
        houses.forEach(([dx, w, h, color], index) => {
          const x = cx + dx;
          const y = baseY - h;
          p.noStroke();
          p.fill(color[0], color[1], color[2], 132 * alpha);
          p.rect(x, y, w, h, 2);
          p.fill(24, 24, 22, 90 * alpha);
          p.triangle(x - 2, y, x + w / 2, y - 18, x + w + 2, y);
          p.stroke(32, 31, 28, 70 * alpha);
          p.line(x + 6, y + 10, x + w - 6, y + 10);
          p.line(x + 6, y + 22, x + w - 6, y + 22);
          if (index % 2 === 0) {
            p.textFont("Courier New");
            p.textSize(5.5);
            p.noStroke();
            p.fill(24, 24, 22, 78 * alpha);
            p.text(collageWords[index % collageWords.length].slice(0, 6), x + 5, y + h * 0.58);
          }
        });
      }

      function drawFinalLetter(t) {
        const unfold = smoothstep(30.85, 33.5, t);
        if (unfold <= 0) return;
        const cx = finalLayout.x + finalLayout.w / 2;
        const cy = finalLayout.y + finalLayout.h / 2;
        p.push();
        p.translate(cx, cy);
        p.rotate((1 - unfold) * -0.11);
        p.scale(0.22 + unfold * 0.78, 0.07 + unfold * 0.93);
        p.translate(-cx, -cy);
        drawLetterPaper(unfold);
        p.pop();

        const revealStart = 33.0;
        p.push();
        p.textAlign(p.LEFT, p.TOP);
        finalLayout.glyphs.forEach((glyph) => {
          const local = smoothstep(revealStart + glyph.order * 0.017, revealStart + glyph.order * 0.017 + 0.56, t);
          if (local <= 0) return;
          const bounce = Math.sin(local * Math.PI) * 6.5;
          const alpha = 232 * local;
          p.textFont(glyph.font);
          p.textStyle(glyph.bold ? p.BOLD : p.NORMAL);
          p.textSize(glyph.size);
          if (glyph.role === "recipient") {
            p.fill(104, 54, 48, alpha);
          } else if (glyph.role === "title") {
            p.fill(19, 24, 24, alpha);
          } else {
            p.fill(34, 35, 31, alpha);
          }
          p.text(glyph.char, glyph.x, glyph.y - bounce);
        });
        p.textStyle(p.NORMAL);
        p.pop();
      }

      function drawLetterPaper(alpha) {
        const { x, y, w, h } = finalLayout;
        p.noStroke();
        p.fill(0, 0, 0, 54 * alpha);
        p.rect(x + 11, y + 14, w, h, 5);
        p.fill(239, 231, 207, 242 * alpha);
        p.rect(x, y, w, h, 5);
        p.fill(248, 242, 224, 56 * alpha);
        p.rect(x + 8, y + 8, w - 16, h - 16, 3);
        p.stroke(116, 100, 72, 38 * alpha);
        p.strokeWeight(0.85);
        for (let lineY = y + finalLayout.padding + 46; lineY < y + h - finalLayout.padding * 0.5; lineY += 27) {
          p.line(x + finalLayout.padding, lineY, x + w - finalLayout.padding, lineY);
        }
        p.noFill();
        p.stroke(42, 37, 29, 54 * alpha);
        p.rect(x + 11, y + 11, w - 22, h - 22, 3);
        p.noStroke();
        paperFibers.slice(0, 100).forEach((fiber) => {
          const fx = x + (fiber.x % w);
          const fy = y + (fiber.y % h);
          p.fill(fiber.warm ? 162 : 91, fiber.warm ? 139 : 100, fiber.warm ? 91 : 93, fiber.alpha * 0.6 * alpha);
          p.rect(fx, fy, Math.max(1, fiber.length * 0.28), 0.7);
        });
      }

      function drawForegroundGrain(t) {
        p.push();
        p.noStroke();
        for (let i = 0; i < 44; i += 1) {
          const x = (i * 83 + t * 5.2) % p.width;
          const y = (i * 47 + Math.sin(t * 0.7 + i) * 11 + p.height) % p.height;
          const warm = i % 3 !== 0;
          p.fill(warm ? 225 : 36, warm ? 205 : 37, warm ? 151 : 34, warm ? 13 : 9);
          p.circle(x, y, 0.8 + (i % 4) * 0.45);
        }
        p.pop();
      }

      function drawTinyMoon(x, y, radius) {
        p.push();
        p.noStroke();
        p.fill(238, 221, 159, 142);
        p.circle(x, y, radius * 2);
        p.fill(18, 24, 40, 125);
        p.circle(x + radius * 0.42, y - radius * 0.08, radius * 2);
        p.pop();
      }

      function drawPaperRect(x, y, w, h, radius, alpha) {
        p.fill(236, 228, 205, 226 * alpha);
        p.rect(x, y, w, h, radius);
        p.fill(252, 246, 227, 52 * alpha);
        p.rect(x + 5, y + 5, w - 10, h - 10, Math.max(1, radius - 2));
        p.stroke(82, 74, 57, 56 * alpha);
        p.noFill();
        p.rect(x, y, w, h, radius);
      }

      function drawGlow(x, y, radius, color, alpha) {
        if (alpha <= 0) return;
        p.noStroke();
        for (let i = 5; i >= 1; i -= 1) {
          p.fill(color[0], color[1], color[2], alpha * (0.012 + i * 0.024));
          p.circle(x, y, radius * i * 0.42);
        }
      }

      function mixColor(a, b, t) {
        return [
          p.lerp(a[0], b[0], t),
          p.lerp(a[1], b[1], t),
          p.lerp(a[2], b[2], t),
        ];
      }

      function rgba(r, g, b, a) {
        return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
      }

      function smoothstep(edge0, edge1, value) {
        const x = p.constrain((value - edge0) / (edge1 - edge0), 0, 1);
        return x * x * (3 - 2 * x);
      }

      function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
      }

      function easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      }

      function quadratic(a, b, c, t) {
        return Math.pow(1 - t, 2) * a + 2 * (1 - t) * t * b + t * t * c;
      }

      function quadraticDerivative(a, b, c, t) {
        return 2 * (1 - t) * (b - a) + 2 * t * (c - b);
      }
    }, el.riverCanvas);
  }

  function createLegacyRiverSketch(plaintext, onComplete) {
    return new window.p5((p) => {
      const palette = {
        night: [5, 18, 54],
        midnight: [7, 35, 86],
        ultramarine: [18, 82, 160],
        warmBlue: [84, 172, 226],
        sapphire: [66, 183, 255],
        paleGold: [255, 218, 120],
        moon: [255, 246, 210],
        paper: [255, 251, 241],
        ink: [24, 40, 54],
      };
      const waterColors = [
        [255, 246, 210],
        [255, 218, 120],
        [134, 211, 255],
        [255, 255, 255],
      ];

      let staticStars = [];
      let fogBands = [];
      let butterflies = [];
      let wordDrops = [];
      let ripples = [];
      let birds = [];
      let finalLayout = null;
      let startMillis = 0;
      let waterY = 0;
      let completed = false;
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
        drawStoryBackground(t);
        drawMoonAndStars(t);
        drawWaterStage(t);
        drawEnvelope(t);
        drawSapphireLaceRose(t);
        drawButterflies(t);
        drawWordRain(t);
        drawRipples(t);
        drawMemoryThreads(t);
        drawBoatPlaneAndBirds(t);
        drawDestination(t);
        drawFinalLetter(t);
        drawForegroundGrain(t);

        if (!completed && t > 36.5) {
          completed = true;
          if (typeof onComplete === "function") onComplete();
        }
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
        waterY = p.height * 0.68;
        completed = false;
        lastChimeAt = 0;
        chimeCount = 0;
        staticStars = buildStaticStars();
        fogBands = buildFogBands();
        butterflies = buildButterflies();
        wordDrops = buildWordDrops();
        birds = buildBirds();
        ripples = [];
        finalLayout = buildFinalLetterLayout();
      }

      function elapsed() {
        return (p.millis() - startMillis) / 1000;
      }

      function buildFullText() {
        return [
          plaintext.recipient ? `To ${plaintext.recipient}` : "",
          plaintext.title || "Untitled letter",
          "",
          plaintext.message || "",
        ].filter((line, index) => index < 3 || String(line).trim()).join("\n");
      }

      function buildStaticStars() {
        const count = p.width < 680 ? 120 : 190;
        const stars = [];
        for (let i = 0; i < count; i += 1) {
          stars.push({
            x: p.random(p.width),
            y: p.random(p.height * 0.02, p.height * 0.84),
            r: p.random(0.45, 1.75),
            phase: p.random(p.TWO_PI),
            alpha: p.random(80, 230),
            warm: p.random() > 0.45,
          });
        }
        return stars;
      }

      function buildFogBands() {
        const bands = [];
        for (let i = 0; i < 8; i += 1) {
          bands.push({
            y: p.random(p.height * 0.34, p.height * 0.82),
            width: p.random(p.width * 0.44, p.width * 0.9),
            height: p.random(22, 62),
            speed: p.random(0.04, 0.13),
            phase: p.random(p.TWO_PI),
          });
        }
        return bands;
      }

      function buildButterflies() {
        const count = p.width < 680 ? 8 : 13;
        const list = [];
        for (let i = 0; i < count; i += 1) {
          list.push({
            delay: 4.2 + i * 0.18 + p.random(0, 0.45),
            duration: p.random(6.2, 8.6),
            angle: (i / count) * p.TWO_PI + p.random(-0.4, 0.4),
            radius: p.random(110, Math.min(p.width, p.height) * 0.42),
            size: p.random(0.72, 1.24),
            phase: p.random(p.TWO_PI),
          });
        }
        return list;
      }

      function buildWordDrops() {
        const source = [...buildFullText()].filter((char) => /\S/.test(char));
        const maxDrops = p.width < 680 ? 360 : 720;
        const chars = source.slice(0, maxDrops);
        const list = [];
        const span = Math.max(1, chars.length - 1);
        for (let i = 0; i < chars.length; i += 1) {
          const u = i / span;
          const targetX = p.lerp(p.width * 0.1, p.width * 0.9, u);
          const riverWave = Math.sin(u * p.TWO_PI * 1.9) * p.height * 0.045;
          list.push({
            char: chars[i],
            index: i,
            start: 7.1 + u * 9.2 + p.random(0, 1.2),
            duration: p.random(4.7, 7.2),
            startX: targetX + p.random(-p.width * 0.12, p.width * 0.12),
            startY: p.random(-p.height * 0.42, -30),
            targetX,
            targetY: waterY + riverWave + p.random(-10, 10),
            size: p.random(13, 22),
            sway: p.random(14, 44),
            phase: p.random(p.TWO_PI),
            symbolSeed: Math.floor(p.random(4)),
            impacted: false,
          });
        }
        return list;
      }

      function buildBirds() {
        const count = p.width < 680 ? 18 : 34;
        const list = [];
        for (let i = 0; i < count; i += 1) {
          list.push({
            delay: 24.8 + p.random(0, 2.4),
            duration: p.random(5.8, 8.4),
            lane: i / Math.max(1, count - 1),
            size: p.random(8, 17),
            phase: p.random(p.TWO_PI),
            color: p.random() > 0.35 ? [255, 251, 241] : [255, 224, 141],
          });
        }
        return list;
      }

      function buildFinalLetterLayout() {
        const paperW = Math.min(p.width * 0.86, 640);
        const paperH = Math.min(p.height * 0.78, 520);
        const x = (p.width - paperW) / 2;
        const y = Math.max(24, (p.height - paperH) / 2);
        const padding = Math.max(22, Math.min(42, paperW * 0.08));
        let baseSize = Math.min(21, Math.max(12, p.width / 44));
        let lines = [];

        while (baseSize >= 10) {
          lines = [];
          const textWidth = paperW - padding * 2;
          const sections = [
            { text: plaintext.recipient ? `To ${plaintext.recipient}` : "", size: baseSize * 0.82, role: "recipient" },
            { text: plaintext.title || "Untitled letter", size: baseSize * 1.35, role: "title" },
            { text: "", size: baseSize, role: "gap" },
            { text: plaintext.message || "", size: baseSize, role: "message" },
          ];
          sections.forEach((section) => {
            if (!section.text) {
              lines.push({ text: "", size: section.size, role: section.role });
              return;
            }
            p.textSize(section.size);
            wrapText(section.text, textWidth).forEach((line) => lines.push({ text: line, size: section.size, role: section.role }));
          });
          const height = lines.reduce((sum, line) => sum + line.size * (line.role === "gap" ? 0.82 : 1.42), 0);
          if (height <= paperH - padding * 2 || baseSize <= 10) break;
          baseSize -= 1;
        }

        const glyphs = [];
        let cursorY = y + padding;
        let order = 0;
        const maxY = y + paperH - padding * 0.65;
        lines.forEach((line) => {
          const lineHeight = line.size * (line.role === "gap" ? 0.82 : 1.42);
          if (cursorY + lineHeight > maxY) return;
          p.textSize(line.size);
          let cursorX = x + padding;
          [...line.text].forEach((char) => {
            const width = p.textWidth(char || " ");
            glyphs.push({
              char,
              x: cursorX,
              y: cursorY,
              size: line.size,
              role: line.role,
              order,
            });
            order += 1;
            cursorX += width;
          });
          cursorY += lineHeight;
        });

        return { x, y, w: paperW, h: paperH, padding, glyphs };
      }

      function wrapText(text, maxWidth) {
        const lines = [];
        String(text || "").split("\n").forEach((paragraph) => {
          if (!paragraph.trim()) {
            lines.push("");
            return;
          }
          const hasSpaces = /\s/.test(paragraph);
          const tokens = hasSpaces ? paragraph.split(/\s+/) : [...paragraph];
          let line = "";
          tokens.forEach((token) => {
            const next = hasSpaces ? `${line}${line ? " " : ""}${token}` : `${line}${token}`;
            if (p.textWidth(next) <= maxWidth || !line) {
              line = next;
            } else {
              lines.push(line);
              line = token;
            }
          });
          if (line) lines.push(line);
        });
        return lines;
      }

      function drawStoryBackground(t) {
        const dawn = smoothstep(23.5, 32, t);
        const ctx = p.drawingContext;
        const gradient = ctx.createLinearGradient(0, 0, p.width, p.height);
        gradient.addColorStop(0, rgba(5 + dawn * 62, 18 + dawn * 54, 54 + dawn * 84, 1));
        gradient.addColorStop(0.44, rgba(9 + dawn * 58, 46 + dawn * 76, 114 + dawn * 82, 1));
        gradient.addColorStop(0.78, rgba(18 + dawn * 116, 83 + dawn * 91, 158 + dawn * 58, 1));
        gradient.addColorStop(1, rgba(3 + dawn * 220, 12 + dawn * 160, 32 + dawn * 72, 1));
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, p.width, p.height);

        const halo = ctx.createRadialGradient(p.width * 0.48, p.height * 0.43, 0, p.width * 0.48, p.height * 0.43, p.width * 0.62);
        halo.addColorStop(0, rgba(77, 178, 255, 0.18 * (1 - dawn) + 0.12));
        halo.addColorStop(0.5, rgba(255, 219, 130, 0.06 + dawn * 0.13));
        halo.addColorStop(1, rgba(0, 0, 0, 0));
        ctx.fillStyle = halo;
        ctx.fillRect(0, 0, p.width, p.height);

        drawFog(t, dawn);
      }

      function drawFog(t, dawn) {
        p.noStroke();
        fogBands.forEach((band, index) => {
          const x = ((t * band.speed * 60 + band.phase * 80 + index * 113) % (p.width + band.width)) - band.width * 0.5;
          const alpha = 16 + dawn * 18;
          p.fill(174, 218, 255, alpha);
          p.ellipse(x, band.y + Math.sin(t * 0.18 + band.phase) * 12, band.width, band.height);
        });
      }

      function drawMoonAndStars(t) {
        p.push();
        p.blendMode(p.ADD);
        staticStars.forEach((star) => {
          const twinkle = 0.68 + Math.sin(t * 1.2 + star.phase) * 0.32;
          const color = star.warm ? palette.paleGold : palette.moon;
          p.noStroke();
          p.fill(color[0], color[1], color[2], star.alpha * twinkle);
          p.circle(star.x, star.y, star.r * 2);
        });
        p.pop();

        const moonX = p.width * 0.82;
        const moonY = p.height * 0.16;
        p.push();
        p.blendMode(p.ADD);
        drawGlow(moonX, moonY, 62, palette.paleGold, 35);
        p.noStroke();
        p.fill(255, 245, 205, 210);
        p.circle(moonX, moonY, 36);
        p.fill(9, 40, 104, 210);
        p.circle(moonX + 12, moonY - 2, 36);
        p.pop();
      }

      function drawEnvelope(t) {
        const appear = 1 - smoothstep(4.6, 5.8, t);
        if (appear <= 0) return;
        const open = smoothstep(0.7, 2.3, t);
        const lift = smoothstep(1.8, 3.4, t);
        const cx = p.width * 0.5;
        const cy = p.height * 0.56 - lift * p.height * 0.2;
        const w = Math.min(210, p.width * 0.34);
        const h = w * 0.58;

        p.push();
        p.translate(cx, cy);
        p.noStroke();
        p.fill(0, 15, 45, 48 * appear);
        p.rect(-w / 2 + 8, -h / 2 + 10, w, h, 8);
        p.fill(255, 248, 232, 220 * appear);
        p.rect(-w / 2, -h / 2, w, h, 8);
        p.stroke(71, 121, 170, 120 * appear);
        p.strokeWeight(1.2);
        p.line(-w / 2, -h / 2, 0, 6);
        p.line(w / 2, -h / 2, 0, 6);
        p.line(-w / 2, h / 2, -8, 2);
        p.line(w / 2, h / 2, 8, 2);
        p.noStroke();
        p.fill(218, 241, 255, 190 * appear);
        p.beginShape();
        p.vertex(-w / 2, -h / 2);
        p.vertex(0, -h / 2 - open * 74);
        p.vertex(w / 2, -h / 2);
        p.vertex(0, 6);
        p.endShape(p.CLOSE);
        drawGlow(0, 4, 36 + open * 42, palette.sapphire, 45 * open * appear);
        p.fill(84, 172, 226, 210 * appear);
        p.circle(0, 6, 24);
        p.fill(255, 235, 175, 170 * open * appear);
        p.circle(0, 6, 9 + open * 4);
        p.pop();
      }

      function drawSapphireLaceRose(t) {
        const bloom = smoothstep(2.0, 7.2, t);
        const fade = 1 - smoothstep(11.2, 14.4, t);
        if (bloom <= 0 || fade <= 0) return;
        const cx = p.width * 0.5;
        const cy = p.height * 0.32 + Math.sin(t * 0.45) * 6;
        const scale = Math.min(p.width, p.height) / 610;

        p.push();
        p.translate(cx, cy);
        p.rotate(Math.sin(t * 0.22) * 0.14);
        p.scale(scale);
        p.blendMode(p.ADD);
        drawGlow(0, 0, 260 * bloom, palette.sapphire, 45 * fade);
        drawGlow(0, 0, 160 * bloom, palette.moon, 18 * fade);
        p.blendMode(p.BLEND);

        for (let ring = 4; ring >= 0; ring -= 1) {
          const petals = 6 + ring * 2;
          const ringBloom = p.constrain((bloom - ring * 0.07) / 0.62, 0, 1);
          for (let i = 0; i < petals; i += 1) {
            const angle = (i / petals) * p.TWO_PI + ring * 0.32 + t * 0.08 * (ring % 2 ? -1 : 1);
            const length = p.lerp(28, 86 + ring * 18, ringBloom);
            const width = p.lerp(12, 32 + ring * 7, ringBloom);
            const offset = ring * 10 * ringBloom;
            drawLacePetal(angle, offset, length, width, ring, i, fade, ringBloom);
          }
        }

        p.noStroke();
        p.fill(210, 241, 255, 175 * fade);
        p.circle(0, 0, 24 * bloom);
        p.fill(255, 230, 150, 120 * fade);
        p.circle(0, 0, 9 * bloom);
        p.pop();
      }

      function drawLacePetal(angle, offset, length, width, ring, index, alpha, bloom) {
        p.push();
        p.rotate(angle);
        p.translate(offset, 0);
        p.rotate(Math.sin(index + ring) * 0.18 * (1 - bloom));
        const rich = p.map(ring, 0, 4, 0.5, 1);
        p.fill(55, 172, 246, 28 * alpha + rich * 20);
        p.stroke(172, 231, 255, 86 * alpha);
        p.strokeWeight(1.1);
        p.beginShape();
        p.vertex(0, 0);
        p.bezierVertex(length * 0.18, -width * 0.92, length * 0.78, -width * 0.72, length, 0);
        p.bezierVertex(length * 0.78, width * 0.72, length * 0.18, width * 0.92, 0, 0);
        p.endShape(p.CLOSE);

        p.stroke(230, 247, 255, 92 * alpha);
        p.strokeWeight(0.72);
        for (let i = 1; i <= 4; i += 1) {
          const u = i / 5;
          p.line(length * 0.08, 0, length * (0.18 + u * 0.68), Math.sin(i + ring) * width * 0.32);
          p.noFill();
          p.arc(length * (0.18 + u * 0.14), 0, width * (0.9 + u), width * (0.34 + u * 0.16), -0.9, 0.9);
        }
        p.stroke(255, 244, 205, 48 * alpha);
        for (let i = 0; i < 8; i += 1) {
          const u = (i + 0.5) / 8;
          p.point(length * u, Math.sin(u * Math.PI * 5 + ring) * width * 0.32);
        }
        p.pop();
      }

      function drawButterflies(t) {
        butterflies.forEach((butterfly) => {
          const local = p.constrain((t - butterfly.delay) / butterfly.duration, 0, 1);
          if (local <= 0 || local >= 1) return;
          const rise = easeOutCubic(local);
          const cx = p.width * 0.5;
          const cy = p.height * 0.32;
          const angle = butterfly.angle + rise * p.TWO_PI * 1.25;
          const radius = butterfly.radius * rise;
          const x = cx + Math.cos(angle) * radius;
          const y = cy + Math.sin(angle) * radius * 0.55 - rise * p.height * 0.18;
          const alpha = Math.sin(local * Math.PI);
          drawButterfly(x, y, butterfly.size * (0.8 + rise * 0.55), angle, alpha, t + butterfly.phase);
        });
      }

      function drawButterfly(x, y, scale, angle, alpha, wingT) {
        const flap = 0.72 + Math.sin(wingT * 9) * 0.28;
        p.push();
        p.translate(x, y);
        p.rotate(angle * 0.25);
        p.scale(scale);
        p.blendMode(p.ADD);
        p.stroke(222, 244, 255, 135 * alpha);
        p.strokeWeight(1);
        p.noFill();
        p.bezier(0, 0, -17 * flap, -18, -32 * flap, -6, -11, 5);
        p.bezier(0, 0, 17 * flap, -18, 32 * flap, -6, 11, 5);
        p.bezier(0, 2, -13 * flap, 12, -25 * flap, 19, -5, 22);
        p.bezier(0, 2, 13 * flap, 12, 25 * flap, 19, 5, 22);
        p.stroke(255, 226, 148, 70 * alpha);
        p.line(0, -7, 0, 13);
        p.pop();
      }

      function drawWaterStage(t) {
        const appear = smoothstep(5.8, 8.2, t);
        if (appear <= 0) return;
        const ctx = p.drawingContext;
        const gradient = ctx.createLinearGradient(0, waterY - 90, 0, p.height);
        gradient.addColorStop(0, rgba(54, 162, 230, 0));
        gradient.addColorStop(0.18, rgba(110, 198, 255, 0.18 * appear));
        gradient.addColorStop(0.56, rgba(12, 60, 133, 0.42 * appear));
        gradient.addColorStop(1, rgba(3, 14, 42, 0.74 * appear));
        ctx.fillStyle = gradient;
        ctx.fillRect(0, waterY - 100, p.width, p.height - waterY + 100);

        p.push();
        p.blendMode(p.ADD);
        p.noFill();
        for (let i = 0; i < 8; i += 1) {
          p.stroke(155, 219, 255, (18 - i) * appear);
          p.strokeWeight(1);
          p.beginShape();
          for (let x = -20; x <= p.width + 20; x += 28) {
            const y = waterY + Math.sin(x * 0.012 + t * 0.7 + i) * (3 + i * 1.5) + i * 7;
            p.curveVertex(x, y);
          }
          p.endShape();
        }
        p.pop();
      }

      function drawWordRain(t) {
        const rainAppear = smoothstep(6.5, 9.2, t);
        if (rainAppear <= 0) return;
        p.push();
        p.textFont("Georgia");
        wordDrops.forEach((drop) => {
          const local = p.constrain((t - drop.start) / drop.duration, 0, 1);
          if (local <= 0) return;
          if (local < 1) {
            const fall = easeInOutCubic(local);
            const x = p.lerp(drop.startX, drop.targetX, fall) + Math.sin(t * 1.1 + drop.phase) * drop.sway * (1 - fall * 0.65);
            const y = p.lerp(drop.startY, drop.targetY, fall);
            drawRainThread(x, y, drop, fall, rainAppear);
            drawConstellationLetter(x, y, drop, 1 - fall * 0.12, rainAppear);
          } else {
            if (!drop.impacted) {
              drop.impacted = true;
              ripples.push({ x: drop.targetX, y: drop.targetY, born: t, strength: p.random(0.75, 1.25) });
              if (t - lastChimeAt > 0.06 && chimeCount < 80) {
                lastChimeAt = t;
                chimeCount += 1;
                playWaterChime(0.44, p.map(drop.targetX, 0, p.width, -0.7, 0.7));
              }
            }
            drawSettledOrLiftedDrop(drop, t);
          }
        });
        p.pop();
      }

      function drawRainThread(x, y, drop, fall, alpha) {
        p.push();
        p.blendMode(p.ADD);
        p.stroke(190, 231, 255, 48 * alpha * (1 - fall * 0.15));
        p.strokeWeight(0.75);
        p.line(x, Math.max(0, y - 150), x + Math.sin(drop.phase) * 5, y - 10);
        p.pop();
      }

      function drawConstellationLetter(x, y, drop, scale, alpha) {
        p.push();
        p.translate(x, y);
        p.scale(scale);
        p.blendMode(p.ADD);
        drawGlow(0, 0, drop.size * 3.1, palette.paleGold, 36 * alpha);
        p.textAlign(p.CENTER, p.CENTER);
        p.textSize(drop.size);
        p.noStroke();
        p.fill(255, 246, 210, 225 * alpha);
        p.text(drop.char, 0, 0);

        const symbols = ["*", "o", "·", "◦"];
        for (let i = 0; i < 5; i += 1) {
          const angle = drop.phase + i * 1.26;
          const radius = drop.size * (0.42 + (i % 3) * 0.18);
          const sx = Math.cos(angle) * radius;
          const sy = Math.sin(angle) * radius;
          const color = waterColors[(drop.symbolSeed + i) % waterColors.length];
          p.fill(color[0], color[1], color[2], 140 * alpha);
          if (i % 2 === 0) {
            drawTinyMoon(sx, sy, 2.8);
          } else {
            p.textSize(6);
            p.text(symbols[(drop.symbolSeed + i) % symbols.length], sx, sy);
          }
        }
        p.pop();
      }

      function drawSettledOrLiftedDrop(drop, t) {
        const lift = smoothstep(22.1, 25.8, t);
        if (lift <= 0) {
          p.push();
          p.blendMode(p.ADD);
          const pulse = 0.58 + Math.sin(t * 2.5 + drop.phase) * 0.28;
          p.fill(255, 229, 145, 72 * pulse);
          p.noStroke();
          p.circle(drop.targetX, drop.targetY + Math.sin(t + drop.phase) * 2, 3.2);
          if (drop.index % 5 === 0) {
            p.textAlign(p.CENTER, p.CENTER);
            p.textSize(10);
            p.fill(214, 241, 255, 75);
            p.text(drop.char, drop.targetX, drop.targetY - 5);
          }
          p.pop();
          return;
        }

        if (lift < 1 && drop.index % 2 === 0) {
          const plane = airplanePoint(t);
          const delay = (drop.index % 60) / 60;
          const local = p.constrain((lift - delay * 0.45) / 0.74, 0, 1);
          if (local <= 0) return;
          const curve = Math.sin(local * Math.PI) * p.height * 0.18;
          const x = p.lerp(drop.targetX, plane.x - 40 + Math.sin(drop.phase) * 35, local);
          const y = p.lerp(drop.targetY, plane.y + Math.cos(drop.phase) * 22, local) - curve;
          p.push();
          p.blendMode(p.ADD);
          p.stroke(255, 231, 146, 48 * (1 - local));
          p.line(drop.targetX, drop.targetY, x, y);
          p.noStroke();
          p.fill(255, 246, 210, 170 * (1 - local * 0.35));
          p.circle(x, y, 2.8 * (1 - local * 0.45));
          p.pop();
        }
      }

      function drawRipples(t) {
        ripples = ripples.filter((ripple) => t - ripple.born < 6.2);
        if (!ripples.length) return;
        p.push();
        p.blendMode(p.ADD);
        p.noFill();
        ripples.forEach((ripple) => {
          const age = t - ripple.born;
          const fade = Math.max(0, 1 - age / 6.2);
          for (let i = 0; i < 3; i += 1) {
            const radius = (age * 24 + i * 18) * ripple.strength;
            p.stroke(255, 232, 150, 38 * fade * (1 - i * 0.18));
            p.strokeWeight(1);
            p.ellipse(ripple.x, ripple.y, radius * 2.7, radius * 0.52);
          }
        });
        p.pop();
      }

      function drawMemoryThreads(t) {
        const active = smoothstep(14, 20, t) * (1 - smoothstep(25, 29, t));
        if (active <= 0) return;
        const points = wordDrops.filter((drop) => drop.impacted && drop.index % 13 === 0);
        p.push();
        p.blendMode(p.ADD);
        p.noFill();
        for (let i = 1; i < points.length; i += 1) {
          const a = points[i - 1];
          const b = points[i];
          p.stroke(255, 229, 145, 18 * active);
          p.line(a.targetX, a.targetY, b.targetX, b.targetY);
        }
        p.pop();
      }

      function drawBoatPlaneAndBirds(t) {
        if (t < 8.6) return;
        const boat = boatPoint(t);
        const tremble = recentRippleTremble(t, boat.x);
        const fold = smoothstep(19.8, 22.2, t);
        const takeoff = smoothstep(22.0, 25.9, t);

        if (takeoff <= 0.02) {
          drawBoatPlaneMorph(boat.x, boat.y + tremble, fold, t);
        } else if (takeoff < 1) {
          const plane = airplanePoint(t);
          drawPaperAirplane(plane.x, plane.y, plane.angle, 1.0, 245);
          drawLiftTrails(plane, t);
        }

        drawCityscapeMusic(t);
        drawBirds(t);
      }

      function boatPoint(t) {
        const u = smoothstep(8.5, 19.8, t);
        return {
          x: p.lerp(p.width * 0.08, p.width * 0.64, u),
          y: waterY + 21 + Math.sin(t * p.TWO_PI * 0.6) * 3,
        };
      }

      function airplanePoint(t) {
        const u = smoothstep(22, 26.4, t);
        const x0 = p.width * 0.64;
        const y0 = waterY + 8;
        const x1 = p.width * 0.55;
        const y1 = p.height * 0.31;
        const x2 = p.width * 0.86;
        const y2 = p.height * 0.2;
        const x = quadratic(x0, x1, x2, u);
        const y = quadratic(y0, y1, y2, u);
        const dx = quadraticDerivative(x0, x1, x2, u);
        const dy = quadraticDerivative(y0, y1, y2, u);
        return { x, y, angle: Math.atan2(dy, dx) };
      }

      function recentRippleTremble(t, x) {
        let tremble = 0;
        ripples.forEach((ripple) => {
          const age = t - ripple.born;
          const reach = age * 35 + 40;
          const influence = Math.max(0, 1 - Math.abs(x - ripple.x) / reach) * Math.max(0, 1 - age / 4.4);
          tremble += Math.sin(age * 9) * influence * 4;
        });
        return tremble;
      }

      function drawBoatPlaneMorph(x, y, fold, t) {
        p.push();
        p.translate(x, y);
        p.stroke(255, 251, 241, 230);
        p.strokeWeight(1.4);
        p.fill(255, 255, 255, 26);
        if (fold < 0.02) {
          const w = 42;
          p.noFill();
          p.line(-w / 2, 0, -w * 0.18, 13);
          p.line(-w * 0.18, 13, w * 0.16, 13);
          p.line(w * 0.16, 13, w / 2, 0);
          p.line(-w / 2, 0, 0, -18);
          p.line(0, -18, w / 2, 0);
          p.line(-w * 0.18, 13, 0, 0);
          p.line(0, 0, w * 0.16, 13);
        } else {
          const wing = p.lerp(22, 48, fold);
          const nose = p.lerp(-3, 44, fold);
          const tail = p.lerp(-22, -28, fold);
          p.beginShape();
          p.vertex(tail, -5);
          p.vertex(nose, 0);
          p.vertex(tail, 12);
          p.vertex(-7, 1 + Math.sin(t * 3) * 1.2);
          p.endShape(p.CLOSE);
          p.line(-7, 1, tail + 8, -11);
          p.line(-7, 1, tail + 8, 18);
          p.line(-7, 1, wing * 0.45, 0);
        }
        p.pop();
      }

      function drawPaperAirplane(x, y, angle, scale, alpha) {
        p.push();
        p.translate(x, y);
        p.rotate(angle);
        p.scale(scale);
        p.stroke(255, 251, 241, alpha);
        p.strokeWeight(1.35);
        p.fill(255, 255, 255, 42);
        p.beginShape();
        p.vertex(-30, -10);
        p.vertex(42, 0);
        p.vertex(-30, 17);
        p.vertex(-9, 2);
        p.endShape(p.CLOSE);
        p.line(-9, 2, -28, -10);
        p.line(-9, 2, -25, 19);
        p.line(-9, 2, 42, 0);
        p.pop();
      }

      function drawLiftTrails(plane, t) {
        p.push();
        p.blendMode(p.ADD);
        p.noFill();
        for (let i = 0; i < 7; i += 1) {
          p.stroke(255, 225, 138, 54 - i * 5);
          p.beginShape();
          p.curveVertex(plane.x - i * 19, plane.y + Math.sin(t + i) * 12);
          p.curveVertex(plane.x - i * 28, plane.y + 18 + i * 6);
          p.curveVertex(plane.x - i * 48, waterY - i * 4);
          p.curveVertex(plane.x - i * 78, waterY + 24 + Math.sin(i) * 10);
          p.endShape();
        }
        p.pop();
      }

      function drawCityscapeMusic(t) {
        const appear = smoothstep(24.2, 29.4, t);
        if (appear <= 0) return;
        p.push();
        p.blendMode(p.BLEND);
        p.noFill();
        p.stroke(255, 232, 158, 58 * appear);
        p.strokeWeight(1);
        for (let staff = 0; staff < 5; staff += 1) {
          p.beginShape();
          for (let x = -20; x < p.width + 40; x += 36) {
            const y = p.height * 0.42 + staff * 16 + Math.sin(x * 0.013 + t * 0.28) * 18;
            p.curveVertex(x, y);
          }
          p.endShape();
        }
        p.noStroke();
        p.fill(9, 35, 75, 115 * appear);
        const baseY = p.height * 0.78;
        for (let i = 0; i < 18; i += 1) {
          const x = (i / 18) * p.width;
          const w = 26 + (i % 4) * 9;
          const h = 34 + (i % 5) * 13;
          p.rect(x, baseY - h, w, h);
          p.triangle(x - 2, baseY - h, x + w / 2, baseY - h - 18, x + w + 2, baseY - h);
          p.fill(255, 226, 142, 65 * appear);
          p.rect(x + 7, baseY - h + 12, 5, 8);
          p.rect(x + w - 12, baseY - h + 22, 5, 8);
          p.fill(9, 35, 75, 115 * appear);
        }
        p.stroke(255, 246, 210, 72 * appear);
        p.strokeWeight(1);
        p.line(p.width * 0.06, baseY - 20, p.width * 0.92, baseY - 20);
        p.pop();
      }

      function drawBirds(t) {
        const appear = smoothstep(24.8, 27, t);
        if (appear <= 0) return;
        birds.forEach((bird, index) => {
          const local = p.constrain((t - bird.delay) / bird.duration, 0, 1);
          if (local <= 0 || local >= 1) return;
          const u = easeInOutCubic(local);
          const startX = p.width * (0.36 + (index % 6) * 0.035);
          const startY = p.height * (0.28 + (index % 5) * 0.034);
          const endX = p.width * (0.76 + bird.lane * 0.18);
          const endY = p.height * (0.18 + Math.sin(bird.lane * Math.PI) * 0.19);
          const x = p.lerp(startX, endX, u);
          const y = p.lerp(startY, endY, u) + Math.sin(t * 2 + bird.phase) * 12;
          const alpha = Math.sin(local * Math.PI) * 210 * appear;
          drawOrigamiBird(x, y, bird.size, Math.sin(t + bird.phase) * 0.24, bird.color, alpha);
        });
      }

      function drawOrigamiBird(x, y, size, tilt, color, alpha) {
        p.push();
        p.translate(x, y);
        p.rotate(tilt);
        p.stroke(color[0], color[1], color[2], alpha);
        p.strokeWeight(1.05);
        p.fill(color[0], color[1], color[2], alpha * 0.08);
        p.beginShape();
        p.vertex(0, 0);
        p.vertex(-size * 1.4, -size * 0.38);
        p.vertex(-size * 0.28, size * 0.18);
        p.vertex(0, 0);
        p.vertex(size * 1.4, -size * 0.38);
        p.vertex(size * 0.3, size * 0.18);
        p.endShape();
        p.line(-size * 0.28, size * 0.18, 0, size * 0.74);
        p.line(size * 0.3, size * 0.18, 0, size * 0.74);
        p.pop();
      }

      function drawDestination(t) {
        const appear = smoothstep(27.6, 31, t);
        if (appear <= 0) return;
        const x = p.width * 0.76;
        const y = p.height * 0.18;
        p.push();
        p.blendMode(p.ADD);
        drawGlow(x, y, 130, palette.paleGold, 42 * appear);
        p.pop();
        p.noStroke();
        p.fill(255, 244, 204, 220 * appear);
        p.textAlign(p.CENTER, p.CENTER);
        p.textFont("Georgia");
        p.textSize(Math.min(24, Math.max(15, p.width / 42)));
        p.text("Destination of Love", x, y);
      }

      function drawFinalLetter(t) {
        const unfold = smoothstep(30.8, 33.2, t);
        if (unfold <= 0) return;
        const cx = finalLayout.x + finalLayout.w / 2;
        const cy = finalLayout.y + finalLayout.h / 2;
        p.push();
        p.translate(cx, cy);
        p.rotate((1 - unfold) * -0.12);
        p.scale(0.26 + unfold * 0.74, 0.08 + unfold * 0.92);
        p.translate(-cx, -cy);
        drawLetterPaper(unfold);
        p.pop();

        const revealStart = 32.7;
        p.push();
        p.textFont("Georgia");
        p.textAlign(p.LEFT, p.TOP);
        finalLayout.glyphs.forEach((glyph) => {
          const local = smoothstep(revealStart + glyph.order * 0.018, revealStart + glyph.order * 0.018 + 0.55, t);
          if (local <= 0) return;
          const bounce = Math.sin(local * Math.PI) * 7;
          const alpha = 235 * local;
          p.textSize(glyph.size);
          if (glyph.role === "recipient") {
            p.fill(28, 109, 174, alpha);
          } else if (glyph.role === "title") {
            p.fill(16, 45, 74, alpha);
          } else {
            p.fill(25, 46, 58, alpha);
          }
          p.text(glyph.char, glyph.x, glyph.y - bounce);
        });
        p.pop();
      }

      function drawLetterPaper(alpha) {
        const { x, y, w, h } = finalLayout;
        p.noStroke();
        p.fill(0, 21, 44, 56 * alpha);
        p.rect(x + 12, y + 14, w, h, 10);
        p.fill(255, 251, 241, 240 * alpha);
        p.rect(x, y, w, h, 10);
        p.stroke(255, 219, 132, 45 * alpha);
        p.strokeWeight(1);
        for (let lineY = y + finalLayout.padding + 46; lineY < y + h - finalLayout.padding * 0.5; lineY += 28) {
          p.line(x + finalLayout.padding, lineY, x + w - finalLayout.padding, lineY);
        }
        p.noFill();
        p.stroke(93, 166, 208, 72 * alpha);
        p.rect(x + 10, y + 10, w - 20, h - 20, 8);
      }

      function drawForegroundGrain(t) {
        p.push();
        p.blendMode(p.ADD);
        for (let i = 0; i < 18; i += 1) {
          const x = (i * 97 + t * 9) % p.width;
          const y = (i * 47 + Math.sin(t + i) * 16) % p.height;
          p.noStroke();
          p.fill(255, 236, 172, 18);
          p.circle(x, y, 1.2 + (i % 3));
        }
        p.pop();
      }

      function drawTinyMoon(x, y, radius) {
        p.push();
        p.noStroke();
        p.fill(255, 239, 177, 160);
        p.circle(x, y, radius * 2);
        p.fill(18, 82, 160, 130);
        p.circle(x + radius * 0.45, y - radius * 0.12, radius * 2);
        p.pop();
      }

      function drawGlow(x, y, radius, color, alpha) {
        p.noStroke();
        for (let i = 5; i >= 1; i -= 1) {
          p.fill(color[0], color[1], color[2], alpha * (0.02 + i * 0.035));
          p.circle(x, y, radius * i * 0.44);
        }
      }

      function rgba(r, g, b, a) {
        return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
      }

      function smoothstep(edge0, edge1, value) {
        const x = p.constrain((value - edge0) / (edge1 - edge0), 0, 1);
        return x * x * (3 - 2 * x);
      }

      function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
      }

      function easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      }

      function quadratic(a, b, c, t) {
        return Math.pow(1 - t, 2) * a + 2 * (1 - t) * t * b + t * t * c;
      }

      function quadraticDerivative(a, b, c, t) {
        return 2 * (1 - t) * (b - a) + 2 * t * (c - b);
      }
    }, el.riverCanvas);
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
