
const MAX_TEXT = 500;
let socket = null;
let myName = null;
let reconnectDelay = 500;
let lastTypingSent = 0;
// Declared up here (rather than next to its own helpers) because the first
// layout/list pass runs during module evaluation, and a `const` further down
// would still be in its temporal dead zone at that point.
const verifiedSet = new Set();
function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function lsSet(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }
function hasEmoji(s) {
  return /(?:\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDC00-\uDFFF]|[\u00A9\u00AE\u2122\u2139\u2194-\u2199\u21A9\u21AA\u231A\u231B\u2328\u23CF\u23E9-\u23F3\u23F8-\u23FA\u24C2\u25AA\u25AB\u25B6\u25C0\u25FB-\u25FE\u2600-\u27BF\u2934\u2935\u2B05-\u2B07\u2B1B\u2B1C\u2B50\u2B55\u3030\u303D\u3297\u3299\uFE0F\u200D\u20E3])/.test(s);
}
function nameLetterCount(n) { const m = String(n || "").match(/[A-Za-z]/g); return m ? m.length : 0; }
function nameCharsOk(n) { return /^[A-Za-z0-9 _-]+$/.test(String(n || "")); }
function nameRuleMsg(n) {
  if (!n || Array.from(String(n)).length < 4) return "Name must be at least 4 characters";
  if (hasEmoji(n)) return "Emojis are not allowed in names";
  if (!nameCharsOk(n)) return "Only letters, numbers, - and _ are allowed in names";
  if (nameLetterCount(n) < 4) return "Name must contain at least 4 letters";
  return "";
}
function isSingleEmoji(s) {
  const t = String(s == null ? "" : s).trim();
  if (!t || t.length > 32) return false;
  let graphemes;
  try {
    graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(t)].map((x) => x.segment);
  } catch (e) {
    graphemes = Array.from(t);
  }
  if (graphemes.length !== 1) return false;
  return hasEmoji(t);
}
function isEmojiOnlyText(s) {
  const t = String(s == null ? "" : s).trim();
  if (!t) return false;
  let graphemes;
  try {
    graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(t)].map((x) => x.segment);
  } catch (e) {
    graphemes = Array.from(t);
  }
  const nonSpace = graphemes.filter((g) => g.trim() !== "");
  return nonSpace.length > 0 && nonSpace.every((g) => hasEmoji(g));
}
function syncEmojiClass(bubble, text) {
  const bt = bubble ? bubble.querySelector(".btext") : null;
  if (!bt) return;
  const only = isSingleEmoji(text);
  bubble.classList.toggle("emojiOnly", only);
  bt.classList.toggle("emojiOnlyText", only);
}
let savedNick = lsGet("tgNick_" + (window.generatorName || "chat"));
let savedAdminPass = lsGet("tgAdminPass_" + (window.generatorName || "chat"));
let savedNickApplied = false;
let joinedOnce = false;
const nickKvKey = "tgNick_" + (window.generatorName || "chat");
const adminKvKey = "tgAdminPass_" + (window.generatorName || "chat");

// ---------- identity ----------
// A nickname is neither unique nor permanent, so "is this message mine?" must
// not depend on it: two people can pick the same name (messages then swap
// sides / get attributed to the wrong person), and a name may not be applied
// yet when history is rendered (own messages land on the left after a refresh).
// Instead every browser gets a stable uid that rides along with every message.
const uidKvKey = "tgUid_" + (window.generatorName || "chat");
function newUid() {
  try { if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, ""); } catch (e) {}
  return "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
const hadStoredUid = !!lsGet(uidKvKey);
let myUid = lsGet(uidKvKey) || newUid();
if (!hadStoredUid) lsSet(uidKvKey, myUid);

// Every uid this browser has ever held. Messages already sitting in the shared
// stores keep whatever uid they were stamped with, so an ownership test must ask
// whether a message's uid is *one of ours* rather than *the current one* - the
// current one is replaced whenever this browser's storage for the generator is
// lost (or restored a moment later from kv, below).
const uidsKey = "tgUids_" + (window.generatorName || "chat");
const myUids = (() => {
  let a = [];
  try { a = JSON.parse(lsGet(uidsKey) || "[]"); } catch (e) { a = []; }
  return new Set(Array.isArray(a) ? a.map(String) : []);
})();
function rememberMyUid(u) {
  u = String(u || "");
  if (!u) return;
  myUids.add(u);
  try { lsSet(uidsKey, JSON.stringify([...myUids])); } catch (e) {}
}
rememberMyUid(myUid);

// Timestamps of the messages this browser sent. Durable history rows carry no
// uid (the shared table has no such column), so own messages reloaded from
// history are recognised by this ledger, with the nickname as a last resort.
const sentTsKey = "tgSent_" + (window.generatorName || "chat");
let mySentTs = (() => {
  try {
    const a = JSON.parse(lsGet(sentTsKey) || "[]");
    return new Set(Array.isArray(a) ? a.map(String) : []);
  } catch (e) { return new Set(); }
})();
function rememberSentTs(ts) {
  if (ts == null) return;
  mySentTs.add(String(ts));
  while (mySentTs.size > 800) mySentTs.delete(mySentTs.values().next().value);
  try { lsSet(sentTsKey, JSON.stringify([...mySentTs])); } catch (e) {}
}
function isMine(m) {
  if (!m) return false;
  // A private thread has exactly two participants, so "not the other one" is
  // "me" - which stays true even after our uid changed and every stored message
  // came back stamped with the old one (the classic "my own messages are on the
  // left after a refresh" case).
  const peer = dmContextPeer();
  if (peer && m.from) return m.from !== peer;
  if (m.uid) return myUids.has(m.uid);
  if (m.ts != null && mySentTs.has(String(m.ts))) return true;
  return !!myName && m.from === myName;
}
// The peer of the private thread that is currently being rendered (or acted on),
// read off the container's own `data-peer`; "" in the room. Both the live
// container and every stashed thread are stamped with it.
function dmContextPeer() {
  const h = msgHost || messagesEl;
  return (h && h.dataset && h.dataset.peer) || "";
}
// Reserved names that need a password. The real check is on the server; this
// list only drives the "show password field" UI. Keep in sync with
// PROTECTED_USERS in the server script.
const PROTECTED_NAMES = ["Anya", "Jonathan"];
function protectedNameFor(v) {
  const n = String(v || "").trim().toLowerCase();
  for (const p of PROTECTED_NAMES) if (p.toLowerCase() === n) return p;
  return null;
}
function needsPass(name) { return !!String(name || "").trim(); }
let kvNickChecked = false;
async function ensureKvNick() {
  if (kvNickChecked || !root.kv || !root.kv.identity) return;
  kvNickChecked = true;
  try {
    if (!savedNick) {
      const n = await root.kv.identity.get(nickKvKey);
      if (n) savedNick = n;
    }
    if (!savedAdminPass) {
      const p = await root.kv.identity.get(adminKvKey);
      if (p) savedAdminPass = p;
    }
    if (!hadStoredUid) {
      const u = await root.kv.identity.get(uidKvKey);
      if (u && /^[A-Za-z0-9_-]{6,40}$/.test(String(u))) { myUid = String(u); lsSet(uidKvKey, myUid); rememberMyUid(myUid); }
    }
  } catch (e) {}
}
function persistNick(name, pass) {
  lsSet("tgNick_" + (window.generatorName || "chat"), name);
  if (root.kv && root.kv.identity) root.kv.identity.set(nickKvKey, name).catch(() => {});
  if (pass) {
    lsSet("tgAdminPass_" + (window.generatorName || "chat"), pass);
    if (root.kv && root.kv.identity) root.kv.identity.set(adminKvKey, pass).catch(() => {});
  }
}
function clearSavedPass() {
  savedAdminPass = "";
  lsSet("tgAdminPass_" + (window.generatorName || "chat"), "");
  if (root.kv && root.kv.identity) root.kv.identity.delete(adminKvKey).catch(() => {});
}
function promptNickReentry() {
  clearSavedPass();
  forceNick();
}
// The server refuses a nickname that a different live person is already using,
// so the two never share a name (which is what made messages appear under the
// wrong person). Ask for another and prefill the taken one for quick editing.
function showNameTaken(name) {
  toast("\u201C" + (name || "That name") + "\u201D is already in use \u2014 please pick another name");
  forceNick();
  if (name) {
    nickInput.value = name;
    nickInput.dispatchEvent(new Event("input"));
    nickInput.focus();
  }
}
const clearedKey = "tgCleared_" + (window.generatorName || "chat");
let clearedAt = Number(lsGet(clearedKey)) || 0;
const lastSeenKey = "tgLastSeen_" + (window.generatorName || "chat");
let lastSeenAt = Number(lsGet(lastSeenKey)) || 0;
function markSeen() {
  if (document.visibilityState === "hidden") return;
  if (convo.mode === "dm") { if (isNearBottom()) markDmRead(); return; }
  if (convo.mode !== "room") return;
  if (isNearBottom()) clearUnreadState();
}
setInterval(markSeen, 5000);

/* The chat area the app draws into. `messagesEl` is whatever conversation is on
   screen - the room by default, the private-chat container while one is open -
   so every existing helper (history, reactions, selection, typing, translation)
   keeps working untouched. The room's own DOM is never torn down; it just sits
   where it is, hidden, while a private chat is up. */
const roomMessagesEl = document.getElementById("messagesEl");
const dmMessagesEl = document.getElementById("dmMessagesEl");
let messagesEl = roomMessagesEl;
const onlineSub = document.getElementById("onlineSub");
let onlineCount = 0;
const msgInput = document.getElementById("msgInput");
const sendBtn = document.getElementById("sendBtn");
const SEND_BTN_HTML = sendBtn.innerHTML;
const micBtn = document.getElementById("micBtn");
const menuBtn = document.getElementById("menuBtn");
const menuPop = document.getElementById("menuPop");
const nickItem = document.getElementById("nickItem");
const soundItem = document.getElementById("soundItem");
const nickModal = document.getElementById("nickModal");
const nickInput = document.getElementById("nickInput");
const nickPassInput = document.getElementById("nickPassInput");
const nickOkBtn = document.getElementById("nickOkBtn");
const nickCancelBtn = document.getElementById("nickCancelBtn");
const emojiBtn = document.getElementById("emojiBtn");
const avatar = document.getElementById("avatar");
const chatTitle = document.getElementById("chatTitle");
const titleEditBtn = document.getElementById("titleEditBtn");
const adminEyeBtn = null; // removed: view-as eye dropped per privacy terms
const titleModal = document.getElementById("titleModal");
const titleInput = document.getElementById("titleInput");
const titleOkBtn = document.getElementById("titleOkBtn");
const titleCancelBtn = document.getElementById("titleCancelBtn");
const iconBtn = document.getElementById("iconBtn");
const iconModal = document.getElementById("iconModal");
const iconDesc = document.getElementById("iconDesc");
const iconInput = document.getElementById("iconInput");
const iconUploadBtn = document.getElementById("iconUploadBtn");
const iconRemoveBtn = document.getElementById("iconRemoveBtn");
const iconCancelBtn = document.getElementById("iconCancelBtn");
const avatarLetter = document.getElementById("avatarLetter");
const onlineModal = document.getElementById("onlineModal");
const onlineTitle = document.getElementById("onlineTitle");
const onlineBody = document.getElementById("onlineBody");
const onlineCloseBtn = document.getElementById("onlineCloseBtn");
let onlineTimer = null;

let currentIconUrl = "";
function applyIcon(url) {
  currentIconUrl = url || "";
  avatar.style.backgroundImage = url ? "url('" + url + "')" : "";
  avatar.style.backgroundSize = url ? "cover" : "";
  avatar.style.backgroundPosition = url ? "center" : "";
  avatar.style.color = url ? "transparent" : "";
  avatar.classList.toggle("hasPfp", !!url);
}
avatar.addEventListener("click", (e) => {
  // In a private chat the header avatar is the other person, not the group.
  const url = convo.mode === "dm" ? pfpFor(convo.peer) : currentIconUrl;
  if (!url || e.target.closest("#iconBtn")) return;
  openLightbox(url);
});
const field = document.getElementById("field");
const recBar = document.getElementById("recBar");
const composeBar = document.getElementById("composeBar");
const appHost = document.getElementById("app");
function syncComposeH() {
  if (document.getElementById("app").classList.contains("selMode")) return;
  // Hiding the composer (the people screen) would otherwise report a height of
  // zero and collapse the message area's bottom padding.
  const h = composeBar.offsetHeight;
  if (h > 0) appHost.style.setProperty("--compose-h", h + "px");
}
if (typeof ResizeObserver !== "undefined") new ResizeObserver(syncComposeH).observe(composeBar);
syncComposeH();
const recTime = document.getElementById("recTime");
const recCancelBtn = document.getElementById("recCancelBtn");
const attachBtn = document.getElementById("attachBtn");
const imgInput = document.getElementById("imgInput");
const clearItem = document.getElementById("clearItem");
const clearModal = document.getElementById("clearModal");
const clearOkBtn = document.getElementById("clearOkBtn");
const clearCancelBtn = document.getElementById("clearCancelBtn");
const delModal = document.getElementById("delModal");
const delOkBtn = document.getElementById("delOkBtn");
const delCancelBtn = document.getElementById("delCancelBtn");
const bannedModal = document.getElementById("bannedModal");
const bannedOkBtn = document.getElementById("bannedOkBtn");const tacModal = document.getElementById("tacModal");
const tacAgreeBtn = document.getElementById("tacAgreeBtn");
const tacDeclineBtn = document.getElementById("tacDeclineBtn");
const tacKey = "tgTac_" + (window.generatorName || "chat");
let tacAgreed = lsGet(tacKey) === "1";
const replyBar = document.getElementById("replyBar");
const replyNameEl = document.getElementById("replyName");
const replySnippetEl = document.getElementById("replySnippet");
const replyCloseBtn = document.getElementById("replyCloseBtn");
const replyQuoteBox = document.getElementById("replyQuote");
const editBar = document.getElementById("editBar");
const editLabel = document.getElementById("editLabel");
const editSnippet = document.getElementById("editSnippet");
const editCloseBtn = document.getElementById("editCloseBtn");
const captionModal = document.getElementById("captionModal");
const capImg = document.getElementById("capImg");
const capInput = document.getElementById("capInput");
const capSendBtn = document.getElementById("capSendBtn");
const capCancelBtn = document.getElementById("capCancelBtn");

avatarLetter.textContent = (chatTitle.textContent.trim().charAt(0) || "C").toUpperCase();

/* ---------- profile pictures ----------
   A nickname -> image URL map. The server owns the durable copy (and publishes
   a `pfp` message on every change); this browser caches what it has seen in
   localStorage so avatars are painted instantly on reload, before the server
   answers. Pictures are purely cosmetic: any missing, removed or broken URL
   falls back to the name-coloured initial chip, so nothing else depends on it. */
const PFP_LC_KEY = "tgPfp_" + (window.generatorName || "chat");
const PFP_CACHE_MAX = 300;
let pfpMap = (() => {
  try {
    const o = JSON.parse(lsGet(PFP_LC_KEY) || "{}");
    return (o && typeof o === "object") ? o : {};
  } catch (e) { return {}; }
})();
function savePfpMap() {
  try { lsSet(PFP_LC_KEY, JSON.stringify(pfpMap)); } catch (e) {}
}
function pfpFor(name) {
  const u = name ? pfpMap[name] : "";
  return typeof u === "string" ? u : "";
}
function setPfpLocal(name, url) {
  if (!name) return;
  if (url) pfpMap[name] = String(url); else delete pfpMap[name];
  const keys = Object.keys(pfpMap);
  if (keys.length > PFP_CACHE_MAX) for (const k of keys.slice(0, keys.length - PFP_CACHE_MAX)) delete pfpMap[k];
  savePfpMap();
  refreshAvatars();
}
/* Paint one avatar chip: the picture when the nickname has one, else the chip
   the app has always drawn (initial over the name colour). A picture that fails
   to load falls back to the initial instead of leaving an empty circle. */
function paintAvatar(node, name) {
  const url = pfpFor(name);
  node.textContent = "";
  node.title = name || "";
  if (name !== "admin" && !node.classList.contains("adminAvatar")) node.style.background = avatarBg(name);
  if (url) {
    const img = document.createElement("img");
    img.className = "avImg";
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("error", () => { img.remove(); node.textContent = senderInitial(name); if (node.classList && node.classList.contains("msgAvatar") && !node.closest("#typingRow")) paintAvatarDot(node, name); }, { once: true });
    img.src = url;
    node.appendChild(img);
  } else {
    node.textContent = senderInitial(name);
  }
}
/* Re-paint every avatar that is currently on screen after the map changes:
   message gutters, the typing bubble, the online/info panels and the
   who-reacted popover. */
function refreshAvatars() {
  // Every container, including the private chats sitting off-screen, so a
  // picture that arrives late repaints wherever that person appears.
  for (const host of msgContainers()) for (const av of host.querySelectorAll(".msgAvatar")) delete av.dataset.k;
  updateBubbleTails();
  if (document.getElementById("typingRow")) renderTypingBubble();
  if (!onlineModal.classList.contains("hide")) renderOnlineList();
  try {
    if (rxWhoOpen() && rxWhoMsg && rxWhoPill && rxWhoPill.isConnected) {
      const ids = rxIdsFor(rxWhoMsg, rxWhoEmoji);
      if (ids.length) fillReactionWho(rxWhoPill, ids);
    }
  } catch (e) {}
}

const pfpPreview = document.getElementById("pfpPreview");
const pfpHint = document.getElementById("pfpHint");
const pfpInput = document.getElementById("pfpInput");
const pfpPickBtn = document.getElementById("pfpPickBtn");
const pfpRemoveBtn = document.getElementById("pfpRemoveBtn");
// The picture the profile modal is about to save: null = leave as-is,
// "" = remove it, an https URL = set it. It is applied together with the name
// (one setName round trip), so a name change can never strand a picture on the
// old nickname.
let pfpDraft = null;
let pfpBusy = false;
function renderPfpPreview() {
  const name = myName || nickInput.value.trim() || "";
  const url = pfpDraft === null ? pfpFor(name) : pfpDraft;
  pfpPreview.textContent = "";
  pfpPreview.style.background = "";
  if (url) {
    const img = document.createElement("img");
    img.className = "avImg";
    img.alt = "";
    img.src = url;
    img.addEventListener("error", () => { img.remove(); pfpPreview.textContent = senderInitial(name) || "?"; }, { once: true });
    pfpPreview.appendChild(img);
  } else {
    pfpPreview.textContent = senderInitial(name) || "?";
    pfpPreview.style.background = name ? avatarBg(name) : "";
  }
  pfpPreview.classList.toggle("busy", pfpBusy);
  pfpPickBtn.disabled = pfpBusy;
  pfpPickBtn.textContent = pfpBusy ? "Uploading…" : (url ? "Change photo" : "Upload photo");
  pfpRemoveBtn.classList.toggle("hide", !url || pfpBusy);
  pfpHint.textContent = pfpBusy ? "Uploading your photo…" : "Profile picture (optional)";
}
function pickPfpFile() {
  if (!pfpBusy) pfpInput.click();
}
pfpPickBtn.addEventListener("click", pickPfpFile);
pfpPreview.addEventListener("click", () => {
  const img = pfpPreview.querySelector("img");
  if (img && img.src) openLightbox(img.src);
  else pickPfpFile();
});
pfpPreview.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickPfpFile(); } });
pfpRemoveBtn.addEventListener("click", () => { pfpDraft = ""; renderPfpPreview(); });
pfpInput.addEventListener("change", async () => {
  const file = pfpInput.files && pfpInput.files[0];
  pfpInput.value = "";
  if (!file) return;
  if (!/^image\//.test(file.type || "")) { toast("Please choose an image file"); return; }
  // Uploaded before Save so the button can warn while the bytes are in flight;
  // the resulting URL is only committed to the room when Save is pressed.
  pfpBusy = true;
  renderPfpPreview();
  try {
    let blob;
    try {
      blob = await resizeImage(file, 256, 0.85);
    } catch (e) {
      toast("Couldn't read that image");
      return;
    }
    const up = await root.uploadPlugin(blob);
    const url = String((up && up.url) || "");
    if (!up || up.error || !url) { toast("Upload failed: " + ((up && up.error) || "unknown error")); return; }
    pfpDraft = url;
  } catch (e) {
    toast("Upload failed");
  } finally {
    pfpBusy = false;
    renderPfpPreview();
  }
});

const _sep = document.querySelector("#messagesEl .sep");
if (_sep) _sep.textContent = fmtDatePill(new Date());

function fmtDatePill(d) {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "long" }) + " " + d.getDate();
}

let toastTimer = null;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hide");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hide"), 2300);
}

function copyFallback(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); toast("Copied"); }
  catch (e) { toast("Couldn't copy"); }
  ta.remove();
}

function scrollBottom(force) {
  if (force || scrollCtnEl.scrollHeight - scrollCtnEl.scrollTop - scrollCtnEl.clientHeight < 60) {
    scrollCtnEl.scrollTop = scrollCtnEl.scrollHeight;
  }
  updateScrollBtn();
}

const roomScrollCtn = document.getElementById("scrollCtn");
let scrollCtnEl = roomScrollCtn;
const scrollDownBtn = document.getElementById("scrollDownBtn");
function updateScrollBtn() {
  scrollDownBtn.classList.toggle("hide", scrollCtnEl.scrollHeight - scrollCtnEl.scrollTop - scrollCtnEl.clientHeight < 60);
}
scrollCtnEl.addEventListener("scroll", () => {
  updateScrollBtn();
  const nb = isNearBottom();
  if (!nb) userScrolledUp = true;
  else if (userScrolledUp && (unreadCount || messagesEl.querySelector(".unreadBanner") || !unreadChipBtn.classList.contains("hide"))) {
    userScrolledUp = false;
    clearUnreadState();
  }
});
let transDebounce = null;
scrollCtnEl.addEventListener("scroll", () => {
  maybeLoadOlder();
  if (translateOn) {
    clearTimeout(transDebounce);
    transDebounce = setTimeout(() => translateViewport(), 220);
  }
});
function animateScrollTo(targetTop) {
  const start = scrollCtnEl.scrollTop;
  const delta = targetTop - start;
  if (Math.abs(delta) < 1) { updateScrollBtn(); return; }
  const dur = Math.min(500, 150 + Math.abs(delta) * 0.3);
  const t0 = Date.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const step = () => {
    const p = Math.min(1, (Date.now() - t0) / dur);
    scrollCtnEl.scrollTop = start + delta * ease(p);
    if (p < 1) setTimeout(step, 16);
    else updateScrollBtn();
  };
  step();
}
scrollDownBtn.addEventListener("click", () => {
  animateScrollTo(scrollCtnEl.scrollHeight);
});

const unreadChipBtn = document.getElementById("unreadChipBtn");
let unreadCount = 0;
let userScrolledUp = false;
function isNearBottom() {
  return scrollCtnEl.scrollHeight - scrollCtnEl.scrollTop - scrollCtnEl.clientHeight < 60;
}
function clearUnreadState() {
  unreadCount = 0;
  unreadChipBtn.classList.add("hide");
  const b = roomMessagesEl.querySelector(".unreadBanner");
  if (b) b.remove();
  lastSeenAt = Date.now();
  lsSet(lastSeenKey, String(lastSeenAt));
  refreshListView();
}
function ensureUnreadBanner(wrap) {
  if (roomMessagesEl.querySelector(".unreadBanner")) return;
  const banner = el("div", "unreadBanner");
  banner.appendChild(el("span", "unreadLabel", "Unread Messages"));
  const chev = document.createElement("span");
  chev.innerHTML = UNREAD_CHEV;
  banner.appendChild(chev);
  if (wrap) roomMessagesEl.insertBefore(banner, wrap);
  else roomMessagesEl.appendChild(banner);
}
function showUnreadChip(count) {
  document.getElementById("unreadChipLabel").textContent = count ? count + " unread" : "Unread messages";
  unreadChipBtn.classList.remove("hide");
}
unreadChipBtn.addEventListener("click", () => {
  unreadChipBtn.classList.add("hide");
  if (scrollToNewBanner(true)) {
    setTimeout(() => { if (messagesEl.querySelector(".unreadBanner")) clearUnreadState(); }, 700);
  } else {
    scrollCtnEl.scrollTop = 0;
    clearUnreadState();
  }
});

/* ================= people screen + private chats =================
   The back arrow walks a small view stack: room -> People -> private chat.
   A private chat is not a separate world: it reuses the exact same message
   rendering, selection, reaction, reply and typing machinery, by pointing
   `messagesEl`/`scrollCtnEl` at the private container while it is open. The
   room's DOM is left untouched (hidden) underneath, so going back is instant
   and losing nothing. A thread you are not looking at keeps its own DOM in
   `dmDom` (off-screen), so arriving messages are drawn where they belong and a
   reopened chat is already painted.
   Nothing private ever touches the room's history store: private messages live
   only in the server's durable DM region and never in the public history. */
const dmScrollEl = document.getElementById("dmScrollCtn");
/* The admin's read-only monitor screen (see "admin: private chats in the chat
   list"). Declared up here with the other screen elements because the list pass
   that decides which pane is showing runs during module evaluation. */
const monitorScreen = document.getElementById("monitorScreen");
const monitorBarEl = document.getElementById("monitorBarEl");
const monitorScrollEl = document.getElementById("monitorScrollCtn");
const monitorMessagesEl = document.getElementById("monitorMessagesEl");

/* ---------- floating date indicator (Telegram/WhatsApp style) ----------
   Reuses the existing day-divider data/logic (dataset.ts + fmtDatePill, the
   same source refreshDaySeps derives its labels from) but renders it as a
   floating overlay instead of in-flow pills (hidden via .sep.daySep CSS).
   The single pill node is re-parented into whichever chat scroller is active,
   so it is always positioned relative to the visible chat area. Zero-height
   sticky positioning means it never pushes messages; messages scroll
   underneath it. One rAF-throttled passive listener per scroller covers
   wheel, touch, trackpad and programmatic scrolling. */
const stickyWrap = document.getElementById("stickyDateWrap");
const stickyPill = document.getElementById("stickyDate");
let stickyHideT = null;
let stickyRaf = 0;
let stickyLastTop = -1;
function stickyActive() {
  if (scrollCtnEl === monitorScrollEl) return { sc: monitorScrollEl, list: monitorMessagesEl };
  if (scrollCtnEl === dmScrollEl) return { sc: dmScrollEl, list: document.getElementById("dmMessagesEl") };
  return { sc: roomScrollCtn, list: roomMessagesEl };
}
function stickyPlace() {
  const { sc } = stickyActive();
  if (stickyWrap.parentElement !== sc) sc.insertBefore(stickyWrap, sc.firstChild);
}
function stickyShow() {
  stickyPlace();
  const { sc, list } = stickyActive();
  const top = sc.getBoundingClientRect().top;
  let label = "";
  const kids = list.children;
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (!n.classList || !n.classList.contains("msg")) continue;
    const ts = Number(n.dataset && n.dataset.ts) || 0;
    if (!ts) continue;
    label = fmtDatePill(new Date(ts));
    if (n.getBoundingClientRect().bottom > top + 48) break;
  }
  if (label && stickyPill.textContent !== label) stickyPill.textContent = label;
  if (!label) return;
  stickyPill.classList.remove("hide");
  stickyWrap.classList.add("show");
  clearTimeout(stickyHideT);
  stickyHideT = setTimeout(() => stickyWrap.classList.remove("show"), 1500);
}
function stickyOnScroll() {
  const { sc } = stickyActive();
  if (sc.scrollTop === stickyLastTop) return;
  stickyLastTop = sc.scrollTop;
  if (stickyRaf) return;
  stickyRaf = requestAnimationFrame(() => { stickyRaf = 0; stickyShow(); });
}
for (const scroller of [roomScrollCtn, dmScrollEl, monitorScrollEl]) {
  scroller.addEventListener("scroll", stickyOnScroll, { passive: true });
}
const peopleScreen = document.getElementById("peopleScreen");
const peopleListEl = document.getElementById("peopleList");
const peopleSearchInput = document.getElementById("convoFilter");
/* Browsers insist on autofilling this box (with our own nickname, no less), and
   they do it by replaying a *trusted* focus/keydown/input sequence at load -
   which would silently filter the list down to nothing. The one thing autofill
   never does is actually put the caret in the field, so text only counts as the
   user's if the field is the active element when it arrives. Anything else in
   the box is treated as junk and wiped by the next render. */
let filterUserTyped = false;
const backBtn = document.getElementById("backBtn");
const backBadge = document.getElementById("backBadge");
const dmDelModal = document.getElementById("dmDelModal");
const dmDelDesc = document.getElementById("dmDelDesc");
const dmDelOkBtn = document.getElementById("dmDelOkBtn");
const dmDelCancelBtn = document.getElementById("dmDelCancelBtn");
const peopleTitleEl = document.getElementById("peopleTitle");
const peopleSubEl = document.getElementById("peopleSub");

/* Wide screens get the desktop messenger layout instead of the phone one: the
   conversation list is a permanent left column, so there is no "back" to click -
   picking a row swaps the pane beside it. The CSS handles the placing; the few
   things CSS cannot express (which pane is showing, the list's 5s refresh, the
   list's own heading) are mirrored onto `body.desk` here. */
const DESK_QUERY = "(min-width: 820px)";
const deskMQ = window.matchMedia(DESK_QUERY);
function isDesk() { return deskMQ.matches; }

/* Private chat is a verified-user feature: `dmAllowed()` is whether *this*
   browser has it at all, and `canDm(name)` whether a given person may be in a
   private chat with us. The server enforces the same two rules authoritatively
   (see mayDm/dmName in the server script) - this is the matching UI side. */
function dmAllowed() { return isAdmin() || (!!myName && verifiedSet.has(myName)); }
function canDm(name) { return !!name && name !== myName && (name === "admin" || verifiedSet.has(name)); }

// Every place that lists conversations, so the "is the list on screen" test
// lives in exactly one place.
function refreshListView() { if (peopleOpen || isDesk()) renderPeopleList(); }
// ...and the same for the People/private-chat screen being on screen at all.
function setPeopleScreenVisible(v) { peopleScreen.classList.toggle("hide", !v && !isDesk()); }

function startPeopleTimer() { clearInterval(peopleTimer); peopleTimer = setInterval(refreshPeople, 5000); }

/* Append target override. Building a message for a conversation that isn't on
   screen (a stashed private chat) needs the same renderers to drop it into that
   thread's own DOM instead of the visible one. */
let msgHost = null;
/* An empty private thread shows a "No messages yet" hint; the first real
   message (incoming or our own outgoing placeholder) retires it. */
function stripEmptyHint(host) {
  const hint = host && host.firstElementChild;
  if (hint && hint.classList && hint.classList.contains("pEmpty")) hint.remove();
}
function hostEl() { const h = msgHost || messagesEl; stripEmptyHint(h); return h; }
/* The history store is the ROOM's, and its loads are async - a load that
   finishes after a private chat was opened must not spill room rows into that
   chat's container. Every history path appends through here instead. */
function addRoomMessageDom(m) { return withMsgHost(roomMessagesEl, () => addMessageDom(m)); }
function withMsgHost(host, fn) {
  const prev = msgHost;
  msgHost = host;
  try { return fn(); } finally { msgHost = prev; }
}

const DM_UNREAD_KEY = "tgDmUnread_" + (window.generatorName || "chat");
const dmUnreadMap = (() => {
  try { const o = JSON.parse(lsGet(DM_UNREAD_KEY) || "{}"); return (o && typeof o === "object") ? o : {}; } catch (e) { return {}; }
})();
function saveDmUnread() { try { lsSet(DM_UNREAD_KEY, JSON.stringify(dmUnreadMap)); } catch (e) {} }
function dmUnreadTotal() { let n = 0; for (const k of Object.keys(dmUnreadMap)) n += Number(dmUnreadMap[k]) || 0; return n; }
function updateBackBadge() {
  const n = dmAllowed() ? dmUnreadTotal() : 0;
  backBadge.textContent = n > 99 ? "99+" : String(n);
  backBadge.classList.toggle("hide", n === 0);
}

let convo = { mode: "room", peer: "" };   // "room" | "people" | "dm"
let peopleOpen = false;
let peopleTimer = null;
let onlineNames = new Set();
let dmThreads = [];
// Admin-only: every private conversation between *other* people, refreshed with
// the people list and rendered in the chat list's "All private chats" section.
let adminDmThreads = [];
// The other people's conversation the admin's read-only monitor screen is
// showing, if any, plus the messages it last rendered.
let monitorPair = null;
let monitorMsgs = [];
// When the admin is "viewing as" somebody (the eye icon on a user's row), the
// chat list shows that person's private conversations instead of the admin's.
let viewAs = "";
let dmPeerRead = 0;                       // the other side's read mark in the open chat
let dmReadSentAt = 0;
let roomHistoryStale = false;
let roomTitleText = chatTitle.textContent.trim();
let dmDelTarget = "";
const dmDom = new Map();                  // peer -> off-screen DOM holding that thread
const dmScrollTops = new Map();           // peer -> scroll position when it was last left
// Your own private messages carry a tick the moment they are on screen: a
// single check while the message is merely sent, the second check appearing
// once the other side's read mark passes it. The room's own `.tsCheck` would
// draw a tick of its own inside a private thread, so it is suppressed there (see
// the CSS) and this is the only tick source in a private chat.
const DM_TICK_SENT_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l4.5 4.5L19.5 6.5"/></svg>';
const DM_TICK_SEEN_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 12.5l4 4L15 6.5"/><path d="M9.5 16.5l1 1L22 6.5"/></svg>';

function setRoomTitle(t) {
  roomTitleText = String(t || "");
  if (convo.mode === "room") {
    chatTitle.textContent = roomTitleText;
    avatarLetter.textContent = (roomTitleText.trim().charAt(0) || "C").toUpperCase();
  }
}
// One place decides what the header shows, because both the avatar area and the
// two title buttons are shared between the room and a private chat.
function applyHeader() {
  if (convo.mode === "dm") {
    const peer = convo.peer;
    chatTitle.textContent = peer;
    const url = pfpFor(peer);
    avatar.style.backgroundImage = url ? "url('" + url + "')" : "";
    avatar.style.backgroundSize = url ? "cover" : "";
    avatar.style.backgroundPosition = url ? "center" : "";
    avatar.style.color = url ? "transparent" : "";
    avatar.classList.toggle("hasPfp", !!url);
    avatarLetter.textContent = url ? "" : senderInitial(peer);
    onlineSub.textContent = onlineNames.has(peer) ? "online" : "offline";
    iconBtn.classList.add("hide");
    titleEditBtn.classList.add("hide");
    // Admin-only: the eye beside the peer's name puts the admin in that
    // person's shoes (see openViewAs).
    // view-as eye removed per privacy terms
  } else if (convo.mode === "monitor") {
    // The admin's read-only window into somebody else's conversation: there is
    // no profile to show and nothing of the admin's own to edit.
    const p = monitorPair;
    chatTitle.textContent = p ? p.a + " \u00b7 " + p.b : "Private chat";
    avatar.style.backgroundImage = "";
    avatar.style.backgroundSize = "";
    avatar.style.backgroundPosition = "";
    avatar.style.color = "";
    avatar.classList.toggle("hasPfp", false);
    avatarLetter.textContent = p ? ((p.a.charAt(0) || "?") + (p.b.charAt(0) || "?")).toUpperCase() : "\u2026";
    onlineSub.textContent = "private \u00b7 moderating";
    iconBtn.classList.add("hide");
    titleEditBtn.classList.add("hide");
    // view-as eye removed per privacy terms
  } else {
    applyIcon(currentIconUrl);
    chatTitle.textContent = roomTitleText;
    avatarLetter.textContent = (roomTitleText.trim().charAt(0) || "C").toUpperCase();
    showOnlineStatus();
    if (isAdmin()) {
      iconBtn.classList.remove("hide");
      titleEditBtn.classList.remove("hide");
    }
    // view-as eye removed per privacy terms
  }
  syncBackIcon();
}
function retargetTailObserver() {
  try { tailObserver.disconnect(); tailObserver.observe(messagesEl, { childList: true }); } catch (e) {}
}
/* Content can grow after the fact - a lazy photo finishing its load, the
   composer wrapping onto a second line, a day separator or read tick being
   inserted - and any of those silently pushes the newest message out of view
   whenever you were sitting at the bottom. `stickToBottom` remembers whether the
   view was parked there (programmatic scrolls fire a scroll event too, so it
   stays honest), and a either container or message list changing size pulls the
   view back down when that was the case. Somebody who scrolled up is never
   touched, so this cannot fight anyone reading back through history. */
let stickToBottom = true;
function noteViewPos(e) {
  if (e.currentTarget !== scrollCtnEl) return;   // the hidden container is not the one on screen
  stickToBottom = isNearBottom();
}
roomScrollCtn.addEventListener("scroll", noteViewPos, { passive: true });
dmScrollEl.addEventListener("scroll", noteViewPos, { passive: true });
function resyncBottom() {
  if (!stickToBottom) return;
  if (document.getElementById("app").classList.contains("selMode")) return;
  const sc = scrollCtnEl;
  if (sc.scrollHeight - sc.scrollTop - sc.clientHeight < 1) return;
  sc.scrollTop = sc.scrollHeight;
  updateScrollBtn();
}
if (typeof ResizeObserver !== "undefined") {
  const sizeWatcher = new ResizeObserver((entries) => {
    for (const en of entries) {
      if (en.target === scrollCtnEl || en.target === messagesEl) { resyncBottom(); return; }
    }
  });
  sizeWatcher.observe(roomScrollCtn);
  sizeWatcher.observe(dmScrollEl);
  sizeWatcher.observe(roomMessagesEl);
  sizeWatcher.observe(dmMessagesEl);
}
// Message DOM that leaves the screen (a stashed thread, a re-rendered thread) is
// gone for good, so its selection/reaction bookkeeping goes with it.
function msgByWrapCleanup(host) {
  for (const w of [...msgByWrap.keys()]) {
    if (!host.contains(w)) continue;
    msgByWrap.delete(w);
    selItems.delete(w);
  }
}
function findMsgDomIn(host, id) {
  if (!host || !id) return null;
  for (const n of [...host.children]) if (n.dataset && n.dataset.id === id) return n;
  return null;
}
function dmHostFor(peer) {
  let h = dmDom.get(peer);
  if (!h) { h = el("div", "dmHold"); dmDom.set(peer, h); }
  // Stamped so ownership inside a stashed thread is readable straight off the
  // container (see dmContextPeer).
  h.dataset.peer = peer;
  return h;
}
// Everything the app considers "rendered messages" - the visible conversation,
// the room (which stays alive behind a private chat) and every stashed thread -
// so lookups by id keep working for messages that are merely off screen.
function msgContainers() {
  const list = [messagesEl, roomMessagesEl];
  for (const h of dmDom.values()) list.push(h);
  return list;
}
function dmHost(peer) {
  if (convo.mode === "dm" && convo.peer === peer) return messagesEl;
  return dmDom.get(peer) || null;
}

function fmtTimeShort(ts) {
  const n = Number(ts) || 0;
  if (!n) return "";
  const d = new Date(n);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (now - d < 6 * 86400000) return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  return (d.getMonth() + 1) + "/" + d.getDate();
}

// The verification tick, drawn once and reused by the list's verify button and
// by the selection toolbar's.
const VERIFY_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" opacity="0.16"/><path d="M8 12.5l3 3 5.5-5.5"/></svg>';

/* The admin's one place to hand out verification: people who are online but
   not verified yet. These are deliberately NOT conversation rows - tapping one
   does not open a chat (it cannot: private chat is verified-only), so the only
   thing a row here does is verify. Nobody but the admin sees this section. */
function pendingRow(peer) {
  const row = el("div", "pRow pPending");
  row.dataset.peer = peer;
  const av = el("div", "pAvatar");
  paintAvatar(av, peer);
  av.appendChild(el("span", "pOnlineDot"));
  row.appendChild(av);
  const main = el("div", "pMain");
  const top = el("div", "pTop");
  top.appendChild(el("span", "pName", peer));
  main.appendChild(top);
  main.appendChild(el("div", "pPreview", "online \u00b7 not verified"));
  row.appendChild(main);
  const ok = el("button", "pAct");
  ok.type = "button";
  ok.title = "Give verification badge to " + peer;
  ok.setAttribute("aria-label", ok.title);
  ok.innerHTML = VERIFY_SVG;
  ok.addEventListener("click", (e) => { e.stopPropagation(); verifyPerson(peer); });
  row.appendChild(ok);
  return row;
}
async function verifyPerson(peer) {
  if (!peer || !isAdmin() || !socket || socket.readyState !== 1) return;
  try {
    const r = await socket.rpc.verifyUser(JSON.stringify({ name: peer }));
    if (r === "ok" || r === "already") {
      verifiedSet.add(peer);
      refreshVerifiedUI();
      toast("Verified " + peer);
    }
  } catch (e) {}
}

function personRow(peer, info) {
  const row = el("div", "pRow");
  row.dataset.peer = peer;
  if (convo.mode === "dm" && convo.peer === peer) row.classList.add("active");
  const av = el("div", "pAvatar");
  if (peer === "admin") av.classList.add("adminAvatar");
  paintAvatar(av, peer);
  if (onlineNames.has(peer)) av.appendChild(el("span", "pOnlineDot"));
  row.appendChild(av);
  const main = el("div", "pMain");
  const top = el("div", "pTop");
  top.appendChild(el("span", "pName", peer));
  if (peer === "admin") top.appendChild(el("span", "olTag", "ADMIN"));
  else if (verifiedSet.has(peer)) top.appendChild(verifiedBadgeEl());
  const unread = Number(dmUnreadMap[peer]) || 0;
  if (info && info.ts) top.appendChild(el("span", "pTime", fmtTimeShort(info.ts)));
  main.appendChild(top);
  const hasText = info && info.preview;
  const label = hasText
    ? ((info.from === myName ? "You: " : "") + info.preview)
    : (onlineNames.has(peer) ? "online" : "offline");
  main.appendChild(el("div", "pPreview", label));
  row.appendChild(main);
  if (unread) row.appendChild(el("span", "pBadge", unread > 99 ? "99+" : String(unread)));
  // view-as eye removed per privacy terms
  const del = el("button", "pDel");
  del.type = "button";
  del.title = "Delete conversation";
  del.setAttribute("aria-label", "Delete conversation with " + peer);
  del.innerHTML = DEL_SVG;
  del.addEventListener("click", (e) => { e.stopPropagation(); askDeleteDm(peer); });
  row.appendChild(del);
  row.addEventListener("click", () => openDm(peer));
  return row;
}

/* The room's row in the desktop list: same shape as a person row, but it is not
   a conversation with somebody - clicking it just brings the room back into the
   pane beside the list. Its preview is read straight off the room's DOM, which
   is always current (the room keeps rendering behind a private chat). */
function roomRow() {
  const row = el("div", "pRow roomRow");
  row.dataset.room = "1";
  if (convo.mode === "room") row.classList.add("active");
  const av = el("div", "pAvatar roomAv");
  if (currentIconUrl) {
    const img = el("img", "avImg");
    img.src = currentIconUrl;
    av.appendChild(img);
  } else av.appendChild(el("span", null, (roomTitleText.trim().charAt(0) || "C").toUpperCase()));
  row.appendChild(av);
  const main = el("div", "pMain");
  const top = el("div", "pTop");
  top.appendChild(el("span", "pName", roomTitleText));
  const last = roomLastMsg();
  if (last.ts) top.appendChild(el("span", "pTime", fmtTimeShort(last.ts)));
  main.appendChild(top);
  main.appendChild(el("div", "pPreview", last.text || "No messages yet"));
  row.appendChild(main);
  if (unreadCount) row.appendChild(el("span", "pBadge", unreadCount > 99 ? "99+" : String(unreadCount)));
  row.addEventListener("click", () => showRoom());
  return row;
}
function roomLastMsg() {
  let n = roomMessagesEl.lastElementChild;
  while (n && !(n.classList && n.classList.contains("msg"))) n = n.previousElementSibling;
  if (!n) return { text: "", ts: 0 };
  const from = n.dataset.from || "";
  const text = n.querySelector(".imgBubble") ? "Photo"
    : n.querySelector(".voiceBubble") ? "Voice message"
    : ((n.querySelector(".btext") || {}).textContent || "");
  return { text: (from && from !== myName ? from + ": " : from === myName ? "You: " : "") + text, ts: Number(n.dataset.ts) || 0 };
}

/* A row for somebody else's private conversation, shown to the admin only. It
   is not a conversation the admin takes part in, so tapping it opens the
   read-only monitor screen (openMonitorThread) rather than a normal private
   chat, and the moderation actions live there. */
function adminThreadRow(t) {
  const row = el("div", "pRow adminRow");
  row.dataset.pair = t.a + "|" + t.b;
  if (convo.mode === "monitor" && monitorPair && monitorPair.a === t.a && monitorPair.b === t.b) row.classList.add("active");
  const av = el("div", "pAvatar adminAv");
  av.textContent = ((t.a.charAt(0) || "?") + (t.b.charAt(0) || "?")).toUpperCase();
  row.appendChild(av);
  const main = el("div", "pMain");
  const top = el("div", "pTop");
  top.appendChild(el("span", "pName", t.a + " \u00b7 " + t.b));
  top.appendChild(el("span", "pMonitorTag", "private"));
  if (t.ts) top.appendChild(el("span", "pTime", fmtTimeShort(t.ts)));
  main.appendChild(top);
  const last = t.preview ? (t.from ? t.from + ": " + t.preview : t.preview) : "No messages yet";
  main.appendChild(el("div", "pPreview", last));
  row.appendChild(main);
  row.addEventListener("click", () => openMonitorThread({ a: t.a, b: t.b }));
  return row;
}

function sanitizeFilter() {
  if (!filterUserTyped && peopleSearchInput.value) peopleSearchInput.value = "";
}
function renderPeopleList() {
  sanitizeFilter();
  peopleHead.classList.remove("hide");
  const q = filterUserTyped ? peopleSearchInput.value.trim().toLowerCase() : "";
  const byPeer = new Map(dmThreads.map((t) => [t.peer, t]));
  const names = new Set();
  for (const t of dmThreads) if (t.peer) names.add(t.peer);
  for (const n of onlineNames) names.add(n);
  names.delete(myName);
  // Only verified people appear - and only they can be chatted with privately.
  const match = (n) => !q || n.toLowerCase().indexOf(q) !== -1;
  const shown = [...names].filter(canDm).filter(match);
  const chats = shown.filter((n) => byPeer.has(n)).sort((a, b) => (Number(byPeer.get(b).ts) || 0) - (Number(byPeer.get(a).ts) || 0));
  const fresh = shown.filter((n) => !byPeer.has(n) && onlineNames.has(n)).sort((a, b) => a.localeCompare(b));
  // The admin also gets to see who is waiting to be verified - the only place
  // verification can be granted without them having to speak first.
  const pending = isAdmin() ? [...names].filter((n) => onlineNames.has(n) && !canDm(n)).filter(match).sort((a, b) => a.localeCompare(b)) : [];
  // Every *other* pair's private conversation, so the admin can read and
  // moderate it from the chat list itself instead of only from the admin panel.
  // Pairs the admin is part of are already ordinary chat rows above, so they
  // are left out here: this section is strictly other people's conversations.
  const monitored = isAdmin()
    ? adminDmThreads.filter((t) => t && t.a && t.b && t.a !== myName && t.b !== myName && (match(t.a) || match(t.b)))
    : [];
  peopleListEl.textContent = "";
  // The admin's "view as" session replaces the whole list with that person's
  // conversations, so the eye icon really does put the admin in their shoes.
  if (isAdmin() && viewAs) {
    peopleTitleEl.textContent = "Chats";
    peopleSubEl.textContent = "Viewing as " + viewAs;
    renderViewAsList();
    return;
  }
  if (isDesk()) {
    peopleTitleEl.textContent = "Chats";
    peopleSubEl.textContent = onlineCount === 1 ? "1 online" : onlineCount + " online";
    peopleListEl.appendChild(el("div", "pSection", "Room"));
    peopleListEl.appendChild(roomRow());
  } else {
    peopleTitleEl.textContent = "People";
    peopleSubEl.textContent = "Tap someone to chat privately";
  }
  if (!dmAllowed()) {
    peopleListEl.appendChild(el("div", "pSection", "Private chats"));
    peopleListEl.appendChild(el("div", "pEmpty", myName ? "Private chat is for verified users only." : "Connecting…"));
    return;
  }
  if (chats.length) {
    peopleListEl.appendChild(el("div", "pSection", "Chats"));
    for (const peer of chats) peopleListEl.appendChild(personRow(peer, byPeer.get(peer)));
  }
  if (fresh.length) {
    peopleListEl.appendChild(el("div", "pSection", "Online now"));
    for (const peer of fresh) peopleListEl.appendChild(personRow(peer, null));
  }
  // Last, because it is the admin's tool rather than a conversation: everyone
  // else sees nothing here, and it is gone the moment they are verified.
  if (pending.length) {
    peopleListEl.appendChild(el("div", "pSection", "Not verified"));
    for (const peer of pending) peopleListEl.appendChild(pendingRow(peer));
  }
  // The admin's moderation window into other people's private chats. Last,
  // like the "Not verified" tool rows, and never shown to anyone else.
  if (monitored.length) {
    peopleListEl.appendChild(el("div", "pSection", "All private chats"));
    for (const t of monitored) peopleListEl.appendChild(adminThreadRow(t));
  }
  if (!chats.length && !fresh.length && !pending.length && !monitored.length) {
    peopleListEl.appendChild(el("div", "pEmpty", q ? "No one matches that search" : "No one else is here right now.\nPeople appear the moment they join."));
  }
}

async function refreshPeople() {
  if (!socket || socket.readyState !== 1) return;
  try {
    const r = JSON.parse(await socket.rpc.getDmThreads(""));
    if (Array.isArray(r)) {
      dmThreads = r.filter((t) => t && t.peer);
      for (const t of dmThreads) {
        const u = Number(t.unread) || 0;
        if (u) dmUnreadMap[t.peer] = u; else delete dmUnreadMap[t.peer];
      }
      // Drop read marks whose conversation no longer exists (deleted on the
      // other side, wiped by a clear, or a peer who was un-verified), so a
      // stale badge can never sit on a row with no thread behind it.
      const live = new Set(dmThreads.map((t) => t.peer));
      for (const k of Object.keys(dmUnreadMap)) if (!live.has(k)) delete dmUnreadMap[k];
      saveDmUnread();
      updateBackBadge();
    }
  } catch (e) {}
  try {
    const o = JSON.parse(await socket.rpc.getOnline(""));
    if (Array.isArray(o)) {
      onlineNames = new Set(o.filter((u) => u && u.online !== 0).map((u) => String(u.name || "")).filter(Boolean));
    }
  } catch (e) {}
  refreshAvatarDots();
  await refreshAdminDmThreads();
  refreshListView();
  if (convo.mode === "dm") applyHeader();
}

function openPeople() {
  if (selectionMode) endSelection();
  leaveDm();
  convo = { mode: "people", peer: "" };
  peopleOpen = true;
  messagesEl = roomMessagesEl;
  scrollCtnEl = roomScrollCtn;
  peopleScreen.classList.remove("hide");
  roomScrollCtn.classList.add("hide");
  dmScrollEl.classList.add("hide");
  monitorScreen.classList.add("hide");
  composeBar.classList.add("hide");
  applyHeader();
  renderPeopleList();
  refreshPeople();
  startPeopleTimer();
}

function showRoom() {
  if (selectionMode) endSelection();
  leaveDm();
  peopleOpen = false;
  clearInterval(peopleTimer);
  convo = { mode: "room", peer: "" };
  messagesEl = roomMessagesEl;
  scrollCtnEl = roomScrollCtn;
  setPeopleScreenVisible(false);
  dmScrollEl.classList.add("hide");
  monitorScreen.classList.add("hide");
  roomScrollCtn.classList.remove("hide");
  composeBar.classList.remove("hide");
  syncComposeH();
  retargetTailObserver();
  applyHeader();
  refreshListView();
  if (roomHistoryStale) { roomHistoryStale = false; reloadChatHistory(); }
  unreadCount = addNewMsgsBanner();
  if (unreadCount) {
    showUnreadChip(unreadCount);
    if (!scrollToNewBanner(false)) scrollBottom(true);
  } else {
    scrollBottom(true);
  }
  if (interactionReady()) msgInput.focus();
}

// Park the open thread (DOM included) so coming back is instant and keeps its
// reactions, scroll position and buttons wired.
function leaveDm() {
  if (convo.mode !== "dm") return;
  const peer = convo.peer;
  if (!peer) return;
  dmScrollTops.set(peer, dmScrollEl.scrollTop);
  const hold = dmHostFor(peer);
  while (dmMessagesEl.firstChild) hold.appendChild(dmMessagesEl.firstChild);
  delete dmMessagesEl.dataset.peer;
}

function renderDmThread(msgs) {
  msgByWrapCleanup(dmMessagesEl);
  dmMessagesEl.textContent = "";
  for (const m of msgs) if (m && m.t) addMessageDom(m);
  if (!msgs.length) dmMessagesEl.appendChild(el("div", "pEmpty", "No messages yet \u2014 say hi."));
  updateBubbleTails();
  scheduleDaySeps();
  scrollBottom(true);
}

async function openDm(name) {
  const peer = String(name || "");
  if (!peer || peer === myName) return;
  if (!canDm(peer)) return;
  if (convo.mode === "dm" && convo.peer === peer) return;
  if (selectionMode) endSelection();
  leaveDm();
  peopleOpen = false;
  clearInterval(peopleTimer);
  convo = { mode: "dm", peer };
  messagesEl = dmMessagesEl;
  // Ownership inside this thread is decided by the peer (see dmContextPeer).
  dmMessagesEl.dataset.peer = peer;
  scrollCtnEl = dmScrollEl;
  setPeopleScreenVisible(false);
  roomScrollCtn.classList.add("hide");
  monitorScreen.classList.add("hide");
  dmScrollEl.classList.remove("hide");
  composeBar.classList.remove("hide");
  syncComposeH();
  retargetTailObserver();
  dmPeerRead = 0;
  applyHeader();
  const hold = dmDom.get(peer);
  const cached = !!(hold && hold.childNodes.length);
  dmMessagesEl.textContent = "";
  if (cached) {
    while (hold.firstChild) dmMessagesEl.appendChild(hold.firstChild);
    reclassifyOwnership();
    scheduleDaySeps();
    scrollCtnEl.scrollTop = dmScrollTops.get(peer) || 0;
    updateScrollBtn();
  } else {
    dmMessagesEl.appendChild(el("div", "pEmpty", "Loading\u2026"));
  }
  delete dmUnreadMap[peer];
  saveDmUnread();
  updateBackBadge();
  // After the unread bookkeeping, so the list shows the row as active and
  // badge-free in the same pass.
  refreshListView();
  markDmRead(true);
  let r = null;
  try { r = JSON.parse(await socket.rpc.getDm(JSON.stringify({ peer }))); } catch (e) {}
  if (convo.mode !== "dm" || convo.peer !== peer) return;
  const msgs = (r && Array.isArray(r.msgs)) ? r.msgs : [];
  dmPeerRead = Number((r && r.read) || 0);
  // The server only hands back the newest DM_MSGS_MAX messages; the Supabase
  // mirror holds everything, so merge the older half back in front of them.
  const full = await dmHistoryWithSupabase(peer, msgs);
  if (convo.mode !== "dm" || convo.peer !== peer) return;
  sbDmBackfill(peer, msgs);
  const painted = dmMessagesEl.querySelectorAll(".msg").length;
  if (!cached || painted !== full.length) renderDmThread(full);
  else { dmMessagesEl.querySelectorAll(".pEmpty").forEach((n) => n.remove()); scrollBottom(true); }
  applyDmSeen();
  markDmRead(true);
  // Translate the just-opened thread (with translation on, the loaded history
  // would otherwise stay untranslated until the next scroll).
  if (translateOn) translateViewport();
  if (interactionReady()) msgInput.focus();
}

// "Seen" is derived, never stored on the bubble: the other side's read mark is
// compared against each of your own messages' timestamps whenever it moves.
function applyDmSeen() {
  if (convo.mode !== "dm") return;
  for (const n of dmMessagesEl.children) {
    if (!n.classList || !n.classList.contains("out")) continue;
    paintDmTick(n);
  }
}
// One tick until the peer's read mark passes the message, two after that. The
// span is created on the message's first paint and then only re-drawn when the
// state actually flips, so a read mark arriving mid-scroll cannot churn the DOM.
function paintDmTick(wrap, readMark) {
  const row = wrap.querySelector(".tsrow");
  const ts = Number(wrap.dataset.ts) || 0;
  if (!row || !ts) return;                      // upload placeholders have neither
  const seen = (readMark === undefined ? dmPeerRead : readMark) >= ts;
  let tick = row.querySelector(".dmSeenTick");
  if (!tick) { tick = el("span", "dmSeenTick"); row.appendChild(tick); }
  const state = seen ? "seen" : "sent";
  if (tick.dataset.state === state) return;
  tick.dataset.state = state;
  tick.classList.toggle("seen", seen);
  tick.innerHTML = seen ? DM_TICK_SEEN_SVG : DM_TICK_SENT_SVG;
  tick.title = seen ? "Read" : "Sent";
}

function markDmRead(force) {
  if (convo.mode !== "dm" || !socket || socket.readyState !== 1) return;
  const now = Date.now();
  if (!force && now - dmReadSentAt < 1500) return;
  dmReadSentAt = now;
  try { socket.send(JSON.stringify({ t: "dm", to: convo.peer, ev: "read", ts: now })); } catch (e) {}
}

function updateDmThreadPreview(peer, m) {
  const prev = m.t === "img" ? (m.caption || "Photo") : m.t === "voice" ? "Voice message" : String(m.text || "");
  const ts = Number(m.ts) || Date.now();
  let t = dmThreads.find((x) => x.peer === peer);
  if (t) { t.ts = ts; t.preview = prev; t.from = m.from || ""; t.unread = Number(dmUnreadMap[peer]) || 0; }
  else { dmThreads.push({ peer, ts, preview: prev, from: m.from || "", unread: Number(dmUnreadMap[peer]) || 0, read: 0 }); }
  dmThreads.sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0));
  refreshListView();
}

function bumpDmUnread(peer, m) {
  dmUnreadMap[peer] = (Number(dmUnreadMap[peer]) || 0) + 1;
  saveDmUnread();
  updateBackBadge();
  updateDmThreadPreview(peer, m);
  refreshListView();
}

function applyDmEditDom(host, m) {
  const n = findMsgDomIn(host, String(m.id || ""));
  if (!n) return;
  const bubble = n.querySelector(".bubble");
  if (!bubble || bubble.classList.contains("imgBubble")) return;
  const bt = bubble.querySelector(".btext");
  if (bt) { bt.innerHTML = linkifyHtml(m.text); syncEmojiClass(bubble, m.text); }
  const ts = bubble.querySelector(".tsrow");
  if (ts && !ts.querySelector(".editedMark")) ts.insertBefore(el("span", "editedMark", "edited"), ts.firstChild);
}

function handleDm(m) {
  const peer = String(m.peer || "");
  if (!peer) return;
  // Private chat is a verified-user feature on both ends; the server refuses to
  // relay anything else, and this keeps the client's own state consistent.
  if (!canDm(peer)) return;
  if (m.ev === "read") {
    if (convo.mode === "dm" && convo.peer === peer) {
      dmPeerRead = Math.max(dmPeerRead, Number(m.ts) || 0);
      applyDmSeen();
    }
    return;
  }
  if (m.ev === "typing") {
    if (convo.mode === "dm" && convo.peer === peer) noteTyping(peer);
    return;
  }
  if (m.ev === "delete") { dropDmLocal(peer); return; }
  const active = convo.mode === "dm" && convo.peer === peer;
  const host = active ? dmMessagesEl : (dmDom.get(peer) || null);
  if (m.ev === "del") {
    const n = host ? findMsgDomIn(host, String(m.id || "")) : null;
    if (n) { msgByWrapCleanup(host); n.remove(); if (active) updateBubbleTails(); }
    return;
  }
  if (m.ev === "edit") {
    if (host) applyDmEditDom(host, m);
    return;
  }
  if (m.ev === "react") {
    rxRememberNames(m.nm);
    rxSet(String(m.from || ""), m.mts, m.rx);
    rxApply({ id: m.id || null, from: m.from || null, ts: m.mts });
    return;
  }
  // The envelope says "dm" so it routes here; the content kind (chat/img/voice)
  // travels in `sub`. Restore it before the renderers see the message.
  if (!m.ev) m.t = m.sub === "img" ? "img" : m.sub === "voice" ? "voice" : "chat";
  if (alreadyRendered(host, m)) return;
  const mine = isMine(m);
  if (m.replyTo && m.replyTo.from) replyKvNote(m.replyTo);
  if (active) {
    const wrap = addMessageDom(m);
    translateRealtimeMessage(m, wrap);
    if (mine && uploadPlaceholders.length) removeUploadPlaceholder(uploadPlaceholders[0]);
    if (!mine) stopTyping(peer);
    if (!mine && document.visibilityState !== "hidden") playNotify();
    showMessageNotification(m);
    if (mine) { scrollBottom(); applyDmSeen(); }
    else if (isNearBottom()) { scrollBottom(true); markDmRead(); }
    else updateScrollBtn();
  } else if (host) {
    withMsgHost(host, () => addMessageDom(m));
  }
  if (!mine) {
    if (!active) playNotify();
    bumpDmUnread(peer, m);
  } else updateDmThreadPreview(peer, m);
}

function askDeleteDm(peer) {
  dmDelTarget = peer;
  dmDelDesc.textContent = "The whole conversation with " + peer + " disappears for both of you. This can't be undone.";
  dmDelModal.classList.remove("hide");
}
function dropDmLocal(peer) {
  const active = convo.mode === "dm" && convo.peer === peer;
  if (active) {
    msgByWrapCleanup(dmMessagesEl);
    dmMessagesEl.textContent = "";
    delete dmMessagesEl.dataset.peer;
    convo = { mode: "people", peer: "" };
    if (selectionMode) endSelection();
  }
  const hold = dmDom.get(peer);
  if (hold) { msgByWrapCleanup(hold); hold.textContent = ""; }
  dmDom.delete(peer);
  dmScrollTops.delete(peer);
  delete dmUnreadMap[peer];
  saveDmUnread();
  updateBackBadge();
  dmThreads = dmThreads.filter((t) => t.peer !== peer);
  if (active) { peopleOpen = false; openPeople(); }
  else refreshListView();
}

/* Verification decides who has private chats at all and who may be reached
   through them, so the list, the badges and any open thread follow it at once. */
function pruneDmToVerified() {
  let changed = false;
  const kept = dmThreads.filter((t) => canDm(t.peer));
  if (kept.length !== dmThreads.length) { dmThreads = kept; changed = true; }
  for (const k of Object.keys(dmUnreadMap)) if (!canDm(k)) { delete dmUnreadMap[k]; changed = true; }
  if (changed) { saveDmUnread(); updateBackBadge(); }
  // A private chat that is open right now and just lost its verification is
  // closed rather than left sitting on screen.
  if (convo.mode === "dm" && !canDm(convo.peer)) { convo = { mode: "room", peer: "" }; openPeople(); }
  refreshListView();
}

/* Wide layouts show the conversation list permanently, so there is no People
   screen to visit and nothing to click "back" from - the pane beside the list
   holds a conversation instead. This mirrors the CSS breakpoint in JS. */
function applyLayoutMode() {
  const desk = isDesk();
  // A pre-filled filter (browser autofill, restored form state) would hide every
  // row and look like an empty chat list, so it always starts empty.
  peopleSearchInput.value = "";
  filterUserTyped = false;
  // Autofill lands a moment after load, so wipe it again once the dust settles.
  setTimeout(sanitizeFilter, 1200);
  document.body.classList.toggle("desk", desk);
  if (desk) {
    if (convo.mode === "people") { showRoom(); }
    peopleScreen.classList.remove("hide");
    startPeopleTimer();
  } else {
    clearInterval(peopleTimer);
    peopleTimer = null;
    setPeopleScreenVisible(peopleOpen);
    if (peopleOpen) startPeopleTimer();
  }
  refreshListView();
}
deskMQ.addEventListener("change", applyLayoutMode);

/* The back button's shape is a state, not just a tap effect: on the chat list it
   is the cross ("you're in the list, tap to close it"), everywhere else the
   arrow. Every tap in the handler below moves between those modes, so the morph
   in the stylesheet doubles as the tap feedback - and the shape then *stays*
   put instead of springing back. Driven from applyHeader, so any path that
   changes `convo.mode` keeps the icon in step. */
function syncBackIcon() {
  backBtn.classList.toggle("cross", convo.mode === "people");
}
backBtn.addEventListener("click", () => {
  if (convo.mode === "monitor") { closeMonitor(); return; }
  if (convo.mode === "dm") { openPeople(); return; }
  if (convo.mode === "people") { showRoom(); return; }
  openPeople();
});
peopleSearchInput.addEventListener("input", () => {
  if (document.activeElement === peopleSearchInput) filterUserTyped = true;
  renderPeopleList();
});
dmDelCancelBtn.addEventListener("click", () => { dmDelModal.classList.add("hide"); dmDelTarget = ""; });
dmDelOkBtn.addEventListener("click", async () => {
  const peer = dmDelTarget;
  dmDelModal.classList.add("hide");
  dmDelTarget = "";
  if (!peer) return;
  try { await socket.rpc.dmDelete(JSON.stringify({ peer })); } catch (e) {}
  sbDmMirrorClear(peer);
  dropDmLocal(peer);
  toast("Conversation deleted");
});
// The private container needs the same scroll courtesies the room has (the
// unread chip is a room-only concept, so it is left out here).
dmScrollEl.addEventListener("scroll", () => {
  updateScrollBtn();
  if (rxBarOpen()) closeReactionBar();
  if (rxWhoOpen()) closeReactionWho();
  if (rxPickOpen()) closeEmojiPicker();
  if (convo.mode === "dm" && isNearBottom()) markDmRead();
  if (translateOn) {
    clearTimeout(transDebounce);
    transDebounce = setTimeout(() => translateViewport(), 220);
  }
});
updateBackBadge();
syncBackIcon();

const CHECK_SVG = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="m1.75 9.75 2.5 2.5m3.5-4 2.5-2.5m-4.5 4 2.5 2.5 6-6.5"/></svg>';
const PLAY_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.3"/><rect x="13.5" y="5" width="4" height="14" rx="1.3"/></svg>';
const DEL_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12M10 11v6M14 11v6"/></svg>';
const DELNOTE_SVG = '<svg fill="currentColor" viewBox="0 0 1920 1920" xmlns="http://www.w3.org/2000/svg"><path d="M213.333 960c0-167.36 56-321.707 149.44-446.4L1406.4 1557.227c-124.693 93.44-279.04 149.44-446.4 149.44-411.627 0-746.667-335.04-746.667-746.667m1493.334 0c0 167.36-56 321.707-149.44 446.4L513.6 362.773c124.693-93.44 279.04-149.44 446.4-149.44 411.627 0 746.667 335.04 746.667 746.667M960 0C429.76 0 0 429.76 0 960s429.76 960 960 960 960-429.76 960-960S1490.24 0 960 0" fill-rule="evenodd"></path></svg>';
const REPLY_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19l-7-7 7-7M2 12h13a7 7 0 0 1 7 7v1"/></svg>';
const EDIT_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M13.5 6.5l3 3"/></svg>';
const DL_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>';
const PIN_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6l1 7 3 3v2H5v-2l3-3z"/><path d="M12 16v5"/></svg>';
const FLAG_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 21V3.5"/><path d="M5.5 3.5h11l-2.2 4.2L16.5 12H5.5"/></svg>';
const COPY_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
const BAN_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>';
const EYE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const INFO_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v.01"/><path d="M12 11.5V16"/></svg>';
const UNBAN_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5.5-5.5"/></svg>';
const SAVE_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10.5004 11.9998H5.00043M4.91577 12.2913L2.58085 19.266C2.39742 19.8139 2.3057 20.0879 2.37152 20.2566C2.42868 20.4031 2.55144 20.5142 2.70292 20.5565C2.87736 20.6052 3.14083 20.4866 3.66776 20.2495L20.3792 12.7293C20.8936 12.4979 21.1507 12.3822 21.2302 12.2214C21.2993 12.0817 21.2993 11.9179 21.2302 11.7782C21.1507 11.6174 20.8936 11.5017 20.3792 11.2703L3.66193 3.74751C3.13659 3.51111 2.87392 3.39291 2.69966 3.4414C2.54832 3.48351 2.42556 3.59429 2.36821 3.74054C2.30216 3.90893 2.3929 4.18231 2.57437 4.72906L4.91642 11.7853C4.94759 11.8792 4.96317 11.9262 4.96933 11.9742C4.97479 12.0168 4.97473 12.0599 4.96916 12.1025C4.96289 12.1506 4.94718 12.1975 4.91577 12.2913Z" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ADMIN_BADGE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" width="14" height="14"> <defs> <image width="1081" height="1080" id="agBg" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABDkAAAQ4AQMAAAA5HJXyAAAAAXNSR0IB2cksfwAAAAZQTFRFQ6Pc0683aUOsKgAAAAJ0Uk5TAP9bkSK1AAARrUlEQVR4nO2dW5IjuQ1FS7YjPH+eHQx3Yu/MMzuzdzLcgefPE2G7XCmlUnyAmcSFCKCjwY9ulbqSOl3CPUSqJObtQzx++vW/f5LPcpPP8L+Pj99+dADyl3+9ZRr5DJ/bH/IfiRjkz/9+zzziCf76j/tf//ybMchWqtsQB0cKci/Vd0wkPX5/Zj4+cpJNJAR5PjMfH7//YAqyZ+ZrfP7BFOSnX4+bv/xsCXKUiLhIhCCfr5tCucpA/vif121htcpAXrUqVpoMpKhVaWxkIEWtSqeSHf1ZfiFb90QgL69uIyczkDI00vyKQMrQSPMrAilDI82vCKQKjTC/IpC///y+uUQHf9ZfitZfCUidXqFIJCB1eoX5lYDU6TUEOTr4fYjyKwGpNSLMrwSk1ohwMsmxn+0dkvwKQNr0yvIrAGnTK2sE3goiya8ApE2vrBEQgLTplYlEANKlVyQSAUjTBAhnExzaaUQkEhyk14hIJDhIn16RSHCQtgnYhkAkOEivEZFIcJBeIyKR4CC9RkTT4UcSGpHkFwchNGICQmlEkl8YhNKIJL8wCKURSX5hEEojkvzCIJRGJI0ADEJqRFL86IGkRgT5hUFIjQgaARSE1ohAJCgIrRGBSFAQOr0CkaAgdHoFIkFBBunFRYKCDNIrqH7wuEF6cZGAIKP04iIBQUbpxUUCgtBNwDZQkbwdBBUJCDLSCC4SEGSkEVwkIMhQI3gO3w4CigQEGfoMFgkGMtYILBIMZJxeWCQYyKgb2QYokveDgCLBQMYagafEjjpJL5rfBSBYfjGQE42g+YVAzjSC5hcCOdMIml8I5Cy9aH4XgGCNAAQybovwOaGDTtMLigQCOU0vKBIEZHxS8xg5KYGcawQUCQJyrhFQJAjIeXpBkSAgF+nFRIKAnHYj6KTIMRcawUSCgFxoBBMJAHKlEUwkAMiVRjCRACBXGsHyC4BcaUQN5Eoj2KzAIZcagfILgFxqBMovAHKpESi/fJBrjUD55YNcawRqBPgg1xqB8ssHudYI1AjwQSbSC5Ue+4iJ9CIi4YNMpBcRCRtkJr2ISNggM+lFRMIGmUkvkl82yEx6kfyyQabSi9Qe94Cp9AKxYYNMpReIDRdkLr3AsscFmQsNEBsuyETDik3M/f7JWuVXKxNktkT4bmWCzJYIv0iYIJM6A2ZmfvukRbaRE2tmHsj8M8N+bnggjGeGOzXru+czs42cloGwfiDMxpUBwvt5bIOz4MyCzPVDxJj9sUyATFt9PHK6/JZTEPjHQI6cMBB+SVyPkwVoCDJ32sAdObFBphsP1hh390OQN5QoNYYhGoFwVhXOGFbJCGTNM3OyFI5AFj0z4+dmALIiu4+REwvkvSorx2j9GYCsKpFxgAcgy0pkXAz0vctKZHjCQ4Osssg2BiahQdbV6rBaaZB1tTqsVhqE2ZzyxqAsyXsZ51H8QVcrCbIyNCO3kiBrmqLnoGNDgqxM7yg2JMjK9I46ARJkZXpH+SVBlqZ3FBDqzqXpHeTXNcja9A7y6xpkbXoHIrEAIUVCgazVyEAkFMhijdAPSt23sHN+DOokiwJZrBFaJATI2m7EFUhOUyCrfUYbjQBZ2xZtgzIaAbLaZ45AKLUSIKvFSquVAFkuVj8gpDT6u5YbnnS8Z5DlSw3p+B5kveFJx3/nIMRi04OsX/McgRCLTQ+yfvF1BEKsej3I+sU3QPpBLL89yPp25FsDUWhHSKEHyOU9Cn0R1RkFyDcEotCyUk1rgASIU5Cc2nv8gmic1gRIgARIgARIgARIgATINwmi8Xov9dJzgARIgARIgARIgARIgARIgARIgARIgARIgATItwKi8Q7BAAmQAOGP/i2+ARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgARIgAaIMorGjQ4AESIAESIAESIDog/RbOwVIgARIgARIgHy/IBp79wVIgARIgATI+0e/L2qABAgbRGWf2ADpR/e4fkFU9okNkH50e+f6BVHZjJTYoNUtiM6eW8SuWwFyBaLzUU7iY2kBcgWi89YA4tcTbkF0XjAiTmzcguj0zkSv6BZEqVMklO4VRKkv6jujFkSpHekbEq8gWl1A3wc0IFprXr/qmYG0i00DorXm9Y5vQLSWmksQLcP3jm9A1MTa59UMpFFrA6Jm+M5oDYiaWDuj1SB6Yu2MVoPo+awzWg2i57MLED2fdSKpQfR8dgGiqJEuJ9VXihppjVaDKGqkNVoFoqmR1mgViKZGWqMZgtQiqUA0NdK2RoYgtUgqEE2ftY9dfaHqs0YkFYiqzxqRVCCqPmtEUoLo+uwERFcjjdFKEM22aBuV0UoQXY00RitBlDVSG60EUdZIk5TitrJGaqOVIMoaqY1WgGhrpBZJAaKtkVokBYi2RmqRFCDaGqlFUoBoa6QWSQGirpE6Kq+b6hqpRFKAqGukEskLRF8jlUheIPoaqURiC1KI5AWir5FKJC8QfY1UIrEFKbNy3DLQSCmSF4iBRkqRHCAWGilFYgzyEskBot+NbOMlkgPEQiOlSA4Qk/QWIvEHYtAWbeMQyQFi4rNCJAeIic8KkTxBbDRCgFh0I9s4jPYEsfFZYbQniI3PCqM9QWw0UojkCWKkkSIt+99GGnkZ7QlipJGX0XYQK428RLKDWGnkJZIdxEojL5HsIFYaeYlkB7HSyEskO4iZRl5xefxlppFDJDuImUYOkTxA7DRyiOQBYqeRQyQPEDuNHCJ5gNhp5BDJA8ROI4dIHiCGGjnycv/TUCNPkTxADDVSgVhq5Gm0O4ilRp4iuYNYauQpEl8glhp5Gs0ByMNodxBTnz2Tu/1h6rNdJHcQU5/tItlAbH22t0YbiK3PdqNtILYa2UWygVi2Rdu4i2QDsdXILpINxFgje2I+zDXyEMkGYqyRh0g8gVj77GG0m73PHka72fvsYbSbvc8eRnMBshntZi/Wj0dkHIj1brSbA7E+Qcx9djfazYHP7kZzBGIv1rtabw7EelerIxB7sd4d7wjEgeG3xcYRiIOlZlvyHIE4WPO2Vc8RiIPFd1t+A6QeXyAeuoCtD/AD4qEd2RqSAKmHG5Dff7h5aNACpB9fIB46xa1XDJB6eALx0Dtv3XOA1MMTiIuzia/ziQBpRoC043ZzcaL3daoXIM0IkHYESDsCpB0B0o4AaUeAtCNA2uEIxEmrGCDtcNTFuwHxcRIeIO3w9PqIGxAfryq6AfH0OquPXwq4AfH0axI3v0oLkGr89qOT34QHSDtycvK2DVcgLs6wtnfUBEg5tndduTifcAXiomm9OXn35h3EQ694fxupGxAPLdr9rcYeQO7vAvfQGbkBuX9SwENDcgfx0Afk5ArEwfJ7/6CPh1Xv8dEnByA3Xx+Ps19s9g8M2oPsH6G0X2z2D5XaO37/mK2943Py9VFse5Dnp+TNHf/cN8BarcdOCtZqPUCsjXZscmFttGP/EWuj5fThY2uYY48aa5G8QNxsH+RmQyU3W0zZiqTYdMvNNmS2IMUOcbZGy+kAcbN5n5vtDG2NVu40aWm0au9NS6NVu5FaGq3an9VSJNWOtZYiyakAsRRJtauxpUjqfZ4NRVLvfO1mC247kTS7o7vZpt3NxvV2IsmpArETSXOVBTeXe/BzAQw3lwRxc5EUN5eNcXMhHSuQ7tJCVkbLqQGxMpqb62C5uTLYrbthYzQ3V48jrqdnYzTiCoM2IiGuufidX4WSuC6nmwuE2uT3RtxyA+LmsroW+SWveOwGxM3FqN1cntvNBcv9XMLdzUXt9UVSaKQE0e9IiuuVlyD6Iik0UoLoi6TQSFUu6iLJiQTRF0mhkQpEXSSFRioQdZHcBre1RVJqpALRFkmpkQpEWySlRioQbZGUGqnrRVkkOQ1AtEVSaqQGURZJqZEaRFkkt+EXuiKpNFKD6Iqk0kgNoiuSSiM1iK5I3IBUPqtBdEWSU/lVDaIqkspnliCVzxoQVaPdTr7SNFrtswZE02i1zxoQTaPVGmlANEVSa6StGMXWKKcTEE2j1RppQRRFUmukBVEUye30SzcgekZrfNaC6Bmt8VkLome0xmduQfTU2oi1q101teb0bYDoOb4xfAei5vjG8H5B1BzfPrAVSGv4DkRrsbkE0Vps3IC0a55fEK1Vr13z/IJoLb/t4usXRGv5zSlAmCBaDUnbjjgGUWpI3IC0fZFjEKXOyA1I97gBcnmHUtMaIM3oeucACZAACZD3g+ic/AZIO7oXAwIkQAIkQAIkQAIkQAIkQAIkQAIkQNRAdH7x2/3aN0ACJEACJEACJEACJEACJEACJEACJEACJEACJEACJEACJEACJEC8geh8Pi5AAiRAAiRAAuS7Aek+Eh4gARIgARIgARIgARIgARIgARIgARIgZiA6+5AFSIAECHfkFCABEiABEiABYg6is0FrtytqgASIV5Bun1gCRGXv3ABBQFS2rO0fNkCu79HYarLfVtEziMZ2G/1mG55BNN5H6gakf2cPAaLxsqIbkP51GsosCt2zG5CcJkA0OqOcurtsQPpOkQJRaEj6doQCUVh+3YAQj0rcpbD8egEhugAKZP3yOwmyftUjFl8bEGLNo0DWr3qTIOsXG2LNo0DWOz6n/j4TEGKpIUGWLzazIMsdTyw1JMhytVIPagFCiZUEWe14SqwkyGq1Uj4jQVarlfIZXTeL1ZrTJMhqo1EaoUEWG43SCA2y2GjkY5J3rhUJqREaZK1ISI3QIGtFQqaXBlkrkpymQdaKhEwvDbJWJGR6ByAr80uHZgCyMr90aAYgK2NDrr0jkJWxyYkBsrJa6dCMQBZW6+ARB3evq9ZBrY5A1hUJLfghyLoiGZTIEGRZkYwecHT/qk5gVCJjwEXrXk5MkFV96/Dxhv+wJsCjzJyArAnw8OFO/mVFueYEgGzjzTY54bgAOYa8Ys4gtjEJsg2gaq4eHQNhR3rQAr0BhPkzYc3N+mbej2TsDDkIK9L0acN7QDgr0HB5ewcI57nJiTUzE4ThE94zwwWZP+FhPjNckPki4WWGDTJfJMxnhg0yWySDU+33gcwWCbdE2CCzlueWCBtktkUZnb68D2SyWrm1ygeZPPNiz8s+YC427Frlg8zFhtUTYSBzsWGHBngupySf03KQufyyQwOATOWXPy3/iJn8slcaBGQmv/z0AiAz+eWnFwCZyS8/vYtAclIAmckve+2FQCbyy9cIAnKdXyC9CMh1foH0IiDXJ8BAehGQa5EA6UVArvObkwrIdSMApBcBuRYJkF4I5FIkyKTIMVciQTQCgVyJBNEIBHIlEkQjEMiVSBCNQCBXIslJCeRKJIhGIJArkSAawUAuRALNCR10LhJIIxjIuUggjWAg5yKBNIKBnIsE0ggGci6SnNRAzkUCaQQDORcJpBEQ5FQk2JTYUWciwTQCgpyJBNMICHImEkwjIMiZSDCNgCBnIslJEeRMJJhGQJAzkWAaQUHG+QXTi4KM86sMMs4vqBEUZJxfUCMoyDi/OamCjPMLphcFGecXTC8MMmwE0AnR40YiQdMLg4xEog4yEgmaXhhkJBKwCcBBRiLJSRlkJBJUIzDISCSoRnCQgUjg+eADaZHA6cVBaJGgTYAAhBYJrBEchBYJrBEchBZJTuogtEhgjeAgtEhgjQhASJHg0+FHUiLBNSIAoUSCa0QAQokE14gAhBIJrhEBCCWSnAxAKJHgGhGAUPnFNSIBIfIrmE1waJ9fgUYkIH1+BRqRgPT5FWhEAtLnV6ARUXl1+c3JBKRvBAQaEYF0IpFMJjm2E4kVSCsSSXpFIK1IzEBakUjSK3tam/zmZATS5leSXhlIk19BEyAEafIrmkt0cJ1fSRMgBKnzK0qvDKTOr6QJEILUjYBII8ICq0SSkxlInV9ReoUgVX4tQcr8ytIrBCnzK0uvEKSMjSy9QpAyNrL0CkHK2IjWXjFIUa3CmYSHvyQvDI34/3EUibBEpCCvIhGWiBjkKBLpRNLjn0UitIgc5NlA5yScRwyyPzfiecQTPCwvzcwbQB65kbUA7wHZylX+A3kDyFe9voHj4/9cM/yi+9UsywAAAABJRU5ErkJggg=="/> </defs> <g id="Background"> <use id="Path 1" href="#agBg" x="-1" y="0"/> <path id="Path 2" fill="#ffffff" d="m698.06 378.95c-2.03 0.6-6.68 3.09-10.33 5.55-3.65 2.46-9.74 8.06-13.53 12.44-3.78 4.39-10.09 12.07-14.02 17.08-3.92 5-11.78 14.97-17.46 22.14-5.68 7.18-17.64 21.89-26.57 32.7-8.93 10.81-17.88 21.77-19.9 24.35-2.02 2.58-18.89 23.94-37.47 47.48-18.59 23.54-36.61 45.79-40.05 49.44-3.43 3.66-11.88 14.28-18.77 23.62-6.89 9.33-14.61 18.79-17.16 21.03-3.72 3.25-5.22 3.76-7.59 2.58-1.62-0.81-20.88-19.08-42.8-40.59-28.82-28.29-41.78-40.01-46.85-42.37-5.51-2.57-9.7-3.27-19.56-3.27-9.42 0-14.19 0.74-19.18 2.99-3.66 1.64-9.55 5.6-13.1 8.8-3.55 3.2-8.37 9.63-10.7 14.3-3.65 7.3-4.24 10.19-4.23 20.66 0.01 9.59 0.74 13.74 3.43 19.56 1.99 4.3 9.18 13.53 17.23 22.13 7.6 8.12 25.82 26.94 40.48 41.83 14.66 14.88 37.62 37.43 51.01 50.09 16.54 15.65 26.72 24.12 31.73 26.42 4.06 1.86 11.69 3.83 16.97 4.37 8.86 0.9 10.42 0.59 20.47-4.05 7.79-3.59 13.03-7.33 18.45-13.15 4.16-4.47 11.88-13.43 17.16-19.92 5.28-6.49 14.24-17.8 19.92-25.14 5.69-7.34 27.93-35.16 49.44-61.82 21.51-26.67 45.75-56.93 53.87-67.26 8.12-10.32 26.76-33.64 41.43-51.81 14.68-18.17 32.85-41.01 40.4-50.75 7.54-9.74 15.29-20.87 17.23-24.72 1.93-3.86 3.92-9.5 4.43-12.55 0.52-3.15-0.11-10.29-1.46-16.6-1.37-6.4-4.18-13.87-6.66-17.71-2.36-3.65-6.85-8.59-9.98-10.98-3.13-2.39-7.85-5.21-10.49-6.27-2.85-1.15-10.34-1.88-18.45-1.81-7.51 0.07-15.31 0.62-17.34 1.21z"/> </g> </svg>';
const VERIFIED_BADGE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" width="14" height="14"> <g id="Background"> <path id="Path 1" fill="#43a3dc" d="m530.1 0.9c-1.87 0.49-7.85 2.19-13.28 3.79-5.43 1.6-12.87 4.4-16.52 6.22-3.65 1.82-10.29 6.17-14.76 9.67-4.46 3.5-28.7 26.71-53.86 51.59-39.67 39.21-47.03 45.85-55.35 49.86-5.27 2.55-13.57 5.73-18.44 7.07-7.33 2.01-21.13 2.63-79.7 3.61-38.96 0.65-73.83 1.84-77.48 2.65-3.65 0.8-10.29 2.9-14.76 4.67-4.46 1.76-11.1 5.39-14.75 8.06-3.66 2.67-10.65 9.09-15.54 14.25-5.18 5.47-10.81 13.42-13.46 18.99-2.51 5.28-5.4 13.25-6.42 17.71-1.23 5.41-2.22 31.04-2.98 76.75-0.63 37.74-1.85 72.61-2.72 77.48-0.87 4.87-3.03 12.17-4.79 16.23-1.77 4.06-5.24 10.37-7.72 14.02-2.47 3.65-20.5 22.91-40.07 42.8-19.56 19.89-41.51 42.52-48.78 50.3-7.27 7.77-15.34 18.07-17.93 22.87-2.59 4.8-6.08 14.38-7.74 21.28-1.67 6.9-3.04 15.2-3.05 18.45-0.02 3.24 1.3 11.21 2.94 17.71 1.63 6.49 5.23 16.45 8.01 22.13 3.14 6.44 9.34 15.06 16.44 22.88 6.27 6.9 25.49 26.82 42.72 44.27 17.23 17.46 35.06 35.88 39.64 40.96 4.57 5.07 10.41 13.37 12.96 18.45 2.56 5.07 5.61 12.54 6.78 16.6 1.63 5.69 2.39 24.13 3.3 80.43 0.88 54.48 1.69 74.93 3.21 80.43 1.12 4.06 4.97 12.36 8.55 18.45 3.58 6.09 10.54 15.27 15.47 20.4 6.6 6.86 12.08 10.83 20.77 15.03 6.49 3.14 14.46 6.5 17.71 7.47 4.04 1.2 27.26 1.94 73.79 2.35 37.34 0.33 72.53 1.27 78.22 2.09 6.6 0.95 14.72 3.59 22.5 7.33 11.64 5.58 14.37 7.99 61.99 54.73 28.51 27.99 53.59 51.36 58.66 54.65 4.87 3.16 14.17 7.56 20.66 9.77 9.82 3.34 14.17 3.99 25.83 3.86 11-0.13 16.72-1.04 26.56-4.24 6.9-2.25 15.54-6.1 19.19-8.57 3.65-2.46 23.57-21.2 44.27-41.65 20.7-20.44 43.28-42.42 50.18-48.85 6.9-6.42 15.53-13.38 19.19-15.45 3.65-2.07 10.79-5.22 15.86-6.99 5.07-1.78 13.71-3.88 19.19-4.68 5.48-0.79 35.19-1.46 66.04-1.48 31.1-0.01 62-0.75 69.36-1.64 7.94-0.96 17.44-3.3 23.61-5.82 7-2.85 14.14-7.47 22.14-14.33 7.93-6.78 13.88-13.48 18.13-20.37 3.47-5.64 7.7-14.57 9.38-19.84 2.87-8.95 3.15-14.49 4.2-81.91 0.95-60.71 1.53-73.74 3.6-81.17 1.36-4.87 4.08-12.18 6.05-16.24 1.96-4.05 7.07-11.43 11.36-16.39 4.28-4.95 25.84-27.53 47.9-50.18 22.06-22.64 42.82-44.48 46.14-48.54 3.31-4.06 7.92-12.36 10.24-18.45 2.32-6.08 5.07-15.71 6.11-21.4 1.48-8.07 1.52-12.67 0.19-21.03-0.93-5.88-3.38-15.18-5.44-20.66-2.06-5.48-5.94-13.28-8.63-17.34-2.68-4.06-26.41-29.29-52.73-56.08-32.04-32.62-49.38-51.38-52.5-56.82-2.55-4.46-6.15-12.43-7.98-17.71-3.23-9.27-3.38-12.01-4.38-81.17-0.58-39.76-1.73-74.85-2.59-78.95-0.85-4.06-2.92-11.03-4.61-15.5-1.68-4.46-6.71-12.6-11.17-18.08-4.45-5.48-11.59-12.72-15.85-16.09-4.26-3.37-11.9-8.02-16.97-10.33-5.08-2.31-12.05-4.92-15.5-5.79-3.69-0.94-35.78-2.1-77.85-2.82-53.88-0.91-73.58-1.74-79.69-3.32-4.47-1.16-11.77-3.95-16.24-6.22-4.46-2.26-11.1-6.52-14.75-9.46-3.66-2.94-28.06-26.11-54.24-51.48-26.18-25.37-50.08-47.7-53.13-49.62-3.04-1.92-11.18-5.3-18.08-7.5-7.05-2.25-17.06-4.22-22.87-4.51-5.68-0.28-11.87-0.12-13.74 0.36z"/> <path id="Path 2" fill="#ffffff" d="m698.06 378.95c-2.03 0.6-6.68 3.09-10.33 5.55-3.65 2.46-9.74 8.06-13.53 12.44-3.78 4.39-10.09 12.07-14.02 17.08-3.92 5-11.78 14.97-17.46 22.14-5.68 7.18-17.64 21.89-26.57 32.7-8.93 10.81-17.88 21.77-19.9 24.35-2.02 2.58-18.89 23.94-37.47 47.48-18.59 23.54-36.61 45.79-40.05 49.44-3.43 3.66-11.88 14.28-18.77 23.62-6.89 9.33-14.61 18.79-17.16 21.03-3.72 3.25-5.22 3.76-7.59 2.58-1.62-0.81-20.88-19.08-42.8-40.59-28.82-28.29-41.78-40.01-46.85-42.37-5.51-2.57-9.7-3.27-19.56-3.27-9.42 0-14.19 0.74-19.18 2.99-3.66 1.64-9.55 5.6-13.1 8.8-3.55 3.2-8.37 9.63-10.7 14.3-3.65 7.3-4.24 10.19-4.23 20.66 0.01 9.59 0.74 13.74 3.43 19.56 1.99 4.3 9.18 13.53 17.23 22.13 7.6 8.12 25.82 26.94 40.48 41.83 14.66 14.88 37.62 37.43 51.01 50.09 16.54 15.65 26.72 24.12 31.73 26.42 4.06 1.86 11.69 3.83 16.97 4.37 8.86 0.9 10.42 0.59 20.47-4.05 7.79-3.59 13.03-7.33 18.45-13.15 4.16-4.47 11.88-13.43 17.16-19.92 5.28-6.49 14.24-17.8 19.92-25.14 5.69-7.34 27.93-35.16 49.44-61.82 21.51-26.67 45.75-56.93 53.87-67.26 8.12-10.32 26.76-33.64 41.43-51.81 14.68-18.17 32.85-41.01 40.4-50.75 7.54-9.74 15.29-20.87 17.23-24.72 1.93-3.86 3.92-9.5 4.43-12.55 0.52-3.15-0.11-10.29-1.46-16.6-1.37-6.4-4.18-13.87-6.66-17.71-2.36-3.65-6.85-8.59-9.98-10.98-3.13-2.39-7.85-5.21-10.49-6.27-2.85-1.15-10.34-1.88-18.45-1.81-7.51 0.07-15.31 0.62-17.34 1.21z"/> </g> </svg>';

const NAME_COLORS = ["#e17076", "#faa774", "#a695e7", "#7bc862", "#6ec9cb", "#65aadd", "#ee7aae", "#f5c542"];

function nameColor(name) {
  name = String(name || "");
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h * 33) ^ name.charCodeAt(i)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
}
function lightenHex(hex, t) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const mix = (c) => Math.round(c + (255 - c) * t);
  return "#" + ((1 << 24) + (mix((n >> 16) & 255) << 16) + (mix((n >> 8) & 255) << 8) + mix(n & 255)).toString(16).slice(1);
}
function glossBg(hex) {
  return "radial-gradient(circle at 30% 25%, " + lightenHex(hex, 0.38) + ", " + hex + ")";
}
function avatarBg(name) {
  return glossBg(nameColor(name));
}

// Reply quotes tint their background with the quoted author's colour. The CSS
// does that by washing an rgba() of it over an opaque base (see .replyQuote),
// which needs the colour as an "r, g, b" triplet as well as a hex string.
function setAccentVars(node, color) {
  if (!node || !node.style) return;
  const hex = String(color || "");
  node.style.setProperty("--rqaccent", hex);
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return;
  const n = parseInt(m[1], 16);
  node.style.setProperty("--rqaccent-rgb", ((n >> 16) & 255) + ", " + ((n >> 8) & 255) + ", " + (n & 255));
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function locNetEl(loc, proxy) {
  const d = el("div", "olNet");
  const isVpn = typeof loc === "string" && loc.endsWith(" \u26A0VPN");
  if (isVpn) loc = loc.slice(0, -5);
  if (loc) d.appendChild(document.createTextNode(loc));
  if (proxy) d.appendChild(el("span", "olBadge vpn", "VPN/Proxy"));
  else if (isVpn) d.appendChild(el("span", "olBadge vpn", "VPN?"));
  return d;
}

const PROF_MASK_CHARS = (() => {
  const a = [];
  for (let c = 0x282d; c <= 0x28ff; c++) a.push(String.fromCharCode(c));
  return a;
})();
function profRandomMask(n) {
  n = Number(n) || 0;
  let s = "";
  for (let i = 0; i < n; i++) s += PROF_MASK_CHARS[(Math.random() * PROF_MASK_CHARS.length) | 0];
  return s;
}
function profEscRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function profEscAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
let PROF_RE = null;
function profRegex() {
  if (PROF_RE) return PROF_RE;
  let words = [];
  try {
    words = (root.profanity ? root.profanity.selectAll : []).map((n) => String(n.evaluateItem).trim()).filter(Boolean);
  } catch (e) { words = []; }
  words = [...new Set(words)];
  const isAlnum = /[a-z0-9]/i;
  const parts = words.map((w) => {
    const cs = [...w];
    const sep = cs.length >= 4 ? "[\\s._*\\-]*" : "[._*\\-]*";
    let p = "";
    for (let i = 0; i < cs.length; i++) {
      if (i > 0 && isAlnum.test(cs[i - 1]) && isAlnum.test(cs[i])) p += sep;
      p += isAlnum.test(cs[i]) ? profEscRe(cs[i]) + "+" : profEscRe(cs[i]);
    }
    return p;
  }).sort((a, b) => b.length - a.length);
  PROF_RE = parts.length ? new RegExp("\\b(?:" + parts.join("|") + ")\\b", "gi") : null;
  return PROF_RE;
}
function nameHasBlacklisted(name) {
  const re = profRegex();
  if (!re) return false;
  re.lastIndex = 0;
  return re.test(String(name || ""));
}
function maskProfanity(html) {
  const re = profRegex();
  if (!re || !html) return html;
  return String(html).replace(/(<[^>]*>)|([^<]+)/g, (m, tag, text) => {
    if (tag || !text) return m;
    return text.replace(re, (w) => {
      const len = [...w].length;
      return '<span class="profMask" role="button" tabindex="0" data-word="' + profEscAttr(w) + '" data-len="' + len + '">' + profRandomMask(len) + "</span>";
    });
  });
}
function profMaskLen(el) {
  const n = Number(el.dataset.len);
  return n || [...(el.dataset.word || "")].length || 4;
}
function profToggle(el) {
  if (el.classList.contains("revealed")) {
    el.classList.remove("revealed");
    el.textContent = profRandomMask(profMaskLen(el));
  } else {
    el.classList.add("revealed");
    el.textContent = el.dataset.word || "";
  }
}
setInterval(() => {
  const nodes = document.querySelectorAll(".profMask:not(.revealed)");
  for (const n of nodes) n.textContent = profRandomMask(profMaskLen(n));
}, 500);
const profMaskFrom = (e) => (e.target && e.target.closest ? e.target.closest(".profMask") : null);
document.addEventListener("click", (e) => {
  const el = profMaskFrom(e);
  if (!el) return;
  e.preventDefault();
  e.stopPropagation();
  profToggle(el);
}, true);
document.addEventListener("pointerdown", (e) => { if (profMaskFrom(e)) e.stopPropagation(); }, true);
document.addEventListener("contextmenu", (e) => { if (profMaskFrom(e)) e.stopPropagation(); }, true);

function linkifyHtml(text) {
  let esc = String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const codes = [];
  esc = esc.replace(/`([^`\n]{1,200})`/g, (m, c) => { codes.push(c); return "\u0000" + (codes.length - 1) + "\u0000"; });
  esc = esc.replace(/\*\*([^*]{1,500}?)\*\*/g, "<b>$1</b>");
  esc = esc.replace(/~~([^~]{1,500}?)~~/g, "<s>$1</s>");
  esc = esc.replace(/\*([^*\n]{1,500}?)\*/g, "<i>$1</i>");
  esc = esc
    .replace(/(@[\w\u00c0-\uffff]+)/g, (m) => `<span class="mention" data-mention="${m.slice(1)}">${m}</span>`)
    .replace(/(https?:\/\/[^\s<]+)/g, (m) => {
      const url = m.replace(/[.,;:!?)]+$/, "");
      if (!url) return m;
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    });
  esc = esc.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${codes[Number(i)]}</code>`);
  return maskProfanity(esc);
}

/* ---------- YouTube links ----------
   A message containing a YouTube link gets an inline player instead of the
   generic link card. We render a click-to-play facade first (thumbnail + play
   button) so a busy chat doesn't spawn a dozen YouTube players at once - the
   real youtube-nocookie iframe is only created when someone taps it. */
function youTubeId(url) {
  let u;
  try { u = new URL(url); } catch (e) { return ""; }
  const host = u.hostname.toLowerCase().split(".").slice(-2).join(".");
  const ok = (id) => (/^[A-Za-z0-9_-]{11}$/.test(id) ? id : "");
  if (host === "youtu.be") return ok((u.pathname.replace(/^\/+/, "").split("/")[0]) || "");
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return "";
  if (u.pathname === "/watch" || u.pathname === "/watch/") return ok(u.searchParams.get("v") || "");
  const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
  return m ? ok(m[1]) : "";
}

function ytThumbEl(id) {
  const img = document.createElement("img");
  img.className = "ytThumb";
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  img.src = "https://i.ytimg.com/vi/" + id + "/maxresdefault.jpg";
  img.addEventListener("error", () => { img.src = "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg"; }, { once: true });
  return img;
}

function buildYouTubeEmbed(bubble, id) {
  if (!bubble.classList.contains("imgBubble")) bubble.classList.add("ytBubble");
  const card = el("div", "ytCard");
  const head = el("div", "ytHead");
  const logo = el("div", "ytLogo");
  logo.innerHTML = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg>';
  head.appendChild(logo);
  const title = el("div", "ytTitle", "YouTube");
  head.appendChild(title);
  card.appendChild(head);

  const wrap = el("div", "ytEmbedWrap");
  wrap.appendChild(ytThumbEl(id));
  const play = el("div", "ytPlay");
  play.innerHTML = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg>';
  wrap.appendChild(play);
  wrap.addEventListener("click", (e) => {
    e.stopPropagation();
    if (wrap.classList.contains("playing")) return;
    const app = document.getElementById("app");
    if (app && app.classList.contains("selMode")) return;
    wrap.classList.add("playing");
    const iframe = document.createElement("iframe");
    iframe.src = "https://www.youtube-nocookie.com/embed/" + id + "?autoplay=1&rel=0&modestbranding=1";
    iframe.title = title.textContent || "YouTube video player";
    iframe.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share");
    iframe.setAttribute("allowfullscreen", "");
    iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    wrap.innerHTML = "";
    wrap.appendChild(iframe);
  });
  card.appendChild(wrap);
  bubble.appendChild(card);

  root.superFetch("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + id))
    .then((r) => r.text())
    .then((t) => {
      let o = null;
      try { o = JSON.parse(t); } catch (e) {}
      if (o && o.title) title.textContent = String(o.title).slice(0, 160);
    })
    .catch(() => {});
}

async function addLinkPreview(bubble, text) {
  const m = String(text || "").match(/(https?:\/\/[^\s<]+)/);
  if (!m) return;
  const url = m[0].replace(/[.,;:!?)]+$/, "");
  let host = url;
  try { host = new URL(url).host; } catch (e) {}
  const ytId = youTubeId(url);
  if (ytId) { buildYouTubeEmbed(bubble, ytId); return; }
  const card = el("div", "linkPreview");
  const img = el("div", "lpImg");
  const body = el("div", "lpBody");
  body.appendChild(el("div", "lpTitle", host || url));
  card.appendChild(img);
  card.appendChild(body);
  bubble.appendChild(card);
  card.addEventListener("click", (e) => { e.stopPropagation(); window.open(url, "_blank", "noopener"); });
  try {
    const html = await root.superFetch(url).then(r => r.text());
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    const og = (p) => (doc.querySelector('meta[property="' + p + '"]') || {}).content || (doc.querySelector('meta[name="' + p + '"]') || {}).content || "";
    const title = og("og:title") || (doc.querySelector("title") || {}).textContent || "";
    if (title) {
      const desc = og("og:description");
      const imgsrc = og("og:image") || og("twitter:image") || "";
      body.innerHTML = "";
      body.appendChild(el("div", "lpTitle", title.trim().slice(0, 160)));
      if (desc) body.appendChild(el("div", "lpDesc", desc.trim().slice(0, 200)));
      body.appendChild(el("div", "lpHost", host));
      if (imgsrc) img.style.backgroundImage = "url('" + String(imgsrc).replace(/'/g, "") + "')";
    }
  } catch (e) {}
}

function tsrowEl(m, mine) {
  const ts = el("span", "tsrow");
  if (m.edited) {
    ts.appendChild(el("span", "editedMark", "edited"));
  }
  const time = el("span", "tsTime");
  time.textContent = new Date(m.ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  ts.appendChild(time);
  if (mine) {
    const check = el("span", "tsCheck");
    check.innerHTML = CHECK_SVG;
    ts.appendChild(check);
  }
  return ts;
}

function adminBadgeEl() {
  const b = el("span", "verifiedBadgeWrap adminBadgeWrap");
  b.innerHTML = ADMIN_BADGE_SVG;
  b.title = "Admin";
  return b;
}
function verifiedBadgeEl() {
  const b = el("span", "verifiedBadgeWrap");
  b.innerHTML = VERIFIED_BADGE_SVG;
  b.title = "Verified account";
  return b;
}
function applyAuthorOutline(bubble, name) {
  if (!bubble) return;
  bubble.dataset.author = name || "";
  bubble.classList.toggle("adminMsg", name === "admin");
  bubble.classList.toggle("verifiedMsg", !!name && name !== "admin" && verifiedSet.has(name));
}
function applyVerifiedToSender(sender) {
  const name = sender.getAttribute("data-vname");
  const existing = sender.querySelector(".verifiedBadgeWrap");
  if (name === "admin") {
    if (!existing) {
      if (sender.querySelector(".adminBadgeWrap")) return;
      sender.appendChild(adminBadgeEl());
    }
    return;
  }
  if (verifiedSet.has(name)) {
    if (!existing) sender.appendChild(verifiedBadgeEl());
  } else if (existing) existing.remove();
}
function refreshVerifiedUI() {
  try { if (pinnedMsg) renderPinned(pinnedMsg); } catch (e) {}
  for (const s of document.querySelectorAll(".senderName")) applyVerifiedToSender(s);
  for (const b of document.querySelectorAll(".bubble[data-author]")) applyAuthorOutline(b, b.dataset.author);
  const tr = document.getElementById("typingRow");
  if (tr) typingOutline(tr.querySelector(":scope > .bubble"), typingNames());
  ensureOnlineClickable();
  if (!onlineModal.classList.contains("hide")) renderOnlineList();
  // Verification is what grants private chat, and what puts a name in the list.
  pruneDmToVerified();
}
function senderNameEl(m, mine, grouped) {
  if (mine || grouped) return null;
  const s = el("div", "senderName");
  s.setAttribute("data-vname", m.from);
  s.textContent = m.from;
  s.style.color = nameColor(m.from);
  applyVerifiedToSender(s);
  if (bannedNames.has(m.from)) s.appendChild(el("span", "bannedChip", "banned"));
  return s;
}

function lastMessageFrom() {
  const kids = [...messagesEl.children];
  for (let i = kids.length - 1; i >= 0; i--) {
    const n = kids[i];
    if (n.classList.contains("msg")) return n.dataset.from || null;
    if (n.classList.contains("sys") || n.classList.contains("sep")) return null;
  }
  return null;
}

// Ownership read straight off a rendered message (private-thread peer first,
// then uid, then the sent ledger, then the nickname) so it can be re-evaluated
// after our identity becomes known - e.g. when a nickname is entered after
// history was rendered.
function wrapIsMine(wrap) {
  const host = wrap.parentElement;
  const peer = (host && host.dataset && host.dataset.peer) || "";
  if (peer && wrap.dataset.from) return wrap.dataset.from !== peer;
  const uid = wrap.dataset.uid;
  if (uid) return myUids.has(uid);
  const ts = wrap.dataset.ts;
  if (ts && mySentTs.has(String(ts))) return true;
  return !!myName && wrap.dataset.from === myName;
}
function reclassifyOwnership() {
  for (const host of msgContainers()) {
    const peer = (host.dataset && host.dataset.peer) || "";
    for (const wrap of [...host.children]) {
      if (!wrap.classList || !wrap.classList.contains("msg")) continue;
      const mine = peer && wrap.dataset.from ? wrap.dataset.from !== peer : wrapIsMine(wrap);
      wrap.classList.toggle("out", mine);
      wrap.classList.toggle("in", !mine);
      const bubble = wrap.querySelector(".bubble");
      if (!bubble) continue;
      const prev = wrap.previousElementSibling;
      const grouped = !!(prev && prev.classList && prev.classList.contains("msg") && prev.dataset.from && prev.dataset.from === wrap.dataset.from);
      const sn = bubble.querySelector(".senderName");
      if (!mine && !grouped) {
        if (!sn) {
          const fresh = senderNameEl(msgByWrap.get(wrap) || { from: wrap.dataset.from }, false, false);
          if (fresh) bubble.insertBefore(fresh, bubble.firstChild);
        }
      } else if (sn) sn.remove();
      const ts = bubble.querySelector(".tsrow");
      if (ts) {
        const chk = ts.querySelector(".tsCheck");
        if (mine && !chk) {
          const c = el("span", "tsCheck");
          c.innerHTML = CHECK_SVG;
          ts.appendChild(c);
        } else if (!mine && chk) chk.remove();
      }
    }
  }
  updateBubbleTails();
  // A message that only became "mine" now (nickname applied late) needs its
  // private-chat tick, which is painted from ownership rather than at build time.
  if (convo.mode === "dm") applyDmSeen();
}

let pendingDelIds = [];
const uploadPlaceholders = [];
const bannedNames = new Set();

function isAdmin() { return myName === "admin"; }

// Verified users may delete any message except the admin's or another verified
// user's (the server enforces the same rule, so this only drives the UI).
function canModerateTarget(name) { return !!name && name !== "admin" && !verifiedSet.has(name); }
function canDeleteMsg(m) {
  if (!m || !m.from) return false;
  if (isMine(m)) return true;
  if (isAdmin()) return true;
  return verifiedSet.has(myName) && canModerateTarget(m.from);
}
function nodeDeletable(n) {
  if (!n || !n.dataset || !n.dataset.from) return false;
  if (wrapIsMine(n)) return true;
  if (isAdmin()) return true;
  return verifiedSet.has(myName) && canModerateTarget(n.dataset.from);
}

function showBannedModal() {
  bannedModal.classList.remove("hide");
}
bannedOkBtn.addEventListener("click", () => bannedModal.classList.add("hide"));

const plogoutModal = document.getElementById("plogoutModal");
const plogoutDesc = document.getElementById("plogoutDesc");
const plogoutOkBtn = document.getElementById("plogoutOkBtn");
let pendingProtectedName = "";
function showProtectedLogoutModal(name) {
  pendingProtectedName = name || "";
  plogoutDesc.textContent = name
    ? "You were logged out of \u201C" + name + "\u201D. Please log in with the password."
    : "You were logged out. Please log in with the password.";
  plogoutModal.classList.remove("hide");
}
plogoutOkBtn.addEventListener("click", () => {
  plogoutModal.classList.add("hide");
  promptProtectedLogin(pendingProtectedName || savedNick || myName);
  pendingProtectedName = "";
});

let regionBlocked = false;
const regionModal = document.getElementById("regionModal");
const regionTitle = document.getElementById("regionTitle");
function showRegionBlocked() {
  regionBlocked = true;
  regionTitle.textContent = myCountry === "Pakistan" ? "Unavailable in Pakistan" : "Unavailable in India";
  regionModal.classList.remove("hide");
}
document.getElementById("regionOkBtn").addEventListener("click", () => regionModal.classList.add("hide"));

let vpnBlocked = false;
const vpnModal = document.getElementById("vpnModal");
function showVpnBlocked() {
  vpnBlocked = true;
  nickModal.classList.remove("force");
  nickModal.classList.add("hide");
  vpnModal.classList.remove("hide");
}
document.getElementById("vpnOkBtn").addEventListener("click", () => vpnModal.classList.add("hide"));

tacAgreeBtn.addEventListener("click", () => {
  tacAgreed = true;
  lsSet(tacKey, "1");
  tacModal.classList.add("hide");
  updateGate();
  showNextOnboarding();
});
tacDeclineBtn.addEventListener("click", () => {
  toast("You must accept the terms and conditions to use this chat");
});

const soundKey = "tgSound_" + (window.generatorName || "chat");
let soundOn = lsGet(soundKey) !== "off";
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
  }
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
}
document.addEventListener("pointerdown", ensureAudio, { once: true });
document.addEventListener("keydown", ensureAudio, { once: true });
function playNotify() {
  if (!soundOn || !audioCtx || audioCtx.state !== "running") return;
  const t = audioCtx.currentTime;
  const note = (freq, start, dur, vol) => {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t + start);
    g.gain.exponentialRampToValueAtTime(vol, t + start + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start(t + start);
    o.stop(t + start + dur + 0.05);
  };
  note(880, 0, 0.2, 0.2);
  note(1318.51, 0.1, 0.28, 0.16);
}
function updateSoundItem() {
  const label = soundItem.querySelector(".popLabel");
  if (label) label.textContent = "Sound & notifications: " + (soundOn ? "On" : "Off");
}
updateSoundItem();
const notifyKey = "tgNotify_" + (window.generatorName || "chat");
let notifyOn = lsGet(notifyKey) === "on";
let notifyGranted = null;
async function ensureNotifyPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    if (notifyGranted === null) {
      notifyGranted = Notification.requestPermission ? Notification.requestPermission() : Promise.resolve(Notification.permission);
    }
    const p = await notifyGranted;
    return p === "granted";
  } catch (e) { return false; }
}
soundItem.addEventListener("click", async () => {
  menuPop.classList.add("hide");
  const turnOn = !soundOn;
  if (turnOn) {
    let notifOk = false;
    if (!("Notification" in window)) {
      notifOk = false;
    } else if (Notification.permission === "denied") {
      notifOk = false;
      toast("Notifications are blocked by your browser — sound is on");
    } else {
      notifOk = await ensureNotifyPermission();
      if (!notifOk) toast("Notifications not allowed — sound is on");
    }
    soundOn = true;
    notifyOn = notifOk;
    lsSet(soundKey, "on");
    lsSet(notifyKey, notifyOn ? "on" : "off");
    updateSoundItem();
    ensureAudio();
    playNotify();
    if (notifOk) {
      try { new Notification("Chat Room", { body: "You'll get notifications when this tab isn't focused." }); } catch (e) {}
    }
  } else {
    soundOn = false;
    notifyOn = false;
    lsSet(soundKey, "off");
    lsSet(notifyKey, "off");
    updateSoundItem();
  }
});
function showMessageNotification(m) {
  if (!notifyOn || !document.hidden) return;
  if (m.t !== "chat" && m.t !== "img" && m.t !== "voice") return;
  if (!m.from || isMine(m)) return;
  ensureNotifyPermission().then((ok) => {
    if (!ok) return;
    const body = m.t === "chat" ? String(m.text || "") : m.t === "img" ? (m.caption ? "📷 " + m.caption : "📷 Photo") : m.t === "voice" ? "🎤 Voice message" : "";
    try {
      const n = new Notification(m.from, { body, tag: "chat-notify" });
      n.onclick = () => { window.focus(); n.close(); };
      setTimeout(() => n.close(), 10000);
    } catch (e) {}
  });
}

/* ---------- translate ---------- */
const translateItem = document.getElementById("translateItem");
const translateKey = "tgTrans_";
const langKey = "tgLang_";
let translateOn = lsGet(translateKey) === "on";
let translateLang = lsGet(langKey) || "en";


const LANG_LIST = [
  ["en", "English"], ["es", "Spanish"], ["fr", "French"], ["de", "German"],
  ["pt", "Portuguese"], ["it", "Italian"], ["ru", "Russian"], ["uk", "Ukrainian"],
  ["pl", "Polish"], ["nl", "Dutch"], ["tr", "Turkish"], ["ar", "Arabic"],
  ["hi", "Hindi"], ["bn", "Bengali"], ["ur", "Urdu"], ["zh", "Chinese"],
  ["ja", "Japanese"], ["ko", "Korean"], ["vi", "Vietnamese"], ["th", "Thai"],
  ["id", "Indonesian"], ["ms", "Malay"], ["fil", "Filipino"], ["sw", "Swahili"],
  ["ml", "Malayalam"], ["ta", "Tamil"]
];

function langName(code) {
  const f = LANG_LIST.find((x) => x[0] === code);
  return f ? f[1] : code;
}
function updateTranslateItems() {}
translateItem.addEventListener("click", (e) => {
  e.stopPropagation();
  menuPop.classList.add("hide");
  textSizePop.classList.add("hide");
  openTranslatePop();
});

/* ---------- text size ---------- */
const textSizeItem = document.getElementById("textSizeItem");
const textSizePop = document.getElementById("textSizePop");
const textSizeKey = "tgTextSize_" + (window.generatorName || "chat");
let textSize = lsGet(textSizeKey) || "m";
const TEXT_SIZES = { s: "Small", m: "Medium", l: "Large" };
const SIZE_ORDER = ["s", "m", "l"];
function applyTextSize() {
  const app = document.getElementById("app");
  app.classList.remove("ts-s", "ts-m", "ts-l");
  app.classList.add("ts-" + textSize);
  const tsl = textSizeItem.querySelector(".popLabel");
  if (tsl) tsl.textContent = "Text size: " + (TEXT_SIZES[textSize] || "Medium");
  for (const b of textSizePop.querySelectorAll(".tsizeGrid button")) {
    b.classList.toggle("active", b.dataset.size === textSize);
  }
}
textSizeItem.addEventListener("click", (e) => {
  e.stopPropagation();
  translatePop.classList.add("hide");
  menuPop.classList.add("hide");
  textSizePop.classList.toggle("hide");
});
textSizePop.querySelectorAll(".tsizeGrid button").forEach((b) => {
  b.addEventListener("click", () => {
    textSize = b.dataset.size;
    lsSet(textSizeKey, textSize);
    applyTextSize();
    textSizePop.classList.add("hide");
  });
});
let tszSwipeX = 0, tszSwipeY = 0;
textSizeItem.addEventListener("touchstart", (e) => {
  const t = e.changedTouches[0];
  tszSwipeX = t.clientX;
  tszSwipeY = t.clientY;
}, { passive: true });
textSizeItem.addEventListener("touchend", (e) => {
  const t = e.changedTouches[0];
  const dx = t.clientX - tszSwipeX;
  const dy = t.clientY - tszSwipeY;
  if (Math.abs(dx) > 24 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    let i = SIZE_ORDER.indexOf(textSize);
    i = (i + (dx < 0 ? 1 : -1) + SIZE_ORDER.length) % SIZE_ORDER.length;
    textSize = SIZE_ORDER[i];
    lsSet(textSizeKey, textSize);
    applyTextSize();
    toast("Text size: " + TEXT_SIZES[textSize]);
  }
}, { passive: true });
applyTextSize();

/* ---------- theme (system-first, manual override second) ---------- */
const themeItem = document.getElementById("themeItem");
const themeKey = "tgTheme_" + (window.generatorName || "chat");
const sysDark = window.matchMedia("(prefers-color-scheme: dark)");
let themeOverride = lsGet(themeKey);
function effectiveDark() {
  if (themeOverride === "dark" || themeOverride === "light") return themeOverride === "dark";
  return sysDark.matches;
}
function applyTheme() {
  const dark = effectiveDark();
  document.body.classList.toggle("dark", dark);
  const thl = themeItem.querySelector(".popLabel");
  if (thl) thl.textContent = "Theme: " + (dark ? "Dark" : "Light");
  const tc = document.querySelector('meta[name="theme-color"]');
  if (tc) tc.content = dark ? "#212121" : "#2563eb";
}
themeItem.addEventListener("click", () => {
  menuPop.classList.add("hide");
  const next = !effectiveDark();
  if (next === sysDark.matches) {
    themeOverride = "";
    lsSet(themeKey, "");
  } else {
    themeOverride = next ? "dark" : "light";
    lsSet(themeKey, themeOverride);
  }
  applyTheme();
  toast("Theme: " + (next ? "Dark" : "Light"));
});
sysDark.addEventListener("change", () => {
  if (!themeOverride) applyTheme();
});
applyTheme();

const translateHeaderBtn = document.getElementById("translateHeaderBtn");
const translatePop = document.getElementById("translatePop");
const tpopToggle = document.getElementById("tpopToggle");
const tpopGrid = translatePop.querySelector(".tpopGrid");
function renderTpopToggle() {
  tpopToggle.classList.toggle("on", translateOn);
}
function renderTpopGrid() {
  tpopGrid.textContent = "";
  for (const [code, name] of LANG_LIST) {
    const b = document.createElement("button");
    b.textContent = name;
    if (code === translateLang) b.classList.add("active");
    b.addEventListener("click", () => {
      translateLang = code;
      lsSet(langKey, code);
      renderTpopGrid();
      updateTranslateItems();
      retranslateAll();
    });
    tpopGrid.appendChild(b);
  }
}
function openTranslatePop() {
  renderTpopToggle();
  renderTpopGrid();
  translatePop.classList.toggle("hide");
}
translateHeaderBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  menuPop.classList.add("hide");
  textSizePop.classList.add("hide");
  openTranslatePop();
});
tpopToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  translateOn = !translateOn;
  lsSet(translateKey, translateOn ? "on" : "off");
  renderTpopToggle();
  updateTranslateItems();
  if (translateOn) retranslateAll();
  else restoreAllOriginal();
});

/* ---------- "is this already in my language?" ----------
   A message already in the target language is left alone: no request, no
   toggle. A non-Latin alphabet answers that question on its own (Cyrillic for
   a ru/uk target, Han for zh, ...), but the Latin-script languages share one
   alphabet, so "hola chich" - Spanish, no accents - used to look exactly like
   English and was silently never translated. The English test below therefore
   goes by evidence in the words rather than by the absence of accents:

     1. an English-only word ("the", "you", "don't") -> English, leave it;
     2. a word of a language this app translates (Spanish "hola", French
        "merci", ...) -> not English, translate it;
     3. neither, and it is short plain-Latin text -> leave it (a bare "ok" or
        "lol" isn't worth a request);
     4. neither, and the message is longer -> translate it (with no English
        evidence at all, another language is the likelier reading).

   Only words that are unambiguous *between* these languages go in the lists: a
   word that is both English and foreign evidence ("no", "ok", "cool") proves
   nothing and belongs in neither. English evidence also wins ties (see the
   filter below), so nothing here can stop an English line from being skipped.
   If a message ever slips through untranslated, add its most telling word to
   FOREIGN_RAW and it will translate from then on. */
const EN_RAW = [
  "the","and","you","your","yours","that","this","these","those","there","they","their",
  "them","with","what","when","where","why","how","which","from","but","because","about",
  "would","could","should","going","know","think","thanks","thank","please","sorry",
  "hello","hey","yeah","yep","maybe","sure","something","anything","nothing","everything",
  "someone","somebody","everyone","people","really","always","never","again","only","very",
  "much","many","some","any","here","back","first","last","next","night","today","tomorrow",
  "yesterday","life","help","name","things","girl","boy","woman","money","friend","welcome",
  "morning","afternoon","evening","week","month","year","hour","now","then","before","after",
  "while","until","since","even","just","anyway","though","although","whether","instead",
  "besides","however","myself","yourself","himself","herself","itself","themselves","anyone",
  "anybody","nobody","somewhere","anywhere","nowhere","tonight","look","looks","looking",
  "better","best","pretty","cute","great","funny","crazy","serious","way","honestly",
  "literally","actually","basically","obviously","probably","definitely","right","wrong",
  "true","false","same","different","another","both","most","little","enough","more","less",
  "we","our","ours","gonna","wanna","gotta","kinda","lol","lmao","omg","tbh","idk","btw",
  "ngl","dont","doesnt","didnt","isnt","arent","cant","wont","don't","doesn't","didn't",
  "isn't","aren't","can't","won't","couldn't","shouldn't","wouldn't","i'm","i've","i'll",
  "i'd","you're","you've","you'll","we're","we've","they're","they've","it's","that's",
  "what's","there's","let's","he's","she's","who's","how's","y'all"
];
const FOREIGN_RAW = [
  /* Spanish */
  "hola","gracias","porque","tambien","también","como","cómo","esta","está","estas","estás",
  "estoy","estan","están","bueno","buena","buenos","buenas","dias","días","noches","senor",
  "señor","amigo","amiga","tengo","tienes","tiene","tenemos","quiero","quieres","quiere",
  "puedo","puedes","puede","hacer","hace","donde","dónde","cuando","cuándo","ahora","siempre",
  "nunca","mucho","mucha","muy","nada","todo","todos","bien","con","por","para","pero","mas",
  "más","tú","él","ella","nosotros","ellos","ellas","ustedes","del","al","es","son","era",
  "algo","alguien","nadie","adios","adiós","casa","agua","comida","amor","vida","tiempo",
  "trabajo","dinero","año","que","qué","quien","quién","solamente","tampoco","aunque",
  /* Portuguese */
  "voce","você","obrigado","obrigada","nao","não","muito","muita","tambem","bom","noite",
  "tudo","eu","ele","sou","estou","foi","ser","estar","entre","mais","sem","dia","coisa",
  /* French */
  "bonjour","bonsoir","salut","merci","beaucoup","toujours","jamais","aussi","encore","tres",
  "très","avec","sans","mais","oui","non","pourquoi","comment","quand","il","elle","ils",
  "elles","est","sont","cest","c'est","d'accord","bien","mal","fait","faire","veux","peut",
  "suis","avez","etait","était","etre","être","avoir","mon","ton","mes","tes","ses","notre",
  "votre","leur","je","tu","nous","vous","et","ou","où","deja","déjà","rien","tout","trop",
  /* German */
  "danke","bitte","nicht","auch","immer","nie","wieder","sehr","und","aber","oder","ich","du",
  "wir","sie","dich","mich","schoen","schön","guten","morgen","abend","ist","sind","haben",
  "ein","eine","einen","dem","den","der","die","das","mit","fuer","für","auf","aus","bei",
  "nach","noch","schon","nur","wie","wer","wo","wann","warum","weil","kann","muss","willst",
  "moechte","möchte","geht","hallo","tschuess","tschüss","ja",
  /* Italian */
  "ciao","grazie","perche","perché","anche","sempre","mai","molto","bene","buongiorno",
  "buonasera","quando","sono","sei","siamo","siete","essere","avere","hai","questo","questa",
  "quello","quella","tanto","poco","niente","pero","però","per","ma","il","lo","gli","che",
  "piu","più","dove",
  /* Dutch */
  "dankjewel","alsjeblieft","niet","ook","nooit","weer","heel","maar","ik","jij","wij","zij",
  "waar","waarom","goed","het","een","zijn","heeft","heb","kan","moet","wil","dit","dat",
  "deze","van","voor","naar","bij","uit","om","onder","tussen","geen","nog","toch",
  /* Polish */
  "dziekuje","dziękuję","prosze","proszę","bardzo","zawsze","nigdy","takze","także","tak",
  "jak","gdzie","kiedy","dlaczego","jest","sa","są","mam","masz","chce","chcę","można",
  "dobrze","zle","źle","czesc","cześć","sie","się","przez","dla","bez","ona","oni","wy",
  /* Turkish */
  "tesekkur","teşekkür","merhaba","nasilsin","nasılsın","lutfen","lütfen","cok","çok","bir",
  "icin","için","degil","değil","ben","sen","biz","siz","onlar","bu","su","ne","neden",
  "nasil","nasıl","nerede","var","yok","tamam","iyi","kotu","kötü","evet","hayir","hayır",
  /* Vietnamese */
  "xin","chao","chào","cam","cảm","ơn","khong","không","toi","tôi","ban","bạn","va","và",
  "cua","của","duoc","được","rat","rất","nhieu","nhiều","mot","một","gi","gì","sao","nay",
  "này","vang","vâng","anh","chi","chị","em",
  /* Indonesian / Malay */
  "terima","kasih","tolong","salam","apa","kabar","tidak","saya","kamu","kami","kita",
  "mereka","bagaimana","kenapa","mengapa","dari","dan","atau","tapi","juga","sudah","belum",
  "sangat","banyak","sedikit","bagus","baik","buruk","iya","makan","minum",
  /* Filipino */
  "salamat","kumusta","mahal","ako","ikaw","siya","tayo","kayo","sila","hindi","opo","oo",
  "ano","bakit","paano","saan","kailan","mga","din","rin","lang","naman",
  /* Swahili */
  "asante","habari","jambo","karibu","ndiyo","hapana","kwa","nini","vipi","sana","kama",
  "lakini","mimi","wewe","yeye","sisi","nyinyi","wao"
];
const EN_WORDS = new Set(EN_RAW);
const FOREIGN_WORDS = new Set(FOREIGN_RAW.filter((w) => !EN_WORDS.has(w)));
function wordTokens(text) {
  return String(text).toLowerCase().normalize("NFC").replace(/[’‘`]/g, "'")
    .split(/[^\p{L}\p{N}']+/u).filter(Boolean);
}
function looksEnglish(text) {
  const toks = wordTokens(text);
  let foreign = false;
  for (const t of toks) {
    if (EN_WORDS.has(t)) return true;
    if (FOREIGN_WORDS.has(t)) foreign = true;
  }
  if (foreign) return false;
  // No word evidence either way. Only plain-Latin text is spared a request (a
  // bare "ok" or "lol" isn't worth one); a message in another alphabet - which
  // has no spaces to tokenise, so it always looks "short" here - still goes to
  // the translator, like it always did.
  return toks.length <= 3 && /^[\x00-\x7F\s]*$/.test(String(text));
}

function alreadyInTargetLang(text) {
  if (!translateOn || !text || !String(text).trim()) return false;
  const lang = translateLang;
  if (lang === "ru" || lang === "uk") return /[\u0400-\u04ff]/.test(text);
  if (lang === "zh") return /[\u4e00-\u9fff]/.test(text);
  if (lang === "ja") return /[\u3040-\u30ff]/.test(text);
  if (lang === "ko") return /[\uac00-\ud7af]/.test(text);
  if (lang === "ar") return /[\u0600-\u06ff]/.test(text);
  if (lang === "th") return /[\u0e00-\u0e7f]/.test(text);
  if (lang === "hi") return /[\u0900-\u097f]/.test(text);
  if (lang === "ta") return /[\u0b80-\u0bff]/.test(text);
  if (lang === "ml") return /[\u0d00-\u0d7f]/.test(text);
  if (lang === "he") return /[\u0590-\u05ff]/.test(text);
  if (lang === "en") return looksEnglish(text);
  return false;
}

function translateSystemPrompt() {
  const lang = langName(translateLang);
  return "Translate every message into " + lang + ".\n\n" +
    "You are a highly accurate translator specializing in Ukrainian and Russian, including slang, casual speech, regional expressions, and texting language.\n\n" +
    "Your highest priority is to preserve the ORIGINAL meaning, tone, emotional intensity, and personality of the message.\n\n" +
    "IMPORTANT RULES:\n\n" +
    "1. NEVER underestimate the tone.\n" +
    "   This is a TEXT MESSAGE, not a voice note. Do not assume the speaker is joking, calm, friendly, or less serious simply because there is no vocal tone.\n\n" +
    "2. Preserve the exact emotional intensity.\n" +
    "   If the original sounds angry, annoyed, cold, rude, affectionate, sarcastic, playful, aggressive, or serious, keep that same level in the translation.\n\n" +
    "3. NEVER soften the message.\n" +
    "   Do not turn an angry message into a polite one, a rude message into a friendly one, or a serious message into a casual one.\n\n" +
    "4. NEVER strengthen the message.\n" +
    "   Do not make a message more aggressive, insulting, emotional, threatening, or vulgar than the original.\n\n" +
    "5. BAD WORDS / PROFANITY:\n" +
    "   Only use profanity, swear words, insults, or vulgar language in the translation if they are actually present in the original message.\n\n" +
    "   If the original contains a swear word, preserve its meaning and approximate strength in the target language.\n\n" +
    "   If the original does NOT contain a swear word, DO NOT add one just because a stronger or more natural translation might use it.\n\n" +
    "6. Do not invent emotions, intentions, insults, affection, sarcasm, jokes, or hidden meanings.\n\n" +
    "7. Do not guess what the speaker \"really meant.\"\n" +
    "   Translate what the speaker actually wrote.\n\n" +
    "8. Context may ONLY be used to understand references, unclear words, pronouns, or missing context. Context must NEVER be used as a reason to change the tone or emotional intensity.\n\n" +
    "9. Preserve slang, abbreviations, texting style, punctuation, repetition, emojis, and emphasis whenever they contribute to the tone.\n\n" +
    "10. Do not automatically make informal messages more formal or formal messages more casual.\n\n" +
    "11. If the original is short, keep the translation comparably short. Do not expand it with explanations.\n\n" +
    "12. If a phrase has multiple possible meanings, choose the interpretation closest to the literal meaning and original tone rather than choosing the friendliest interpretation.\n\n" +
    "13. If the original message is already entirely in the target language, return it exactly as written. Do not rewrite, correct, or improve it.\n\n" +
    "14. The translation must sound like the SAME PERSON saying the SAME THING in another language.\n\n" +
    "15. Output ONLY the translation. Never add explanations, interpretations, tone labels, warnings, or commentary.\n\n" +
    "REMEMBER:\n" +
    "You are a translator, NOT a mediator, relationship advisor, censor, or tone improver.\n\n" +
    "Your job is not to make the conversation nicer.\n" +
    "Your job is to accurately communicate what the person wrote.";
}

function getTranslationContext(beforeWrap) {
  const lines = [];
  for (const child of messagesEl.children) {
    if (!child.classList || !child.classList.contains("msg")) continue;
    if (beforeWrap && child === beforeWrap) break;
    const m = msgByWrap.get(child);
    if (!m || m.t !== "chat") continue;
    const text = String(m.text || "").trim();
    if (!text) continue;
    lines.push("[" + (String(m.from || "unknown").trim() || "unknown") + "]: " + text);
  }
  return lines.slice(-5).join("\n");
}

async function translateContextualMessage(targetMessage, contextString) {
  const target = String(targetMessage || "").trim();
  if (!target) return "";
  if (!root.ai) return target;
  try {
    const result = await root.ai({
      instruction: translateSystemPrompt() + "\n\nContext:\n" + contextString + "\n\nTranslate this:\n" + target,
      temperature: 0.4
    });
    const out = String(result && result.text != null ? result.text : result || "").trim();
    return out || target;
  } catch (e) {
    return target;
  }
}

function removeTogFor(el) {
  const bubble = el.closest(".bubble");
  if (bubble) {
    const tog = bubble.querySelector(".transTog");
    if (tog) tog.remove();
    bubble.classList.remove("has-tog");
  }
  // A plain element (no bubble: the admin's monitor cards) has its toggle as a
  // sibling, so it is cleaned up here - otherwise a stale "Translating…" would
  // sit under the text forever.
  const sib = el.nextElementSibling;
  if (sib && sib.classList && sib.classList.contains("transTog")) sib.remove();
}
function setTransResult(el, tog, trans, orig) {
  if (!trans || trans === orig) { removeTogFor(el); return; }
  el.dataset.tOrig = orig;
  el.dataset.tTrans = trans;
  el.innerHTML = linkifyHtml(trans);
  el.classList.add("translated");
  if (tog) { tog.hidden = false; tog.textContent = "Show original"; }
}
function makeTog(el) {
  removeTogFor(el);
  const tog = document.createElement("span");
  tog.className = "transTog";
  tog.hidden = false;
  tog.textContent = "Translating…";
  const bubble = el.closest(".bubble");
  const ts = bubble ? bubble.querySelector(".tsrow") : null;
  if (ts) {
    ts.insertBefore(tog, ts.firstChild);
    bubble.classList.add("has-tog");
  } else el.after(tog);
  tog.addEventListener("click", () => {
    if (el.dataset.tTrans === undefined || el.dataset.tOrig === undefined) return;
    if (tog.textContent === "Show original") {
      el.innerHTML = linkifyHtml(el.dataset.tOrig);
      tog.textContent = "Show translated";
    } else {
      el.innerHTML = linkifyHtml(el.dataset.tTrans);
      tog.textContent = "Show original";
    }
  });
  return tog;
}
function transBubbleOf(msgEl) {
  const m = msgByWrap.get(msgEl);
  if (!m) return null;
  if (m.t === "chat") {
    const el = msgEl.querySelector(".btext");
    if (!el || el.dataset.tOrig !== undefined) return null;
    return (m.text || "").trim() ? el : null;
  }
  if (m.t === "img" && m.caption) {
    const el = msgEl.querySelector(".caption");
    if (!el || el.dataset.tOrig !== undefined) return null;
    return String(m.caption).trim() ? el : null;
  }
  return null;
}
async function translateBubbleOne(el, origText) {
  if (!el || !origText || !origText.trim()) return;
  if (el.dataset.tOrig !== undefined) return;
  if (alreadyInTargetLang(origText)) { removeTogFor(el); return; }
  const tog = makeTog(el);
  el.dataset.tBusy = "1";
  try {
    const ctx = getTranslationContext(el.closest(".msg"));
    const t = await translateContextualMessage(origText, ctx);
    setTransResult(el, tog, t, origText);
  } finally {
    delete el.dataset.tBusy;
  }
}
function batchPrompt(n) {
  return translateSystemPrompt() + "\n\nBATCH MODE: Translate all " + n + " of the messages below in one pass. Output exactly " + n + " numbered lines, one translation per line, in the same order, in this exact format: 1. <translation>, 2. <translation>, etc. Output strictly the " + n + " translated lines and nothing else - no explanations, no headings, no extra text.";
}
function tryParseJsonArray(out) {
  const fenced = out.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  const body = fenced ? fenced[1] : out;
  const m = body.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr : null;
  } catch (e) { return null; }
}
function parseBatchTranslations(out, n) {
  if (!out) return null;
  const json = tryParseJsonArray(out);
  if (json && json.length === n && json.every((s) => typeof s === "string" && s.trim())) {
    return json.map((s) => s.trim());
  }
  const numbered = [...out.matchAll(/^\s*(\d+)[.)]\s*(.*)$/gm)];
  if (numbered.length === n) {
    const nums = numbered.map((m) => parseInt(m[1], 10));
    if (nums.every((v, i) => v === i + 1)) return numbered.map((m) => m[2].trim());
  }
  const plain = out.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (plain.length === n) return plain;
  return null;
}
async function translateContextualBatch(els, msgs) {
  const n = els.length;
  const ctx = getTranslationContext(els[0].closest(".msg"));
  const numbered = els.map((el, i) => {
    const m = msgs[i];
    return (i + 1) + ". " + String(m.text ?? m.caption ?? el.textContent ?? "").trim();
  }).join("\n");
  if (!root.ai) return null;
  try {
    const result = await root.ai({
      instruction: batchPrompt(n) + "\n\nContext:\n" + ctx + "\n\nMessages to translate:\n" + numbered,
      temperature: 0.4
    });
    const out = String(result && result.text != null ? result.text : result || "").trim();
    return parseBatchTranslations(out, n);
  } catch (e) {
    return null;
  }
}
async function translateBatchEls(els) {
  const entries = els
    .map((el) => ({ el, m: msgByWrap.get(el.closest(".msg")) }))
    .filter((x) => x.m && x.el.dataset.tOrig === undefined && x.el.dataset.tBusy === undefined)
    .filter((x) => {
      const orig = String(x.m.text ?? x.m.caption ?? x.el.textContent ?? "").trim();
      if (!orig || isEmojiOnlyText(orig)) { removeTogFor(x.el); return false; }
      if (alreadyInTargetLang(orig)) { removeTogFor(x.el); return false; }
      return true;
    });
  if (!entries.length) return;
  const groups = [];
  let cur = null;
  for (const e of entries) {
    const author = String(e.m.from || "").trim();
    if (!cur || cur.author !== author) {
      cur = { author, list: [e] };
      groups.push(cur);
    } else {
      cur.list.push(e);
    }
  }
  for (const g of groups) {
    for (const e of g.list) e.el.dataset.tBusy = "1";
    const togs = g.list.map((e) => makeTog(e.el));
    try {
      const translations = await translateContextualBatch(g.list.map((e) => e.el), g.list.map((e) => e.m));
      if (translations && translations.length === g.list.length) {
        g.list.forEach((e, i) => {
          const orig = String(e.m.text ?? e.m.caption ?? e.el.textContent ?? "").trim();
          setTransResult(e.el, togs[i], translations[i], orig);
        });
      } else {
        for (let i = 0; i < g.list.length; i++) {
          const e = g.list[i];
          const orig = String(e.m.text ?? e.m.caption ?? e.el.textContent ?? "").trim();
          const t = await translateContextualMessage(orig, getTranslationContext(e.el.closest(".msg")));
          setTransResult(e.el, togs[i], t, orig);
        }
      }
    } finally {
      for (const e of g.list) delete e.el.dataset.tBusy;
    }
  }
}
let translateLock = Promise.resolve();
function withTranslateLock(fn) {
  const p = translateLock.then(() => fn());
  translateLock = p.catch(() => {});
  return p;
}
const rtPending = new Set();
let rtTimer = null;
function scheduleRealtimeTranslation(el) {
  if (!el || el.dataset.tOrig !== undefined || el.dataset.tBusy !== undefined) return;
  const txt = String(el.textContent || "").trim();
  if (!txt || isEmojiOnlyText(txt)) return;
  el.dataset.tBusy = "1";
  makeTog(el);
  rtPending.add(el);
  if (rtTimer) clearTimeout(rtTimer);
  rtTimer = setTimeout(() => { rtTimer = null; flushRealtimeTranslation(); }, 1000);
}
async function flushRealtimeTranslation() {
  const els = [...rtPending];
  rtPending.clear();
  if (rtTimer) { clearTimeout(rtTimer); rtTimer = null; }
  if (!translateOn) {
    for (const el of els) { delete el.dataset.tBusy; removeTogFor(el); }
    return;
  }
  for (const el of els) delete el.dataset.tBusy;
  await withTranslateLock(() => translateBatchEls(els));
}
function elInViewport(el) {
  const c = scrollCtnEl.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return r.bottom > c.top && r.top < c.bottom;
}
/* Every element that can hold translatable text: a message body, a caption, and
   the original shown under a "deleted message" tombstone (`.delOrigText`, which
   only ever exists inside an admin-only box). The tombstone's own "… deleted
   this message" line is chrome, not something anyone said, so `.delnoteText` is
   deliberately left out. Shared by everything below so the three sweeps can
   never drift apart. */
const TRANS_SEL = ".btext:not(.delnoteText), .imgBubble .caption, .delOrigText, .asDmText, .asDelText";
/* What translation touches right now: incoming bubbles. Only what is on screen
   and not already translated or in flight. */
function translationTargets() {
  return [...document.querySelectorAll(TRANS_SEL)]
    .filter((el) => !el.closest(".msg.out") && el.dataset.tOrig === undefined && el.dataset.tBusy === undefined && elInViewport(el));
}
/* The admin's monitor cards carry no `.msg` wrap, so they cannot go through the
   batch path (which reads its message off the wrap). They are translated here,
   in chunks, so a long monitored conversation costs a handful of calls rather
   than one per message. Both participants' messages are translated, because a
   monitor card is never `.msg.out`. */
async function translateLooseEls(els) {
  const entries = els
    .filter((el) => el.dataset.tOrig === undefined && el.dataset.tBusy === undefined)
    .map((el) => ({ el, text: String(el.textContent || "").trim() }))
    .filter((e) => e.text && !isEmojiOnlyText(e.text) && !alreadyInTargetLang(e.text));
  if (!entries.length || !root.ai) return;
  for (const e of entries) { e.tog = makeTog(e.el); e.el.dataset.tBusy = "1"; }
  const CHUNK = 12;
  try {
    for (let i = 0; i < entries.length; i += CHUNK) {
      const chunk = entries.slice(i, i + CHUNK);
      let out = null;
      try {
        const numbered = chunk.map((e, j) => (j + 1) + ". " + e.text).join("\n");
        const result = await root.ai({
          instruction: batchPrompt(chunk.length) + "\n\nMessages to translate:\n" + numbered,
          temperature: 0.4
        });
        const txt = String(result && result.text != null ? result.text : result || "").trim();
        out = parseBatchTranslations(txt, chunk.length);
      } catch (e) {}
      for (let j = 0; j < chunk.length; j++) {
        const e = chunk[j];
        const t = out ? out[j] : await translateContextualMessage(e.text, "");
        setTransResult(e.el, e.tog, t, e.text);
      }
    }
  } finally {
    for (const e of entries) delete e.el.dataset.tBusy;
  }
}

async function translateViewport() {
  if (!translateOn) return;
  await withTranslateLock(async () => {
    const targets = translationTargets();
    if (!targets.length) return;
    const inMsg = targets.filter((el) => el.closest(".msg"));
    const loose = targets.filter((el) => !el.closest(".msg"));
    if (inMsg.length) await translateBatchEls(inMsg);
    if (loose.length) await translateLooseEls(loose);
  });
}
function retranslateAll() {
  for (const b of document.querySelectorAll(TRANS_SEL)) {
    if (b.closest(".msg.out")) continue;
    removeTogFor(b);
    b.classList.remove("translated");
    const orig = b.dataset.tOrig !== undefined ? b.dataset.tOrig : b.textContent;
    delete b.dataset.tOrig;
    delete b.dataset.tTrans;
    delete b.dataset.tBusy;
    b.innerHTML = linkifyHtml(orig);
  }
  if (translateOn) translateViewport();
}
function restoreAllOriginal() {
  for (const b of document.querySelectorAll(TRANS_SEL)) {
    if (b.dataset.tOrig !== undefined) {
      b.innerHTML = linkifyHtml(b.dataset.tOrig);
      b.classList.remove("translated");
      removeTogFor(b);
      delete b.dataset.tOrig;
      delete b.dataset.tTrans;
    }
  }
}
updateTranslateItems();

/* ---------- pinned message (admin + verified) ---------- */
let pinnedMsg = null;
const pinnedBar = document.getElementById("pinnedBar");
const pinFromEl = document.getElementById("pinFrom");
const pinPreviewEl = document.getElementById("pinPreview");
const pinUnpinBtn = document.getElementById("pinUnpinBtn");
function pinPreviewText(p) {
  if (!p) return "";
  if (p.text) return String(p.text).slice(0, 120);
  if (p.url) return "[photo]";
  return "";
}
function renderPinned(p) {
  pinnedMsg = p || null;
  if (!pinnedBar) return;
  if (!p) { pinnedBar.classList.add("hide"); return; }
  pinnedBar.classList.remove("hide");
  if (pinFromEl) pinFromEl.textContent = (p.from || "Pinned message") + (p.by ? " • pinned by " + p.by : "");
  if (pinPreviewEl) pinPreviewEl.textContent = pinPreviewText(p);
  const canUnpin = isAdmin() || verifiedSet.has(myName);
  if (pinUnpinBtn) pinUnpinBtn.style.display = canUnpin ? "" : "none";
}
if (pinnedBar) pinnedBar.addEventListener("click", (e) => {
  if (e.target && e.target.closest && e.target.closest("#pinUnpinBtn")) return;
  if (!pinnedMsg || !pinnedMsg.id) return;
  const n = findMsgDom(String(pinnedMsg.id || ""), pinnedMsg.from || null, pinnedMsg.ts != null ? Number(pinnedMsg.ts) : null);
  if (n) {
    n.scrollIntoView({ behavior: "smooth", block: "center" });
    n.classList.add("flash");
    setTimeout(() => n.classList.remove("flash"), 1200);
  }
});
if (pinUnpinBtn) pinUnpinBtn.addEventListener("click", async (e) => {
  e.stopPropagation();
  try {
    if (socket && socket.rpc && socket.rpc.unpinMessage) await socket.rpc.unpinMessage("");
    else if (socket) socket.send(JSON.stringify({ t: "unpin" }));
  } catch (err) {}
  renderPinned(null);
});
const _pinBtn = document.getElementById("actPinBtn");
if (_pinBtn) _pinBtn.addEventListener("click", async () => {
  const list = [...selItems.values()];
  const m = list.length === 1 ? list[0] : null;
  if (!m) return;
  const payload = { id: m.id || "", from: m.from || "", ts: m.ts != null ? Number(m.ts) : Date.now(), text: String(m.text || m.caption || "").slice(0, 300), url: String(m.url || "") };
  try {
    let r = "ok";
    if (socket && socket.rpc && socket.rpc.pinMessage) r = await socket.rpc.pinMessage(JSON.stringify(payload));
    else if (socket) { socket.send(JSON.stringify({ t: "pin", id: payload.id, from: payload.from, mts: payload.ts, text: payload.text, url: payload.url })); }
    else r = "no socket";
    if (r === "ok") { renderPinned(Object.assign({}, payload, { by: myName, at: Date.now() })); toast("Message pinned"); }
    else toast("Couldn't pin: " + r);
  } catch (err) {}
  endSelection();
});
async function loadPinned() {
  try {
    if (!socket || !socket.rpc || !socket.rpc.getPinned) return;
    const r = await socket.rpc.getPinned("");
    const p = JSON.parse(r || "null");
    renderPinned(p);
  } catch (err) {}
}
async function renderOnlineList() {
  try {
    const r = await socket.rpc.getOnline("");
    let list;
    try { list = JSON.parse(r); } catch (e) { list = null; }
    if (!list || !list.length) {
      onlineTitle.textContent = "0 online";
      onlineBody.textContent = "No one is online";
      return;
    }
    const online = list.filter((u) => u.online !== 0);
    const offline = list.length - online.length;
    onlineTitle.textContent = (online.length === 1 ? "1 online" : online.length + " online") + (offline ? " · " + offline + " offline" : "");
    onlineBody.textContent = "";
    for (const u of list) {
      const name = u.name;
      const row = el("div", "onlineUser");
      const av = el("div", "olAvatar");
      if (name === "admin") av.classList.add("adminAvatar");
      paintAvatar(av, name);
      row.appendChild(av);
      const left = el("div", "olMain");
      const top = el("div", "olTop");
      top.appendChild(el("span", "olName", u.count > 1 && name !== "admin" ? name + " (" + u.count + ")" : name));
      if (name === "admin") top.appendChild(el("span", "olTag", "ADMIN"));
      else if (verifiedSet.has(name)) top.appendChild(verifiedBadgeEl());
      if (u.online === 0) {
        const off = el("span", "olBadge", "offline");
        off.style.background = "#eef1f4";
        off.style.color = "#90a4ae";
        top.appendChild(off);
      }
      left.appendChild(top);
      if (isAdmin() && (u.loc || u.proxy)) left.appendChild(locNetEl(u.loc || "", u.proxy));
      row.appendChild(left);
      // Tapping someone here is a shortcut into a private chat with them.
      row.addEventListener("click", () => {
        onlineModal.classList.add("hide");
        clearInterval(onlineTimer);
        openDm(name);
      });
      onlineBody.appendChild(row);
    }
  } catch (e) {
    onlineBody.textContent = "couldn't load online list";
  }
}

function openOnlineList() {
  onlineTitle.textContent = "Online";
  onlineBody.textContent = "Loading…";
  onlineModal.classList.remove("hide");
  renderOnlineList();
  clearInterval(onlineTimer);
  onlineTimer = setInterval(renderOnlineList, 5000);
}
onlineCloseBtn.addEventListener("click", () => {
  onlineModal.classList.add("hide");
  clearInterval(onlineTimer);
});
let onlineClickable = false;
function ensureOnlineClickable() {
  if (onlineClickable) return;
  onlineClickable = true;
  onlineSub.classList.add("adminOn");
  onlineSub.addEventListener("click", openOnlineList);
}
ensureOnlineClickable();

async function showUserInfo(name) {
  if (!isAdmin()) return;
  onlineTitle.textContent = "Info · " + name;
  onlineBody.textContent = "Loading…";
  onlineModal.classList.remove("hide");
  clearInterval(onlineTimer);
  try {
    const r = await socket.rpc.getNetworks("");
    const list = JSON.parse(r);
    const u = (list || []).find((x) => x.name === name);
    onlineBody.textContent = "";
    if (!u) { onlineBody.appendChild(el("div", "olLegend", "Not connected · use the Online panel for the full list")); return; }
    const row = el("div", "onlineUser");
    const av = el("div", "olAvatar");
    if (name === "admin") av.classList.add("adminAvatar");
    paintAvatar(av, name);
    row.appendChild(av);
    const left = el("div", "olMain");
    left.appendChild(el("div", "olName", name));
    if (u.loc || u.isProxy) left.appendChild(locNetEl(u.loc || "", u.isProxy));
    row.appendChild(left);
    onlineBody.appendChild(row);
  } catch (e) {
    onlineBody.textContent = "couldn't load info";
  }
}

/* ---------- reply / mention ---------- */
let replyToMsg = null;
let pendingImgBlob = null;
let pendingGifUrl = null;
let editingMsg = null;
let editDraftBackup = null;

function replySnippetParts(r) {
  if (r.t === "img") return { label: "Photo", thumb: r.url || null };
  if (r.t === "voice") return { label: "Voice message", thumb: null };
  return { label: String(r.text || "") || "Message", thumb: null };
}

function replyQuoteEl(r, accent) {
  const q = el("div", "replyQuote");
  setAccentVars(q, accent);
  const name = el("div", "rqName");
  name.textContent = r.from || "";
  name.style.color = accent;
  if (r.from === "admin") name.appendChild(adminBadgeEl());
  const txt = el("div", "rqText");
  const p = replySnippetParts(r);
  if (p.thumb) {
    const t = document.createElement("img");
    t.src = p.thumb;
    t.className = "rqImg";
    t.alt = "";
    t.loading = "lazy";
    txt.appendChild(t);
    txt.appendChild(document.createTextNode(p.label));
  } else {
    txt.innerHTML = linkifyHtml(p.label);
  }
  q.appendChild(name);
  q.appendChild(txt);
  q.addEventListener("click", (e) => { e.stopPropagation(); scrollToMsgId(r.id); });
  return q;
}

function setReplyTo(m) {
  if (editingMsg) cancelEdit();
  replyToMsg = {
    id: String(m.id || ""),
    from: String(m.from || ""),
    t: m.t || "chat",
    text: m.t === "chat" ? String(m.text || "") : "",
    url: m.url || "",
    dur: m.dur || 0,
    size: m.size || 0,
  };
  replyKvNote(replyToMsg);
  replyNameEl.textContent = replyToMsg.from;
  const rqAccent = nameColor(replyToMsg.from);
  replyNameEl.style.color = rqAccent;
  setAccentVars(replyQuoteBox, rqAccent);
  if (replyToMsg.from === "admin") replyNameEl.appendChild(adminBadgeEl());
  const p = replySnippetParts(replyToMsg);
  replySnippetEl.textContent = p.label;
  composeBar.classList.add("bar-open");
  replyBar.classList.remove("hide");
  msgInput.focus();
}

function clearReply() {
  replyToMsg = null;
  replyBar.classList.add("hide");
  composeBar.classList.remove("bar-open");
}

/* ---------- edit message ---------- */
function startEdit(m) {
  clearReply();
  editDraftBackup = msgInput.textContent;
  editingMsg = m;
  editSnippet.textContent = m.t === "img" ? (m.caption || "Photo") : (m.text || "");
  composeBar.classList.add("bar-open");
  editBar.classList.remove("hide");
  msgInput.textContent = m.t === "img" ? (m.caption || "") : (m.text || "");
  sendBtn.innerHTML = SAVE_SVG;
  updateSendBtn();
  msgInput.focus();
}

function cancelEdit() {
  editingMsg = null;
  editBar.classList.add("hide");
  composeBar.classList.remove("bar-open");
  msgInput.textContent = editDraftBackup || "";
  editDraftBackup = null;
  sendBtn.innerHTML = SEND_BTN_HTML;
  updateSendBtn();
}


editCloseBtn.addEventListener("click", cancelEdit);

function scrollToMsgId(id) {
  if (!id) return;
  let target = null;
  for (const n of messagesEl.children) {
    if (n.dataset && n.dataset.id === id) { target = n; break; }
  }
  if (!target) return;
  target.scrollIntoView({ block: "center", behavior: "smooth" });
  target.classList.add("flash");
  setTimeout(() => target.classList.remove("flash"), 1300);
}

function wireReply(wrap, bubble, m) {
  if (convo.mode === "monitor") return;   // no swipe-to-reply in the admin's monitor
  let startX = 0, startY = 0, swiping = false, claimed = false, dx = 0;
  wrap.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    swiping = true;
    claimed = false;
    dx = 0;
  }, { passive: true });
  wrap.addEventListener("touchmove", (e) => {
    if (!swiping) return;
    dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (!claimed) {
      if (dx > 12 && Math.abs(dx) > Math.abs(dy) * 1.2) claimed = true;
      else return;
    }
    e.preventDefault();
    wrap.style.transition = "none";
    wrap.style.transform = "translateX(" + Math.min(dx, 60) + "px)";
  }, { passive: false });
  wrap.addEventListener("touchend", () => {
    swiping = false;
    wrap.style.transition = "transform 0.18s ease-out";
    if (claimed && dx >= 52) setReplyTo(m);
    wrap.style.transform = "";
  });
  wrap.addEventListener("touchcancel", () => {
    swiping = false;
    wrap.style.transition = "transform 0.18s ease-out";
    wrap.style.transform = "";
  });
}

replyCloseBtn.addEventListener("click", clearReply);
replyQuoteBox.addEventListener("click", () => scrollToMsgId(replyToMsg && replyToMsg.id));

function addUploadPlaceholder(kind, payload) {
  const wrap = el("div", "msg out");
  const bubble = el("div", "bubble uploadBubble");
  if (kind === "img") {
    const box = el("div", "uploadImgBox");
    box.appendChild(el("div", "spinner"));
    bubble.appendChild(box);
  } else if (kind === "voice") {
    const row = el("div", "uploadVoiceRow");
    const circle = el("div", "upPlaceholderCircle");
    circle.appendChild(el("div", "spinner"));
    const bars = el("div", "upBars");
    for (let i = 0; i < 18; i++) {
      const b = document.createElement("span");
      b.style.height = (6 + ((i * 53) % 16)) + "px";
      b.style.animationDelay = (i % 6) * 0.1 + "s";
      bars.appendChild(b);
    }
    row.appendChild(circle);
    row.appendChild(bars);
    bubble.appendChild(row);
  } else {
    const opts = payload || {};
    if (opts.replyTo) bubble.appendChild(replyQuoteEl(opts.replyTo, nameColor(opts.replyTo.from)));
    const text = el("div", "btext");
    text.textContent = opts.text || "";
    bubble.appendChild(text);
  }
  const up = el("div", "upText");
  const spinner = el("div", "miniSpinner");
  up.appendChild(spinner);
  up.appendChild(document.createTextNode(kind === "text" ? "Sending…" : "Uploading…"));
  bubble.appendChild(up);
  wrap.appendChild(bubble);
  stripEmptyHint(messagesEl);
  messagesEl.appendChild(wrap);
  scrollBottom();
  const ph = { wrap, done: false };
  uploadPlaceholders.push(ph);
  if (kind === "text") {
    setTimeout(() => removeUploadPlaceholder(ph), 8000);
  }
  return ph;
}

function removeUploadPlaceholder(ph) {
  if (!ph || ph.done) return;
  ph.done = true;
  const i = uploadPlaceholders.indexOf(ph);
  if (i !== -1) uploadPlaceholders.splice(i, 1);
  ph.wrap.remove();
}

async function downloadImage(url, name) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const ext = (blob.type || "").split("/")[1] || "jpg";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "chat-image-" + name + "." + ext;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (e) {
    window.open(url, "_blank", "noopener");
  }
}



function refreshBanUI(name) {
  const banned = bannedNames.has(name);
  for (const host of msgContainers()) {
    for (const wrap of [...host.children]) {
      if (!wrap.classList.contains("msg") || wrap.dataset.from !== name) continue;
      const bubble = wrap.querySelector(".bubble");
      if (!bubble) continue;
      const sn = bubble.querySelector(".senderName");
      const chip = bubble.querySelector(".bannedChip");
      if (banned) {
        if (sn && !chip) sn.appendChild(el("span", "bannedChip", "banned"));
      } else if (chip) {
        chip.remove();
      }
    }
  }
}

function addAdminActionButtons() {
  titleEditBtn.classList.remove("hide");
  iconBtn.classList.remove("hide");
  ensureOnlineClickable();
  adminItem.classList.remove("hide");
  loadFakeUsers();
  // In a private chat the header buttons stay hidden, but the admin's own
  // reveal of them must not add more than the header shows anyway.
  applyHeader();
  for (const host of msgContainers()) {
    for (const wrap of [...host.children]) {
      if (!wrap.classList.contains("msg")) continue;
      const bubble = wrap.querySelector(".bubble");
      if (!bubble) continue;
      if (wrap.dataset.flagged === "1") bubble.classList.add("flagged");
    }
  }
}

const adminSide = document.getElementById("adminSide");
const adminItem = document.getElementById("adminItem");
const asCloseBtn = document.getElementById("asCloseBtn");
function openAdminPanel() {
  adminSide.classList.remove("hide");
  if (!asName.value.trim()) asName.value = myName;
  loadFakeUsers();
  loadDeletedMessages();
  loadAdminDmThreads();
}
adminItem.addEventListener("click", () => {
  menuPop.classList.add("hide");
  openAdminPanel();
});
asCloseBtn.addEventListener("click", () => adminSide.classList.add("hide"));

adminSide.addEventListener("click", (e) => { if (e.target === adminSide) adminSide.classList.add("hide"); });

/* ---------- admin: deleted-message archive ----------
   The server keeps a copy of every deleted message (see the DEL region) and
   hands the list to the admin alone. A user who unsends their own message
   leaves no note in the room, so this panel is the only place its content can
   still be read. */
const asDelList = document.getElementById("asDelList");
const asDelRefreshBtn = document.getElementById("asDelRefreshBtn");
const asDelClearBtn = document.getElementById("asDelClearBtn");
let asDelBackfilled = false;
let asDelClearArmed = false;
let asDelClearTimer = null;

function delRecKind(rec) {
  return rec.t === "img" ? "photo" : rec.t === "voice" ? "voice message" : "message";
}
function buildDeletedRow(rec) {
  const row = el("div", "asDelItem");
  const head = el("div", "asDelHead");
  head.appendChild(el("span", "asDelWho", rec.from || "unknown"));
  head.appendChild(el("span", "asDelKind", delRecKind(rec)));
  head.appendChild(el("span", "asDelWhen", fmtTimeShort(rec.ts || rec.at)));
  row.appendChild(head);
  const by = el("div", "asDelBy");
  by.textContent = rec.self
    ? (rec.from || "unknown") + " deleted their own " + delRecKind(rec)
    : (rec.by || "a moderator") + " deleted this " + delRecKind(rec);
  row.appendChild(by);
  const body = el("div", "asDelBody");
  if (rec.t === "img" && rec.url) {
    const im = el("img", "asDelImg");
    im.src = rec.url; im.loading = "lazy"; im.alt = "";
    body.appendChild(im);
    if (rec.caption) body.appendChild(el("div", "asDelText", rec.caption));
  } else if (rec.t === "voice" && rec.url) {
    const au = el("audio", "asDelAudio");
    au.src = rec.url; au.controls = true; au.preload = "none";
    body.appendChild(au);
  } else if (rec.text) {
    body.appendChild(el("div", "asDelText", rec.text));
  } else {
    body.appendChild(el("div", "asDelText asDelMissing", "(content unavailable)"));
  }
  row.appendChild(body);
  return row;
}
// Deletions older than this feature are recoverable: the moderator path has
// always left a `delnote` row in the history store carrying the original
// message, so hand those to the server archive once per session.
async function importOldDeleted() {
  if (asDelBackfilled) return;
  asDelBackfilled = true;
  let rows = [];
  try {
    rows = await sbFetchRows(SB_URL + "/rest/v1/messages?select=ts,sender,type,text,url,dur,size&type=eq.delnote&order=ts.desc&limit=200");
  } catch (e) { return; }
  const out = [];
  for (const row of rows) {
    const raw = row && row.text ? String(row.text) : "";
    if (raw.indexOf("__deln__") !== 0) continue;
    let p = null;
    try { p = JSON.parse(raw.slice(8)); } catch (e) { continue; }
    const orig = (p && typeof p === "object" && ("o" in p || "b" in p)) ? (p.o || {}) : (p || {});
    const rec = {
      ts: Number(row.ts) || 0,
      from: row.sender,
      t: (orig && orig.t) || "chat",
      text: (orig && orig.text) || "",
      url: (orig && orig.url) || "",
      caption: (orig && orig.caption) || "",
      dur: (orig && orig.dur) || 0,
      size: (orig && orig.size) || 0
    };
    if (p && typeof p === "object" && p.b) rec.by = String(p.b);
    out.push(rec);
  }
  if (!out.length) return;
  try { await socket.rpc.importDeleted(JSON.stringify(out)); } catch (e) {}
}
async function loadDeletedMessages() {
  if (!asDelList) return;
  if (!isAdmin()) return;
  if (!socket || socket.readyState !== 1) {
    asDelList.textContent = "";
    asDelList.appendChild(el("div", "asHint", "Not connected."));
    return;
  }
  await importOldDeleted();
  let arr = [];
  try { arr = JSON.parse(await socket.rpc.getDeleted("")); } catch (e) { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  asDelList.textContent = "";
  if (!arr.length) {
    asDelList.appendChild(el("div", "asHint", "No deleted messages recorded yet."));
    return;
  }
  const shown = arr.slice(0, 150);
  asDelList.appendChild(el("div", "asHint", arr.length + (arr.length === 1 ? " deleted message" : " deleted messages") + " — newest first." + (shown.length < arr.length ? " Showing the newest " + shown.length + "." : "")));
  for (const rec of shown) asDelList.appendChild(buildDeletedRow(rec));
}
asDelRefreshBtn.addEventListener("click", () => loadDeletedMessages());
// Two taps rather than a native confirm(), which would block the whole app on
// some mobile browsers.
asDelClearBtn.addEventListener("click", async () => {
  if (!isAdmin() || !socket || socket.readyState !== 1) { toast("Not connected"); return; }
  if (!asDelClearArmed) {
    asDelClearArmed = true;
    asDelClearBtn.textContent = "Tap again to erase";
    clearTimeout(asDelClearTimer);
    asDelClearTimer = setTimeout(() => { asDelClearArmed = false; asDelClearBtn.textContent = "Clear archive"; }, 4000);
    return;
  }
  asDelClearArmed = false;
  clearTimeout(asDelClearTimer);
  asDelClearBtn.textContent = "Clear archive";
  try { await socket.rpc.clearDeleted(""); toast("Deleted-message archive erased"); } catch (e) {}
  loadDeletedMessages();
});

/* ---------- admin: private-chat moderation ----------
   Private chats are normally invisible to everyone but the two participants;
   this panel is the single exception, so the admin can read a conversation and
   act on it - remove one message, remove the whole conversation, or ban a
   participant. The server side is gated on the admin connection alone
   (adminDmThreads / adminDm / adminDmDeleteMsg / adminDmDeleteAll), never on
   `mayDm`, because the admin is not a participant in the thread.
   The server's copy of a thread is capped at DM_MSGS_MAX, so the panel merges
   in the Supabase scrollback for the rest of the history - and mirrors every
   removal there itself. That mirror step is essential: the server cannot reach
   Supabase, and a row left behind would be merged straight back the next time
   one of the pair reopened the conversation. */
const asDmList = document.getElementById("asDmList");
const asDmThreadCtn = document.getElementById("asDmThread");
const asDmRefreshBtn = document.getElementById("asDmRefreshBtn");
let asDmPair = null;

async function sbAdminDmDeleteRow(a, b, ts) {
  try {
    const key = await dmThreadKey(a, b);
    await fetch(SB_URL + "/rest/v1/messages?type=eq." + key + "&ts=eq." + Number(ts), { method: "DELETE", headers: SB_H });
  } catch (e) {}
}
async function sbAdminDmDeleteThread(a, b) {
  try {
    const key = await dmThreadKey(a, b);
    await fetch(SB_URL + "/rest/v1/messages?type=eq." + key, { method: "DELETE", headers: SB_H });
  } catch (e) {}
}

// Two taps for anything that can't be undone (the same pattern as the archive's
// clear button - a native confirm() would block the whole app on mobile).
function asDmArm(btn, label, fn) {
  let armed = false;
  let timer = null;
  btn.addEventListener("click", () => {
    if (!armed) {
      armed = true;
      btn.textContent = "Tap again to confirm";
      timer = setTimeout(() => { armed = false; btn.textContent = label; }, 4000);
      return;
    }
    armed = false;
    clearTimeout(timer);
    btn.textContent = label;
    fn();
  });
}

function renderAdminDmList(arr) {
  asDmList.textContent = "";
  if (!arr.length) {
    asDmList.appendChild(el("div", "asHint", "No private conversations yet."));
    return;
  }
  for (const t of arr) {
    const row = el("div", "asDmThreadItem");
    row.appendChild(el("div", "asDmPair", t.a + "  ·  " + t.b));
    if (t.preview) row.appendChild(el("div", "asDmPrev", (t.from ? t.from + ": " : "") + t.preview));
    row.appendChild(el("div", "asDmMeta", t.count + (t.count === 1 ? " message" : " messages") + " stored  ·  " + fmtTimeShort(t.ts)));
    row.addEventListener("click", () => openAdminDm(t));
    asDmList.appendChild(row);
  }
}

async function loadAdminDmThreads() {
  if (!asDmList || !isAdmin()) return;
  if (!socket || socket.readyState !== 1) {
    asDmList.textContent = "";
    asDmList.appendChild(el("div", "asHint", "Not connected."));
    return;
  }
  let arr = [];
  try { arr = JSON.parse(await socket.rpc.adminDmThreads("")); } catch (e) { arr = []; }
  renderAdminDmList(Array.isArray(arr) ? arr : []);
}

function adminDmContent(m) {
  const body = el("div", "asDmMsgBody");
  if (m.t === "img" && m.url) {
    const im = el("img", "asDelImg");
    im.src = m.url; im.loading = "lazy"; im.alt = "";
    body.appendChild(im);
    if (m.caption) body.appendChild(el("div", "asDelText", m.caption));
  } else if (m.t === "voice" && m.url) {
    const au = el("audio", "asDelAudio");
    au.src = m.url; au.controls = true; au.preload = "none";
    body.appendChild(au);
  } else {
    body.classList.add("asDmText");
    body.textContent = m.text || "(empty)";
  }
  return body;
}

function buildAdminDmMsg(m, pair, rerender) {
  const row = el("div", "asDmMsg");
  const head = el("div", "asDmMsgHead");
  head.appendChild(el("span", "asDmWho", m.from || "unknown"));
  head.appendChild(el("span", "asDmWhen", fmtTimeShort(m.ts)));
  const del = el("button", "", "Delete");
  del.title = "Delete this message for both participants";
  asDmArm(del, "Delete", () => adminDeleteDmMsg(pair, m, rerender));
  head.appendChild(del);
  row.appendChild(head);
  row.appendChild(adminDmContent(m));
  return row;
}

async function openAdminDm(t) {
  if (!isAdmin() || !socket || socket.readyState !== 1) return;
  asDmPair = { a: t.a, b: t.b };
  const pair = asDmPair;
  const rerender = () => { if (asDmPair && asDmPair.a === pair.a && asDmPair.b === pair.b) openAdminDm(pair); };
  asDmThreadCtn.textContent = "";
  asDmThreadCtn.appendChild(el("div", "asHint", "Loading conversation…"));
  asDmThreadCtn.classList.remove("hide");
  let msgs = [];
  try {
    const data = JSON.parse(await socket.rpc.adminDm(JSON.stringify({ a: t.a, b: t.b })));
    if (data && Array.isArray(data.msgs)) msgs = data.msgs.slice();
  } catch (e) {}
  if (SB_DM_ON) {
    try {
      const extra = await sbDmFetchMsgs(t.b, t.a);
      const seen = new Set(msgs.map((m) => Number(m.ts) || 0));
      for (const m of extra) if (!seen.has(Number(m.ts) || 0)) msgs.push(m);
    } catch (e) {}
  }
  if (asDmPair.a !== t.a || asDmPair.b !== t.b) return;
  msgs.sort((x, y) => (Number(x.ts) || 0) - (Number(y.ts) || 0));

  asDmThreadCtn.textContent = "";
  const head = el("div", "asDmThreadHead");
  head.appendChild(el("div", "asDmPair", t.a + "  ·  " + t.b));
  const closeB = el("button", "", "Close");
  closeB.addEventListener("click", () => {
    asDmThreadCtn.classList.add("hide");
    asDmThreadCtn.textContent = "";
    asDmPair = null;
  });
  head.appendChild(closeB);
  asDmThreadCtn.appendChild(head);

  const acts = el("div", "asDmActs");
  const delConv = el("button", "dangerBtn", "Delete conversation");
  asDmArm(delConv, "Delete conversation", () => adminDeleteDmThread(pair, () => {
    asDmThreadCtn.classList.add("hide");
    asDmThreadCtn.textContent = "";
    asDmPair = null;
  }));
  acts.appendChild(delConv);
  for (const who of [t.a, t.b]) {
    const banB = el("button", "dangerBtn", "Ban " + who);
    banB.title = "Ban " + who + " from the room";
    banB.addEventListener("click", () => adminDmBan(who));
    acts.appendChild(banB);
  }
  asDmThreadCtn.appendChild(acts);

  const list = el("div", "asDmMsgs");
  if (!msgs.length) list.appendChild(el("div", "asHint", "No stored messages in this conversation."));
  for (const m of msgs) list.appendChild(buildAdminDmMsg(m, pair, rerender));
  asDmThreadCtn.appendChild(list);
  asDmThreadCtn.appendChild(el("div", "asHint", msgs.length + (msgs.length === 1 ? " message" : " messages") + " - the server's copy merged with the scrollback store."));
}

// `pair` is an {a, b} target (the admin panel and the chat-list monitor screen
// both pass their own), so one removal path serves both views. `rerender` is the
// view's own redraw, called once the server and the mirror have been updated.
async function adminDeleteDmMsg(pair, m, rerender) {
  if (!pair || !isAdmin()) return;
  const { a, b } = pair;
  const sid = String(m.id || "");
  if (sid && sid.indexOf("sb-") !== 0) {
    try { await socket.rpc.adminDmDeleteMsg(JSON.stringify({ a, b, id: sid })); } catch (e) {}
  }
  await sbAdminDmDeleteRow(a, b, m.ts);
  toast("Message deleted for both participants");
  if (rerender) rerender();
  loadAdminDmThreads();
}

async function adminDeleteDmThread(pair, onDone) {
  if (!pair || !isAdmin()) return;
  const { a, b } = pair;
  try { await socket.rpc.adminDmDeleteAll(JSON.stringify({ a, b })); } catch (e) {}
  await sbAdminDmDeleteThread(a, b);
  toast("Conversation deleted for both participants");
  if (onDone) onDone();
  loadAdminDmThreads();
  refreshAdminDmThreads().then(refreshListView);
}

async function adminDmBan(name) {
  if (!isAdmin() || !socket || socket.readyState !== 1) return;
  try {
    const r = await socket.rpc.banUser(JSON.stringify({ name }));
    toast(r === "ok" ? name + " banned" : String(r || "Failed to ban"));
  } catch (e) {}
}

/* ---------- admin: private chats in the chat list ----------
   The same moderation the admin panel offers, surfaced in the chat list itself.
   `renderPeopleList` grows an admin-only "All private chats" section built from
   `adminDmThreads`, the eye icon on a person's row switches the list into that
   person's own conversations (view as), and tapping any of those rows opens this
   read-only monitor screen instead of a normal private chat - the admin is not a
   participant, so there is no composer, no read receipts and no typing traffic.
   Reads merge the Supabase scrollback exactly like the panel does, removals go
   through the same shared helpers, and translation covers both sides of the
   conversation (the monitor cards carry no `.msg.out`, so nothing is skipped). */

async function refreshAdminDmThreads() {
  if (!isAdmin() || !socket || socket.readyState !== 1) { adminDmThreads = []; return; }
  try {
    const arr = JSON.parse(await socket.rpc.adminDmThreads(""));
    adminDmThreads = Array.isArray(arr) ? arr : [];
  } catch (e) { adminDmThreads = []; }
}

// "View as <name>": show that person's private conversations in the chat list,
// as if their account were signed in here (read-only). Complements the eye icon
// on a row, and the per-participant eye buttons in the monitor bar.
function openViewAs(name) {
  return; // disabled per privacy terms: admins can no longer view-as users
  if (!isAdmin() || !name || name === myName) return;
  viewAs = String(name);
  toast("Viewing as " + viewAs);
  if (!isDesk()) openPeople();
  else { renderPeopleList(); refreshAdminDmThreads().then(refreshListView); }
}
function exitViewAs() {
  viewAs = "";
  refreshListView();
}

// The list a "view as" session shows: a banner to leave it, then every private
// conversation that person takes part in.
function renderViewAsList() {
  const who = viewAs;
  const bar = el("div", "viewAsRow");

  bar.appendChild(el("span", "viewAsLabel", "Viewing as " + who));
  const exit = el("button", "viewAsExit", "Exit");
  exit.type = "button";
  exit.addEventListener("click", (e) => { e.stopPropagation(); exitViewAs(); });
  bar.appendChild(exit);
  peopleListEl.appendChild(bar);
  const threads = adminDmThreads.filter((t) => t && (t.a === who || t.b === who));
  peopleListEl.appendChild(el("div", "pSection", "Private chats"));
  if (!threads.length) {
    peopleListEl.appendChild(el("div", "pEmpty", who + " has no private conversations yet."));
    return;
  }
  for (const t of threads) peopleListEl.appendChild(adminThreadRow(t));
}

function monitorNameWithEye(who) {
  const wrap = el("span", "monitorName");
  wrap.appendChild(el("span", null, who));
  return wrap;
}

function buildMonitorBar() {
  const pair = monitorPair;
  monitorBarEl.textContent = "";
  if (!pair) return;
  const title = el("div", "monitorTitle");
  // An eye beside each participant's name: tap it to drop into that person's
  // own list of private chats.
  title.appendChild(monitorNameWithEye(pair.a));
  title.appendChild(el("span", "monitorDot", "\u00b7"));
  title.appendChild(monitorNameWithEye(pair.b));
  monitorBarEl.appendChild(title);
  const acts = el("div", "asDmActs");
  const refreshB = el("button", "", "Refresh");
  refreshB.addEventListener("click", () => renderMonitorThread());
  acts.appendChild(refreshB);
  const delConv = el("button", "dangerBtn", "Delete conversation");
  asDmArm(delConv, "Delete conversation", () => adminDeleteDmThread(pair, closeMonitor));
  acts.appendChild(delConv);
  for (const who of [pair.a, pair.b]) {
    const banB = el("button", "dangerBtn", "Ban " + who);
    banB.title = "Ban " + who + " from the room";
    banB.addEventListener("click", () => adminDmBan(who));
    acts.appendChild(banB);
  }
  monitorBarEl.appendChild(acts);
  const n = monitorMsgs.length;
  monitorBarEl.appendChild(el("div", "asHint",
    "Read-only \u00b7 " + (n ? n + (n === 1 ? " message" : " messages") : "no stored messages") +
    " \u00b7 deleting removes a message (or the whole conversation) for both participants."));
}

async function renderMonitorThread() {
  if (convo.mode !== "monitor" || !monitorPair) return;
  const pair = monitorPair;
  monitorBarEl.textContent = "";
  monitorBarEl.appendChild(el("div", "asHint", "Loading conversation\u2026"));
  monitorMessagesEl.textContent = "";
  monitorMessagesEl.appendChild(el("div", "pEmpty", "Loading\u2026"));
  let msgs = [];
  try {
    const data = JSON.parse(await socket.rpc.adminDm(JSON.stringify({ a: pair.a, b: pair.b })));
    if (data && Array.isArray(data.msgs)) msgs = data.msgs.slice();
  } catch (e) {}
  if (SB_DM_ON) {
    try {
      const extra = await sbDmFetchMsgs(pair.b, pair.a);
      const seen = new Set(msgs.map((m) => Number(m.ts) || 0));
      for (const m of extra) if (!seen.has(Number(m.ts) || 0)) msgs.push(m);
    } catch (e) {}
  }
  if (convo.mode !== "monitor" || !monitorPair || monitorPair.a !== pair.a || monitorPair.b !== pair.b) return;
  msgs.sort((x, y) => (Number(x.ts) || 0) - (Number(y.ts) || 0));
  monitorMsgs = msgs;
  // A normal chat interface: the exact renderer the room and a private chat use,
  // so the admin reads bubbles, names, avatars, replies, reactions, photos and
  // voice notes just like everyone else. The container carries no `data-peer`,
  // so every message renders as incoming (never as "mine").
  msgByWrapCleanup(monitorMessagesEl);
  monitorMessagesEl.textContent = "";
  withMsgHost(monitorMessagesEl, () => {
    for (const m of msgs) if (m && m.t) addMessageDom(m);
  });
  if (!msgs.length) monitorMessagesEl.appendChild(el("div", "pEmpty", "No messages in this conversation."));
  updateBubbleTails();
  scheduleDaySeps();
  addMonitorDeleteButtons();
  buildMonitorBar();
  if (scrollCtnEl === monitorScrollEl) monitorScrollEl.scrollTop = monitorScrollEl.scrollHeight;
  // Every bubble is incoming here, so translation covers both participants.
  if (translateOn) translateViewport();
}

// A small moderator delete on each monitored bubble - the admin's only
// per-message action. It arms on the first tap (the same two-tap safety the
// panel and the archive use) so a stray tap cannot remove someone's message.
function monArm(btn, onConfirm) {
  let armed = false;
  let timer = null;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!armed) {
      armed = true;
      btn.classList.add("armed");
      timer = setTimeout(() => { armed = false; btn.classList.remove("armed"); }, 4000);
      return;
    }
    armed = false;
    clearTimeout(timer);
    btn.classList.remove("armed");
    onConfirm();
  });
}
function addMonitorDeleteButtons() {
  const pair = monitorPair;
  if (!pair) return;
  for (const wrap of [...monitorMessagesEl.querySelectorAll(".msg")]) {
    const m = msgByWrap.get(wrap);
    if (!m || !m.t) continue;
    const row = wrap.querySelector(".tsrow") || wrap.querySelector(".bubble");
    if (!row || row.querySelector(".monDeleteBtn")) continue;
    const btn = el("button", "monDeleteBtn");
    btn.type = "button";
    btn.title = "Delete this message for both participants";
    btn.setAttribute("aria-label", btn.title);
    btn.innerHTML = DEL_SVG;
    monArm(btn, () => adminDeleteDmMsg(pair, m, () => renderMonitorThread()));
    row.appendChild(btn);
  }
}

async function openMonitorThread(t) {
  if (!isAdmin() || !socket || socket.readyState !== 1) return;
  if (!t || !t.a || !t.b) return;
  if (selectionMode) endSelection();
  leaveDm();
  peopleOpen = false;
  clearInterval(peopleTimer);
  monitorPair = { a: t.a, b: t.b };
  monitorMsgs = [];
  convo = { mode: "monitor", peer: "" };
  messagesEl = monitorMessagesEl;
  scrollCtnEl = monitorScrollEl;
  setPeopleScreenVisible(false);
  roomScrollCtn.classList.add("hide");
  dmScrollEl.classList.add("hide");
  monitorScreen.classList.remove("hide");
  composeBar.classList.add("hide");
  retargetTailObserver();
  applyHeader();
  renderMonitorThread();
}

// Back to the list (phone) or to the room pane (desktop). The monitor is not a
// place the admin stays in, and nothing about it outlives leaving it.
function closeMonitor() {
  if (convo.mode !== "monitor") return;
  monitorPair = null;
  monitorMsgs = [];
  if (isDesk()) showRoom(); else openPeople();
}

asDmRefreshBtn.addEventListener("click", () => {
  loadAdminDmThreads();
  if (asDmPair) openAdminDm(asDmPair);
});

const asName = document.getElementById("asName");
function sendFakeSys(suffix) {
  if (!socket || socket.readyState !== 1) { toast("Not connected yet"); return; }
  const name = (asName.value || "").trim().slice(0, 20) || myName;
  socket.send(JSON.stringify({ t: "sysmsg", text: name + suffix, presence: suffix.trim() === "joined" ? "join" : "left", ts: Date.now() }));
}
document.getElementById("asJoinBtn").addEventListener("click", () => sendFakeSys(" joined"));
document.getElementById("asLeftBtn").addEventListener("click", () => sendFakeSys(" left"));

/* ---------- fake user test ---------- */
const asFakeName = document.getElementById("asFakeName");
const asFakeCreateBtn = document.getElementById("asFakeCreateBtn");
const asFakeList = document.getElementById("asFakeList");
const asFakeSendRow = document.getElementById("asFakeSendRow");
const asFakeMsg = document.getElementById("asFakeMsg");
const asFakeSendBtn = document.getElementById("asFakeSendBtn");
const fakeUsers = new Set();
let selectedFake = null;

function refreshFakeList() {
  asFakeList.innerHTML = "";
  if (!fakeUsers.size) {
    const e = document.createElement("div");
    e.className = "asEmpty";
    e.textContent = "No fake users yet";
    asFakeList.appendChild(e);
    asFakeSendRow.classList.add("hide");
    return;
  }
  for (const n of [...fakeUsers].sort()) {
    const row = document.createElement("div");
    row.className = "asFakeItem" + (n === selectedFake ? " active" : "");
    const lbl = document.createElement("span");
    lbl.textContent = n;
    row.appendChild(lbl);
    const btns = document.createElement("span");
    btns.className = "asFakeItemBtns";
    const sendB = document.createElement("button");
    sendB.className = "asFakeSendMini";
    sendB.textContent = "Send as";
    sendB.title = "Send a message as " + n;
    sendB.addEventListener("click", (e) => { e.stopPropagation(); selectFake(n); asFakeMsg.focus(); });
    const delB = document.createElement("button");
    delB.className = "asFakeDelMini";
    delB.textContent = "Remove";
    delB.title = "Remove " + n;
    delB.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!socket || socket.readyState !== 1) return;
      socket.send(JSON.stringify({ t: "sysmsg", text: n + " left", presence: "left", ts: Date.now() }));
      fakeUsers.delete(n);
      if (selectedFake === n) { selectedFake = null; asFakeSendRow.classList.add("hide"); }
      refreshFakeList();
    });
    btns.appendChild(sendB);
    btns.appendChild(delB);
    row.appendChild(btns);
    row.addEventListener("click", () => selectFake(n));
    asFakeList.appendChild(row);
  }
}

function selectFake(n) {
  selectedFake = n;
  asFakeMsg.placeholder = "Message as " + n + "…";
  asFakeSendRow.classList.remove("hide");
  refreshFakeList();
}

asFakeCreateBtn.addEventListener("click", () => {
  const name = asFakeName.value.trim().slice(0, 20);
  if (!name) { toast("Enter a fake user name"); return; }
  const fakeRule = nameRuleMsg(name);
  if (fakeRule) { toast(fakeRule); return; }
  if (/^admin$/i.test(name)) { toast("Can't create the admin account"); return; }
  if (nameHasBlacklisted(name)) { toast("That name contains a blocked word — please pick another"); return; }
  if (fakeUsers.has(name)) { toast("That fake user already exists"); return; }
  if (!socket || socket.readyState !== 1) { toast("Not connected yet"); return; }
  socket.send(JSON.stringify({ t: "sysmsg", text: name + " joined", presence: "join", ts: Date.now() }));
  fakeUsers.add(name);
  asFakeName.value = "";
  selectFake(name);
});

asFakeSendBtn.addEventListener("click", async () => {
  if (!selectedFake) { toast("Select a fake user first"); return; }
  const text = asFakeMsg.value.trim();
  if (!text) { toast("Type a message"); return; }
  try {
    const r = await socket.rpc.fakeSay(JSON.stringify({ name: selectedFake, text }));
    if (r === "ok") asFakeMsg.value = "";
    else if (r === "rate limited") toast("Too fast — wait a moment");
    else toast(r === "invalid" ? "Invalid name or message" : "Failed to send");
  } catch (e) {}
});
asFakeMsg.addEventListener("keydown", (e) => { if (e.key === "Enter") asFakeSendBtn.click(); });
asFakeName.addEventListener("keydown", (e) => { if (e.key === "Enter") asFakeCreateBtn.click(); });

async function loadFakeUsers() {
  if (!socket || socket.readyState !== 1) return;
  try {
    const arr = JSON.parse(await socket.rpc.getFakeUsers(""));
    fakeUsers.clear();
    for (const n of arr) fakeUsers.add(n);
    if (selectedFake && !fakeUsers.has(selectedFake)) { selectedFake = null; asFakeSendRow.classList.add("hide"); }
    refreshFakeList();
  } catch (e) {}
}

function fmtDur(s) {
  s = Math.max(0, Math.round(Number(s) || 0));
  const m = Math.floor(s / 60);
  return String(m).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

function fmtSize(bytes) {
  bytes = Number(bytes) || 0;
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return Math.max(1, Math.round(bytes / 1024)) + " KB";
}

function genBars(seed, n) {
  let h = 0x811c9dc5;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  const rand = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
  const peaks = [];
  const np = 2 + Math.floor(rand() * 2);
  for (let k = 0; k < np; k++) peaks.push({ p: 0.15 + rand() * 0.7, w: 0.14 + rand() * 0.2, a: 0.5 + rand() * 0.5 });
  const bars = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let env = 0.15;
    for (const pk of peaks) env += pk.a * Math.exp(-Math.pow((t - pk.p) / pk.w, 2));
    env = Math.min(1, env);
    bars.push(Math.max(0.16, Math.min(1, (0.35 + 0.65 * rand()) * (0.45 + 0.55 * env))));
  }
  return bars;
}

function wirePlayback(playBtn, waveEl, url, dur, dot) {
  let audio = null;
  const bars = [...waveEl.children];
  const setPlayed = (p) => {
    bars.forEach((b, i) => b.classList.toggle("played", i / bars.length < p));
  };
  playBtn.addEventListener("click", () => {
    if (audio && !audio.paused) {
      audio.pause();
      return;
    }
    if (!audio) {
      audio = new Audio(url);
      audio.ontimeupdate = () => setPlayed(audio.currentTime / Math.max(0.1, dur));
      audio.onended = () => {
        setPlayed(0);
        playBtn.classList.remove("playing");
        playBtn.innerHTML = PLAY_SVG;
        if (dot) dot.remove();
      };
    }
    audio.play().then(() => {
      playBtn.classList.add("playing");
      playBtn.innerHTML = PAUSE_SVG;
    }).catch(() => {});
  });
}

function buildVoiceBubble(m, grouped) {
  const mine = isMine(m);
  const wrap = el("div", "msg " + (mine ? "out" : "in") + (grouped ? " grouped" : ""));
  const bubble = el("div", "bubble voiceBubble");
  applyAuthorOutline(bubble, m.from);
  wrap.dataset.ts = m.ts || "";
  const sn = senderNameEl(m, mine, grouped);
  if (sn) bubble.appendChild(sn);
  if (m.replyTo) bubble.appendChild(replyQuoteEl(m.replyTo, nameColor(m.replyTo.from)));
  const top = el("div", "voiceTop");
  const play = document.createElement("button");
  play.className = "playBtn";
  play.innerHTML = PLAY_SVG;
  const wave = el("div", "wave");
  const bars = genBars(m.url, 32);
  bars.forEach((h) => {
    const b = document.createElement("span");
    b.style.height = Math.round(h * 22) + "px";
    wave.appendChild(b);
  });
  top.appendChild(play);
  top.appendChild(wave);
  bubble.appendChild(top);
  const meta = el("div", "voiceMeta");
  meta.textContent = "Voice, " + fmtSize(m.size) + ", " + fmtDur(m.dur);
  const dot = el("span", "unreadDot");
  meta.appendChild(dot);
  bubble.appendChild(meta);
  bubble.appendChild(tsrowEl(m, mine));
  rxRender(bubble, m);
  wrap.appendChild(bubble);
  wireSelection(wrap, bubble, m);
  wireReply(wrap, bubble, m);
  if (m.flagged) bubble.classList.add("flagged");
  wirePlayback(play, wave, m.url, m.dur, dot);
  return wrap;
}
function addVoiceBubble(m) {
  const w = buildVoiceBubble(m, lastMessageFrom() === m.from);
  hostEl().appendChild(w);
  return w;
}

/* ---------- bounded GIF playback ----------
   Animated GIFs are decoded with the native ImageDecoder and drawn onto a canvas
   so their playback can be bounded: each one plays GIF_LOOPS full passes, then
   holds on the last frame behind a badge. Clicking it replays another GIF_LOOPS
   passes; double-clicking opens the lightbox. Where ImageDecoder is missing (or
   the file isn't actually animated) the plain <img> keeps looping as before. */
const GIF_LOOPS = 4;
const GIF_ZERO_DELAY = 100;
const GIF_MIN_DELAY = 20;
const GIF_MAX_DELAY = 8000;
const GIF_MAX_DIM = 720;
const GIF_BADGE_SVG = `<svg viewBox="0 0 24 24" width="25" height="25" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M18.75,3.50054297 C20.5449254,3.50054297 22,4.95561754 22,6.75054297 L22,17.2531195 C22,19.048045 20.5449254,20.5031195 18.75,20.5031195 L5.25,20.5031195 C3.45507456,20.5031195 2,19.048045 2,17.2531195 L2,6.75054297 C2,4.95561754 3.45507456,3.50054297 5.25,3.50054297 L18.75,3.50054297 Z M18.75,5.00054297 L5.25,5.00054297 C4.28350169,5.00054297 3.5,5.78404466 3.5,6.75054297 L3.5,17.2531195 C3.5,18.2196178 4.28350169,19.0031195 5.25,19.0031195 L18.75,19.0031195 C19.7164983,19.0031195 20.5,18.2196178 20.5,17.2531195 L20.5,6.75054297 C20.5,5.78404466 19.7164983,5.00054297 18.75,5.00054297 Z M8.01459972,8.87193666 C8.61149825,8.87193666 9.03352891,8.95326234 9.51677386,9.18532686 C9.82793289,9.33475204 9.95904407,9.70812933 9.80961888,10.0192884 C9.6601937,10.3304474 9.28681641,10.4615586 8.97565738,10.3121334 C8.67582824,10.1681491 8.43601415,10.1219367 8.01459972,10.1219367 C7.14788947,10.1219367 6.51103525,10.9182985 6.51103525,11.9943017 C6.51103525,13.0713011 7.14873038,13.8702789 8.01459972,13.8702789 C8.44322427,13.8702789 8.80607251,13.6904125 8.99484486,13.3695045 L9.001,13.354543 L9.001,12.620543 L8.62521827,12.6211937 C8.31142012,12.6211937 8.05163513,12.3899359 8.00699487,12.0885517 L8.00021827,11.9961937 C8.00021827,11.6823956 8.23147615,11.4226106 8.53286035,11.3779703 L8.62521827,11.3711937 L9.62682145,11.3711937 C9.94061961,11.3711937 10.2004046,11.6024516 10.2450448,11.9038358 L10.2518215,11.9961937 L10.2504852,13.5438774 L10.2504852,13.5438774 L10.2441303,13.5991827 L10.2441303,13.5991827 L10.2229651,13.6890602 L10.2229651,13.6890602 L10.2024697,13.7442077 C9.82606539,14.6343365 8.96156448,15.1202789 8.01459972,15.1202789 C6.38857781,15.1202789 5.26103525,13.707564 5.26103525,11.9943017 C5.26103525,10.2816525 6.38839145,8.87193666 8.01459972,8.87193666 Z M12.6289445,8.99393497 C12.9427427,8.99393497 13.2025276,9.22519285 13.2471679,9.52657705 L13.2539445,9.61893497 L13.2539445,14.381065 C13.2539445,14.726243 12.9741225,15.006065 12.6289445,15.006065 C12.3151463,15.006065 12.0553614,14.7748072 12.0107211,14.4734229 L12.0039445,14.381065 L12.0039445,9.61893497 C12.0039445,9.273757 12.2837665,8.99393497 12.6289445,8.99393497 Z M15.6247564,8.99393489 L17.6221579,9.00083497 C17.9673338,9.00202673 18.246188,9.28281321 18.2450039,9.62798912 C18.2439132,9.94178541 18.0117595,10.2007704 17.7102229,10.2443727 L17.6178421,10.2508313 L16.247,10.245543 L16.247,11.999543 L17.37,12.0004012 C17.6837982,12.0004012 17.9435831,12.2316591 17.9882234,12.5330433 L17.995,12.6254012 C17.995,12.9391993 17.7637421,13.1989843 17.4623579,13.2436246 L17.37,13.2504012 L16.247,13.249543 L16.2475985,14.3649711 C16.2475985,14.6787693 16.0163406,14.9385543 15.7149564,14.9831945 L15.6225985,14.9899711 C15.3088003,14.9899711 15.0490154,14.7587133 15.0043751,14.4573291 L14.9975984,14.3649711 L14.9975984,9.61677709 C14.9986853,9.30298081 15.230839,9.04399582 15.5323756,9.00039353 L15.6247564,8.99393489 Z"></path></svg>`;
const gifDecodeCache = new Map();

function gifFrameMs(us) {
  const ms = Number(us) / 1000;
  if (!ms || ms < GIF_MIN_DELAY) return GIF_ZERO_DELAY;
  return Math.min(ms, GIF_MAX_DELAY);
}

async function gifBytes(url) {
  try {
    const r = await fetch(url, { mode: "cors" });
    if (r.ok) {
      const b = await r.arrayBuffer();
      if (b && b.byteLength) return b;
    }
  } catch (e) {}
  try {
    const r = await root.superFetch(url);
    if (r && r.ok !== false) {
      const b = await r.arrayBuffer();
      if (b && b.byteLength) return b;
    }
  } catch (e) {}
  return null;
}

function gifDecode(url) {
  const hit = gifDecodeCache.get(url);
  if (hit) {
    gifDecodeCache.delete(url);
    gifDecodeCache.set(url, hit);
    return hit;
  }
  const p = (async () => {
    if (typeof ImageDecoder === "undefined") return null;
    const bytes = await gifBytes(url);
    if (!bytes) return null;
    const type = /\.webp(\?|#|$)/i.test(url) ? "image/webp" : "image/gif";
    let dec = null;
    try {
      dec = new ImageDecoder({ data: bytes, type });
      await dec.completed;
      await dec.tracks.ready;
      const track = dec.tracks[0];
      if (!track || !track.animated || track.frameCount < 2) return null;
      const first = await dec.decode({ frameIndex: 0 });
      const w = first.image.displayWidth || 0;
      const h = first.image.displayHeight || 0;
      first.image.close();
      if (!w || !h) return null;
      return { decoder: dec, frames: track.frameCount, w, h };
    } catch (e) {
      try { if (dec) dec.close(); } catch (e2) {}
      return null;
    }
  })();
  gifDecodeCache.set(url, p);
  while (gifDecodeCache.size > 16) gifDecodeCache.delete(gifDecodeCache.keys().next().value);
  return p;
}

function gifPlay(canvas, badge, info) {
  const st = canvas.__gif || (canvas.__gif = { token: 0 });
  const token = ++st.token;
  const alive = () => st.token === token;
  badge.hidden = true;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const total = GIF_LOOPS * info.frames;
  // Decode one frame ahead so decode time overlaps the previous frame's delay
  // (otherwise a slow decode stretches the whole animation).
  const dec = (i) => info.decoder.decode({ frameIndex: i }).then((f) => {
    if (!alive()) { try { f.image.close(); } catch (e) {} throw new Error("stopped"); }
    return f;
  }).catch(() => null);
  (async () => {
    let next = dec(0);
    for (let n = 0; n < total; n++) {
      const frame = await next;
      if (!alive()) return;
      if (!frame) return;
      next = (n + 1 < total) ? dec((n + 1) % info.frames) : null;
      const t0 = performance.now();
      try { ctx.drawImage(frame.image, 0, 0, W, H); } catch (e) {}
      const ms = gifFrameMs(frame.image.duration);
      try { frame.image.close(); } catch (e) {}
      await new Promise((r) => setTimeout(r, Math.max(0, ms - (performance.now() - t0))));
      if (!alive()) return;
    }
    if (alive()) badge.hidden = false;
  })();
}

async function setupGifBubble(img, url) {
  const info = await gifDecode(url);
  if (!info || !img.isConnected) return;
  const scale = Math.min(1, GIF_MAX_DIM / Math.max(info.w, info.h));
  const canvas = document.createElement("canvas");
  canvas.className = "gifCanvas";
  canvas.width = Math.max(1, Math.round(info.w * scale));
  canvas.height = Math.max(1, Math.round(info.h * scale));
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "GIF");
  const badge = el("div", "gifPauseBadge");
  badge.innerHTML = GIF_BADGE_SVG;
  badge.hidden = true;
  const wrap = el("div", "gifWrap");
  wrap.appendChild(canvas);
  wrap.appendChild(badge);
  img.replaceWith(wrap);
  const inSelMode = () => document.getElementById("app").classList.contains("selMode");
  canvas.addEventListener("click", (e) => {
    e.stopPropagation();
    if (inSelMode()) return;
    gifPlay(canvas, badge, info);
  });
  canvas.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    if (inSelMode()) return;
    openLightbox(url);
  });
  gifPlay(canvas, badge, info);
}

function wireGifPlayback(bubble, img, url, isGif) {
  if (!isGif || !url || typeof ImageDecoder === "undefined") return;
  const start = () => { setupGifBubble(img, url).catch(() => {}); };
  if (img.complete && img.naturalWidth) start();
  else img.addEventListener("load", start, { once: true });
}

function buildImgBubble(m, grouped) {
  const mine = isMine(m);
  const wrap = el("div", "msg " + (mine ? "out" : "in") + (grouped ? " grouped" : ""));
  const bubble = el("div", "bubble imgBubble");
  applyAuthorOutline(bubble, m.from);
  if (/(^|\.)gif($|\?)|giphy\.com|tenor\.com/i.test(m.url || "")) bubble.classList.add("gifMsg");
  wrap.dataset.ts = m.ts || "";
  const sn = senderNameEl(m, mine, grouped);
  if (sn) bubble.appendChild(sn);
  if (m.replyTo) bubble.appendChild(replyQuoteEl(m.replyTo, nameColor(m.replyTo.from)));
  const img = document.createElement("img");
  img.src = m.url;
  img.alt = "Image";
  img.loading = "lazy";
  img.addEventListener("click", (e) => {
    e.stopPropagation();
    if (document.getElementById("app").classList.contains("selMode")) return;
    openLightbox(m.url);
  });
  bubble.appendChild(img);
  wireGifPlayback(bubble, img, m.url, bubble.classList.contains("gifMsg"));
  if (m.caption) {
    const cap = el("div", "caption");
    cap.innerHTML = linkifyHtml(m.caption);
    bubble.appendChild(cap);
    if (cap.querySelector("a")) addLinkPreview(bubble, m.caption);
  }
  const ts = tsrowEl(m, mine);
  if (m.caption) ts.classList.add("tsrow-flat");
  bubble.appendChild(ts);
  rxRender(bubble, m);
  wrap.appendChild(bubble);
  wireSelection(wrap, bubble, m);
  wireReply(wrap, bubble, m);
  if (m.flagged) bubble.classList.add("flagged");
  return wrap;
}
function addImgBubble(m) {
  const w = buildImgBubble(m, lastMessageFrom() === m.from);
  hostEl().appendChild(w);
  return w;
}

const lightbox = document.getElementById("lightbox");
const lbImg = document.getElementById("lbImg");
function openLightbox(url) {
  lbImg.src = url;
  lightbox.classList.remove("hide");
  lbImg.onload = () => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const nw = lbImg.naturalWidth, nh = lbImg.naturalHeight;
    if (!nw || !nh) { lbImg.style.width = ""; lbImg.style.height = ""; return; }
    const fit = Math.min((vw * 0.94) / nw, (vh * 0.94) / nh);
    const want = Math.max(1, (vw * 0.6) / nw);
    const s = Math.min(fit, want);
    lbImg.style.width = Math.round(nw * s) + "px";
    lbImg.style.height = Math.round(nh * s) + "px";
  };
}
function closeLightbox() {
  lightbox.classList.add("hide");
  lbImg.src = "";
}
document.getElementById("lbBackdrop").addEventListener("click", closeLightbox);
document.getElementById("lbImg").addEventListener("click", closeLightbox);
document.getElementById("lbCloseBtn").addEventListener("click", closeLightbox);
document.getElementById("lbDlBtn").addEventListener("click", () => {
  downloadImage(lbImg.src, "image");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !lightbox.classList.contains("hide")) closeLightbox();
});
document.addEventListener("click", (e) => {
  const av = e.target && e.target.closest ? e.target.closest(".msgAvatar:not(.spacer), .pAvatar") : null;
  if (!av || av.closest("#app.selMode")) return;
  const img = av.querySelector("img.avImg, img");
  const url = img && img.src ? img.src : "";
  if (!url) return;
  e.preventDefault();
  e.stopPropagation();
  openLightbox(url);
}, true);
function buildMessageDom(m, grouped) {
  if (m.t === "delnote") return buildDelNote(m);
  if (m.t === "voice") return buildVoiceBubble(m, grouped);
  if (m.t === "img") return buildImgBubble(m, grouped);
  return buildTextBubble(m, grouped);
}

function buildTextBubble(m, grouped) {
  const mine = isMine(m);
  const emojiOnly = isSingleEmoji(m.text);
  const wrap = el("div", "msg " + (mine ? "out" : "in") + (grouped ? " grouped" : "") + (emojiOnly ? " emojiOnly" : ""));
  const bubble = el("div", "bubble");
  applyAuthorOutline(bubble, m.from);
  wrap.dataset.ts = m.ts || "";
  wrap.dataset.from = m.from;
  const sn = senderNameEl(m, mine, grouped);
  if (sn) bubble.appendChild(sn);
  if (m.replyTo) bubble.appendChild(replyQuoteEl(m.replyTo, nameColor(m.replyTo.from)));
  const text = el("div", "btext" + (emojiOnly ? " emojiOnlyText" : ""));
  text.innerHTML = linkifyHtml(m.text);
  bubble.appendChild(text);
  addLinkPreview(bubble, m.text);
  bubble.appendChild(tsrowEl(m, mine));
  rxRender(bubble, m);
  wrap.appendChild(bubble);
  wireSelection(wrap, bubble, m);
  wireReply(wrap, bubble, m);
  if (m.flagged) bubble.classList.add("flagged");
  return wrap;
}
function addTextBubble(m) {
  const w = buildTextBubble(m, lastMessageFrom() === m.from);
  hostEl().appendChild(w);
  scheduleLongSync();
  return w;
}
function syncBubbleLong(bubble) {
  if (!bubble) return;
  const wrap = bubble.parentElement;
  if (wrap && wrap.classList && wrap.classList.contains("emojiOnly")) return;
  if (bubble.classList.contains("imgBubble") || bubble.classList.contains("voiceBubble") || bubble.classList.contains("ytBubble") || bubble.classList.contains("has-tog")) { bubble.classList.remove("is-long"); return; }
  const bt = bubble.querySelector(".btext");
  const ts = bubble.querySelector(".tsrow");
  if (!bt || !ts) return;
  const br0 = bt.getBoundingClientRect();
  const tr0 = ts.getBoundingClientRect();
  if (!br0.width && !br0.height && !tr0.width && !tr0.height) return;
  const prev = ts.style.marginTop;
  ts.style.marginTop = "0px";
  const br = bt.getBoundingClientRect();
  const tr = ts.getBoundingClientRect();
  const isLong = tr.top >= br.bottom - 2;
  ts.style.marginTop = prev;
  bubble.classList.toggle("is-long", isLong);
}
function syncAllBubbleLong() {
  for (const b of document.querySelectorAll(".msg .bubble")) syncBubbleLong(b);
}
let longSyncQueued = false;
function scheduleLongSync() {
  if (longSyncQueued) return;
  longSyncQueued = true;
  requestAnimationFrame(() => { longSyncQueued = false; syncAllBubbleLong(); });
}
window.addEventListener("resize", scheduleLongSync);
window.addEventListener("orientationchange", scheduleLongSync);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => scheduleLongSync()).catch(() => {});

/* ---------- day dividers ----------
   A pill showing the date sits above the first message of each day, styled the
   same as the join/left notices. It is derived from the timestamps already on
   the rendered nodes rather than tracked as messages are added, so it stays
   correct no matter what order history arrives in (appends, prepends, clears). */
function dayKey(ts) {
  const d = new Date(Number(ts) || 0);
  if (isNaN(d.getTime())) return "";
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}

function refreshDaySeps() {
  // Which nodes start a new day?
  const anchors = new Map();
  let cur = "";
  for (const n of messagesEl.children) {
    if (!n.classList || n.classList.contains("sep") || n.classList.contains("unreadBanner")) continue;
    const ts = Number(n.dataset && n.dataset.ts) || 0;
    if (!ts) continue;
    const k = dayKey(ts);
    if (k === cur) continue;
    cur = k;
    anchors.set(n, fmtDatePill(new Date(ts)));
  }
  // Keep/fix/drop the pills that are already there …
  for (const n of [...messagesEl.children]) {
    if (!n.classList || !n.classList.contains("sep")) continue;
    n.classList.add("daySep");
    const next = n.nextElementSibling;
    const want = next && anchors.get(next);
    if (!want) n.remove();
    else if (n.textContent !== want) n.textContent = want;
  }
  // … then give every anchor one if it is missing.
  for (const [node, label] of anchors) {
    const prev = node.previousElementSibling;
    if (prev && prev.classList.contains("sep")) continue;
    const s = el("div", "sep daySep");
    s.textContent = label;
    messagesEl.insertBefore(s, node);
  }
}

let daySepQueued = false;
function scheduleDaySeps() {
  if (daySepQueued) return;
  daySepQueued = true;
  queueMicrotask(() => { daySepQueued = false; refreshDaySeps(); });
}

function buildDelNote(m) {
  const mine = isMine(m);
  const wrap = el("div", "msg " + (mine ? "out" : "in"));
  wrap.dataset.id = m.id || "";
  if (m.ts) wrap.dataset.ts = m.ts;
  if (m.from) wrap.dataset.from = m.from;
  wrap.dataset.uid = m.uid || "";
  const bubble = el("div", "bubble");
  applyAuthorOutline(bubble, m.from);
  const sn = senderNameEl(m, mine, false);
  if (sn) bubble.appendChild(sn);
  const del = el("div", "btext delnoteText");
  const by = String(m.by || "").slice(0, 64);
  del.innerHTML = DELNOTE_SVG + '<span class="dnLabel"></span>';
  const dnLabel = del.querySelector(".dnLabel");
  dnLabel.textContent = (by && by !== "admin") ? by + " deleted this message." : "This message was deleted by the admin";
  bubble.appendChild(del);
  if (isAdmin() && m.orig) {
    const box = el("div", "delOrig");
    const or = m.orig;
    if (or.t === "img") {
      if (or.url) { const im = el("img", "delOrigImg"); im.src = or.url; im.loading = "lazy"; box.appendChild(im); }
      if (or.caption) box.appendChild(el("div", "delOrigText", or.caption));
      box.appendChild(el("div", "delOrigBadge", "Deleted message (admin only)"));
    } else if (or.t === "voice") {
      if (or.url) { const au = el("audio", "delOrigAudio"); au.src = or.url; au.controls = true; au.preload = "none"; box.appendChild(au); }
      box.appendChild(el("div", "delOrigBadge", "Voice message (admin only)"));
    } else {
      if (or.text) box.appendChild(el("div", "delOrigText", or.text));
      box.appendChild(el("div", "delOrigBadge", "Deleted message (admin only)"));
    }
    bubble.appendChild(box);
  }
  bubble.appendChild(tsrowEl(m, mine));
  wrap.appendChild(bubble);
  return wrap;
}

function addMessageDom(m) {
  if (m.t === "system") {
    const wrap = sysDom(m);
    hostEl().appendChild(wrap);
    return wrap;
  }
  if (m.t === "delnote") { const w = buildDelNote(m); hostEl().appendChild(w); return w; }
  if (m.t === "voice") return addVoiceBubble(m);
  if (m.t === "img") return addImgBubble(m);
  return addTextBubble(m);
}
function updateBubbleTails() {
  keepTypingRowLast();
  const kids = messagesEl.children;
  let prevFrom = null;
  for (let i = 0; i < kids.length; i++) {
    const m = kids[i];
    if (!m.classList || !m.classList.contains("msg")) { prevFrom = null; continue; }
    const next = kids[i + 1];
    const same = !!(next && next.classList.contains("msg") && next.dataset.from && next.dataset.from === m.dataset.from);
    m.classList.toggle("no-tail", same);
    // Received messages all keep a left gutter for the sender avatar. The chip
    // itself rides the message that carries the bubble tail - the last of a run
    // - and sits level with the bubble's bottom edge, so the tail points at it
    // (and stays put while more messages from that sender arrive). The earlier
    // messages of the run get the same gutter as an invisible spacer, which is
    // what keeps every bubble of the run on one left edge.
    const incoming = !m.classList.contains("out") && !!m.dataset.from;
    syncMsgAvatar(m, incoming && !same, incoming && same);
    prevFrom = m.dataset.from || "";
  }
  scheduleLongSync();
}
/* Keeps one `.msg` node's gutter in step with its sender: creates the letter
   chip, re-letters it after a rename, and swaps between avatar and spacer (or
   removes it entirely for own messages). Senders are opaque nicknames, so the
   chip is just their first letter over their name colour. */
function syncMsgAvatar(wrap, show, spacer) {
  const from = wrap.dataset.from || "";
  let av = wrap.querySelector(":scope > .msgAvatar");
  if (!show && !spacer) { if (av) av.remove(); return; }
  if (!av) {
    av = el("span", "msgAvatar");
    av.setAttribute("aria-hidden", "true");
    wrap.insertBefore(av, wrap.firstChild);
  }
  av.classList.toggle("spacer", !!spacer);
  if (!show) {
    const d = av.querySelector(":scope > .mOnlineDot");
    if (d) d.remove();
    return;
  }
  // Keyed on name *and* picture so a picture arriving later (or being removed)
  // repaints the chip even though the sender's name is unchanged.
  const key = from + "\u0000" + pfpFor(from);
  if (av.dataset.k !== key) {
    av.dataset.k = key;
    paintAvatar(av, from);
  }
  paintAvatarDot(av, from);
}
function paintAvatarDot(av, name) {
  let d = av.querySelector(":scope > .mOnlineDot");
  if (!onlineNames.has(name)) {
    if (d) d.remove();
    return;
  }
  if (!d) {
    d = el("span", "mOnlineDot");
    av.appendChild(d);
  }
  d.classList.remove("off");
}
function refreshAvatarDots() {
  for (const host of msgContainers()) {
    for (const av of host.querySelectorAll(".msgAvatar:not(.spacer)")) {
      if (av.closest("#typingRow")) continue;
      const wrap = av.parentElement;
      paintAvatarDot(av, (wrap && wrap.dataset && wrap.dataset.from) || "");
    }
  }
}
/* First letter or digit of a nickname (so "-=Sky=-" still shows an S), falling
   back to the first character for names with neither. */
function senderInitial(name) {
  const s = String(name == null ? "" : name).trim();
  const m = s.match(/[\p{L}\p{N}]/u);
  return (m ? m[0] : (Array.from(s)[0] || "?")).toUpperCase();
}
const tailObserver = new MutationObserver(() => { updateBubbleTails(); scheduleDaySeps(); });
tailObserver.observe(messagesEl, { childList: true });
function translateRealtimeMessage(m, wrap) {
  if (!translateOn || !wrap) return;
  if (isMine(m)) return;
  if (m.t === "chat") {
    const el = wrap.querySelector(".btext");
    if (el && el.dataset.tOrig === undefined && el.dataset.tBusy === undefined) {
      scheduleRealtimeTranslation(el);
    }
  } else if (m.t === "img" && m.caption) {
    const cap = wrap.querySelector(".caption");
    if (cap && cap.dataset.tOrig === undefined && cap.dataset.tBusy === undefined) {
      scheduleRealtimeTranslation(cap);
    }
  }
}

function showOnlineStatus() {
  onlineSub.textContent = onlineCount === 1 ? "online" : onlineCount + " online";
}

const typers = new Map();
function typingNames() { return [...typers.keys()]; }
function typingLabel(names) {
  if (names.length === 1) return names[0];
  if (names.length === 2) return names[0] + ", " + names[1];
  return names.slice(0, 2).join(", ") + " +" + (names.length - 2);
}
function renderTypingBubble() {
  const names = typingNames();
  const row = document.getElementById("typingRow");
  if (!names.length) {
    if (row) row.remove();
    return;
  }
  const label = typingLabel(names);
  if (!row) {
    const r = el("div", "typingRow");
    r.id = "typingRow";
    if (names.length > 1) {
      const stack = el("span", "typingAvStack");
      names.slice(0, 3).forEach((nm) => stack.appendChild(typingAvatarEl([nm])));
      stack.title = names.join(", ");
      r.appendChild(stack);
    } else {
      r.appendChild(typingAvatarEl(names));
    }
    const b = el("div", "bubble typingBubble");
    const d = el("div", "typingDots");
    for (let i = 0; i < 3; i++) d.appendChild(document.createElement("span"));
    if (names.length < 2) {
      const n = el("span", "typingName");
      const nt = el("span", "typingNameText", label);
      nt.style.color = nameColor(names[0]);
      n.appendChild(nt);
      const who = names[0];
      if (who === "admin") n.appendChild(adminBadgeEl());
      else if (verifiedSet.has(who)) n.appendChild(verifiedBadgeEl());
      b.appendChild(n);
    } else {
      b.title = label + " typing…";
      b.setAttribute("aria-label", label + " typing");
    }
    b.appendChild(d);
    typingOutline(b, names);
    r.appendChild(b);
    messagesEl.appendChild(r);
  } else {
    const b = row.querySelector(":scope > .bubble");
    let stack = row.querySelector(":scope > .typingAvStack");
    let singleAv = row.querySelector(":scope > .msgAvatar");
    if (names.length > 1) {
      if (singleAv) singleAv.remove();
      if (!stack) { stack = el("span", "typingAvStack"); row.insertBefore(stack, row.firstChild); }
      stack.innerHTML = "";
      names.slice(0, 3).forEach((nm) => stack.appendChild(typingAvatarEl([nm])));
      stack.title = names.join(", ");
      const oldName = b.querySelector(".typingName");
      if (oldName) oldName.remove();
      b.title = label + " typing…";
      b.setAttribute("aria-label", label + " typing");
    } else {
      if (stack) stack.remove();
      if (singleAv) singleAv.remove();
      row.insertBefore(typingAvatarEl(names), row.firstChild);
      b.removeAttribute("title");
      b.removeAttribute("aria-label");
      let n = b.querySelector(".typingName");
      if (!n) { n = el("span", "typingName"); b.insertBefore(n, b.firstChild); }
      n.innerHTML = "";
      const nt = el("span", "typingNameText", label);
      nt.style.color = nameColor(names[0]);
      n.appendChild(nt);
      const who = names[0];
      if (who === "admin") n.appendChild(adminBadgeEl());
      else if (verifiedSet.has(who)) n.appendChild(verifiedBadgeEl());
    }
    const nt = row.querySelector(".typingNameText");
    if (nt) { nt.textContent = label; nt.style.color = nameColor(names[0]); }
    const n = row.querySelector(".typingName");
    if (n) {
      const oldBadge = n.querySelector(".verifiedBadgeWrap");
      if (oldBadge) oldBadge.remove();
      if (names.length === 1) {
        const who = names[0];
        if (who === "admin") n.appendChild(adminBadgeEl());
        else if (verifiedSet.has(who)) n.appendChild(verifiedBadgeEl());
      }
    }
    typingOutline(row.querySelector(":scope > .bubble"), names);
  }
}
/* The typing bubble carries the same author stroke as a sent message: gold when
   the admin is typing, blue when a verified user is (admin wins a mixed group). */
function typingOutline(bubble, names) {
  if (!bubble) return;
  const admin = names.indexOf("admin") !== -1;
  const verified = !admin && names.some((n) => verifiedSet.has(n));
  bubble.classList.toggle("adminMsg", admin);
  bubble.classList.toggle("verifiedMsg", verified);
}
/* The typing bubble gets the same left gutter as a received message: the typer's
   own letter chip when one person is typing, a neutral ellipsis chip when
   several are (their names are already spelled out in the bubble). */
function typingAvatarEl(names) {
  const multi = names.length > 1;
  const av = el("span", "msgAvatar");
  av.setAttribute("aria-hidden", "true");
  if (multi) {
    av.textContent = "\u2026";
    av.style.background = glossBg("#9aa0a8");
    av.title = names.join(", ");
  } else {
    paintAvatar(av, names[0]);
  }
  if (!av.querySelector(":scope > .mOnlineDot")) av.appendChild(el("span", "mOnlineDot"));
  return av;
}
/* The typing bubble belongs under the conversation, never wedged between two
   messages - messages arriving after it was drawn would otherwise leave it
   stranded mid-list. Runs from the mutation observer (and therefore settles in
   one extra pass: the move itself queues another, which then finds it last). */
function keepTypingRowLast() {
  const row = document.getElementById("typingRow");
  if (row && row.nextElementSibling) messagesEl.appendChild(row);
}
function noteTyping(name) {
  const t = typers.get(name);
  if (t) clearTimeout(t);
  typers.set(name, setTimeout(() => { typers.delete(name); renderTypingBubble(); }, 6000));
  renderTypingBubble();
}
function stopTyping(name) {
  if (!typers.delete(name)) return;
  renderTypingBubble();
}

const UNREAD_CHEV = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';

function addNewMsgsBanner() {
  if (!lastSeenAt) return 0;
  let count = 0;
  let firstNew = null;
  for (const n of roomMessagesEl.children) {
    if (n.dataset && n.dataset.ts && Number(n.dataset.ts) > lastSeenAt) {
      count++;
      if (!firstNew) firstNew = n;
    }
  }
  if (!firstNew) return 0;
  const banner = el("div", "unreadBanner");
  banner.appendChild(el("span", "unreadLabel", "Unread Messages"));
  const chev = document.createElement("span");
  chev.innerHTML = UNREAD_CHEV;
  banner.appendChild(chev);
  roomMessagesEl.insertBefore(banner, firstNew);
  return count;
}

function scrollToNewBanner(smooth) {
  const b = messagesEl.querySelector(".unreadBanner");
  if (!b) return false;
  const ct = scrollCtnEl.getBoundingClientRect();
  const r = b.getBoundingClientRect();
  const target = Math.max(0, scrollCtnEl.scrollTop + (r.top - ct.top) - scrollCtnEl.clientHeight / 2);
  if (smooth) animateScrollTo(target);
  else { scrollCtnEl.scrollTop = target; updateScrollBtn(); }
  return true;
}

function applyRename(from, to, uid) {
  if (!from || !to || (from === to && !uid)) return;
  if (uid ? uid === myUid : myName === from) myName = to;
  // Carry the cached picture over to the new name so avatars don't blink out
  // during a rename (the server re-publishes it separately).
  if (from !== to && pfpFor(from)) {
    const pic = pfpMap[from];
    delete pfpMap[from];
    pfpMap[to] = pic;
    savePfpMap();
  }
  const senderEls = [];
  for (const host of msgContainers()) {
    for (const wrap of [...host.children]) {
      if (!wrap.dataset) continue;
      const mm = msgByWrap.get(wrap);
      const target = (uid && mm && mm.uid) ? mm.uid === uid : wrap.dataset.from === from;
      if (!target) continue;
      if (mm) mm.from = to;
      wrap.dataset.from = to;
      applyAuthorOutline(wrap.querySelector(".bubble"), to);
      const sn = wrap.querySelector(".senderName");
      if (sn) senderEls.push(sn);
    }
  }
  for (const sn of senderEls) {
    sn.setAttribute("data-vname", to);
    sn.textContent = to;
    sn.style.color = nameColor(to);
    applyVerifiedToSender(sn);
    const chip = sn.querySelector(".bannedChip");
    if (bannedNames.has(to)) { if (!chip) sn.appendChild(el("span", "bannedChip", "banned")); }
    else if (chip) chip.remove();
  }
  for (const host of msgContainers()) {
    for (const q of host.querySelectorAll(".replyQuote")) {
      const nm = q.querySelector(".rqName");
      if (nm && nm.textContent === from) {
        nm.textContent = to;
        nm.style.color = nameColor(to);
        const bad = nm.querySelector(".adminBadgeWrap");
        if (to === "admin") { if (!bad) nm.appendChild(adminBadgeEl()); }
        else if (bad) bad.remove();
      }
    }
  }
  if (replyToMsg && replyToMsg.from === from) {
    replyToMsg.from = to;
    const nm = replyQuoteBox.querySelector(".rqName");
    if (nm) { nm.textContent = to; nm.style.color = nameColor(to); }
  }
  if (typers.has(from)) {
    const v = typers.get(from);
    typers.delete(from);
    typers.set(to, v);
    renderTypingBubble();
  }
  // A rename follows the person through their private chats too: the open
  // conversation, its stashed copy and its unread badge all move with them.
  if (from !== to) {
    if (dmDom.has(from)) {
      const moved = dmDom.get(from);
      moved.dataset.peer = to;
      dmDom.set(to, moved);
      dmDom.delete(from);
    }
    if (dmScrollTops.has(from)) { dmScrollTops.set(to, dmScrollTops.get(from)); dmScrollTops.delete(from); }
    if (dmUnreadMap[from] != null) { dmUnreadMap[to] = dmUnreadMap[from]; delete dmUnreadMap[from]; saveDmUnread(); }
    for (const t of dmThreads) if (t.peer === from) t.peer = to;
    if (convo.mode === "dm" && convo.peer === from) {
      convo.peer = to;
      // Ownership in the open thread is read off the container's peer stamp, so
      // it has to follow the rename along with the header.
      dmMessagesEl.dataset.peer = to;
      applyHeader();
    }
    updateBackBadge();
    if (peopleOpen) renderPeopleList();
  }
  reclassifyOwnership();
  updateBubbleTails();
}

/* ---- one message, one bubble ----------------------------------------------
   Delivery is at-least-once, and it has to be treated that way: a replayed or
   repeated envelope, a resend after a reconnect, or a message that arrives live
   and then comes back with the room history (a Supabase row - a different id,
   but the sender and the timestamp the sender stamped are the same). Each of
   those used to draw a second bubble: "the same message shows twice, but only
   for new messages". So an arriving message is checked against what is already
   in its container before it is drawn - on id first (the very same envelope),
   then on sender + timestamp (a live copy and its history row). Timestamps are
   unique per message - the sender stamps one per message and the server's send
   rate limit is 200ms - so a match can only ever be the same message. */
function alreadyRendered(host, m) {
  if (!host || !m || !m.from) return false;
  const id = m.id == null ? "" : String(m.id);
  const ts = Number(m.ts) || 0;
  for (const n of host.children) {
    if (!n.classList || !n.classList.contains("msg")) continue;
    if (id && n.dataset.id === id) return true;
    if (ts && (Number(n.dataset.ts) || 0) === ts && n.dataset.from === m.from) return true;
  }
  return false;
}

function handleMessage(m) {
  if (m.t === "dm") {
    handleDm(m);
  } else if (m.t === "me") {
    if (!savedNickApplied) myName = m.name;
  } else if (m.t === "chat" || m.t === "system" || m.t === "img" || m.t === "voice") {
    if (historyLoading && (m.t === "chat" || m.t === "img" || m.t === "voice")) { historyBuffer.push(m); return; }
    if (alreadyRendered(roomMessagesEl, m)) return;
    // Room traffic keeps rendering into the room, even when a private chat is
    // covering it - the room's DOM is never left stale, and its own unread
    // machinery only runs while it is the one on screen.
    const atRoom = convo.mode === "room";
    const wasNearBottom = atRoom && isNearBottom();
    const mine = isMine(m);
    if (m.t !== "system" && m.replyTo && m.replyTo.from) replyKvNote(m.replyTo);
    const wrap = atRoom ? addMessageDom(m) : withMsgHost(roomMessagesEl, () => addMessageDom(m));
    if (m.t !== "system" && wrap) translateRealtimeMessage(m, wrap);
    if (m.t !== "system" && m.from && !mine && atRoom) playNotify();
    showMessageNotification(m);
    if ((m.t === "chat" || m.t === "img" || m.t === "voice") && mine && uploadPlaceholders.length) {
      removeUploadPlaceholder(uploadPlaceholders[0]);
    }
    if (m.t === "chat" || m.t === "img" || m.t === "voice") stopTyping(m.from);
    if (m.t === "chat" || m.t === "img" || m.t === "voice") {
      if (!atRoom) { updateScrollBtn(); }
      else if (mine) {
        scrollBottom();
        if (wasNearBottom) clearUnreadState();
      } else if (wasNearBottom) {
        scrollBottom(true);
        clearUnreadState();
      } else {
        unreadCount++;
        ensureUnreadBanner(wrap);
        showUnreadChip(unreadCount);
      }
    } else if (atRoom) {
      scrollBottom();
    }
    // Keeps the room's row in a wide layout (preview + unread count) current.
    refreshListView();
  } else if (m.t === "rename") {
    applyRename(String(m.from || ""), String(m.to || ""), m.uid || "");
  } else if (m.t === "presence") {
    onlineCount = m.count;
    if (convo.mode !== "dm") showOnlineStatus();
    if (!onlineModal.classList.contains("hide")) renderOnlineList();
  } else if (m.t === "typing") {
    if (convo.mode !== "room") return;
    if (m.uid && myUid ? m.uid === myUid : m.from === myName) return;
    noteTyping(m.from);
  } else if (m.t === "clear") {
    sbClearAll();
    clearedAt = Date.now();
    lsSet(clearedKey, String(clearedAt));
    seenMsgIds.clear();
    // The room is wiped; private chats go too (the server cleared its own
    // region), so any open one is closed rather than left on screen.
    msgByWrapCleanup(roomMessagesEl);
    roomMessagesEl.textContent = "";
    for (const peer of [...dmDom.keys()]) {
      const hold = dmDom.get(peer);
      if (hold) { msgByWrapCleanup(hold); hold.textContent = ""; }
    }
    dmDom.clear();
    dmScrollTops.clear();
    for (const k of Object.keys(dmUnreadMap)) delete dmUnreadMap[k];
    saveDmUnread();
    updateBackBadge();
    dmThreads = [];
    typers.clear();
    if (convo.mode === "dm") { convo = { mode: "people", peer: "" }; openPeople(); }
    else refreshListView();
    scrollBottom();
  } else if (m.t === "del") {
    const n = findMsgDom(String(m.id || ""), m.from || null, m.mts != null ? Number(m.mts) : null);
    if (n) {
      if (n.dataset.ts && n.dataset.from) { sbDeleteBy(n.dataset.ts, n.dataset.from); rxKvDrop(n.dataset.from, n.dataset.ts); }
      n.remove();
    }
    // Keep an open admin panel's archive list current.
    if (isAdmin() && !adminSide.classList.contains("hide")) loadDeletedMessages();
  } else if (m.t === "delnote") {
    const n = findMsgDom(String(m.id || ""), m.from || null, m.mts != null ? Number(m.mts) : null);
    if (n) {
      const alreadyDn = !!n.querySelector(".dnLabel");
      const ts = n.dataset.ts;
      const from = n.dataset.from;
      if (!alreadyDn) {
        if (ts && from) {
          const dnText = (m.orig || m.by) ? "__deln__" + JSON.stringify({ o: m.orig || null, b: m.by || null }) : null;
          sbDeleteBy(ts, from).then(() => sbInsert({ ts: Number(ts), sender: from, type: "delnote", text: dnText }));
          rxKvDrop(from, ts);
        }
        n.replaceWith(buildDelNote(Object.assign({}, m, { from: m.from || from || "" })));
      }
    }
    scrollBottom();
    if (isAdmin() && !adminSide.classList.contains("hide")) loadDeletedMessages();
  } else if (m.t === "edit") {
    const n = findMsgDom(String(m.id || ""), m.from || null, m.mts != null ? Number(m.mts) : null);
    if (n) {
      if (n.dataset.ts && n.dataset.from && typeof m.text === "string") sbPatchText(n.dataset.ts, n.dataset.from, m.text);
      const bubble = n.querySelector(".bubble");
      if (bubble) {
        if (bubble.classList.contains("imgBubble")) {
          let cap = bubble.querySelector(".caption");
          if (m.text) {
            if (cap) cap.innerHTML = linkifyHtml(m.text);
            else {
              cap = el("div", "caption");
              cap.innerHTML = linkifyHtml(m.text);
              bubble.insertBefore(cap, bubble.querySelector(".tsrow"));
            }
          } else if (cap) cap.remove();
        } else {
          const bt = bubble.querySelector(".btext");
          if (bt) { bt.innerHTML = linkifyHtml(m.text); syncEmojiClass(bubble, m.text); }
        }
        const ts = bubble.querySelector(".tsrow");
        if (ts && !ts.querySelector(".editedMark")) {
          ts.insertBefore(el("span", "editedMark", "edited"), ts.firstChild);
        }
      }
    }
    scrollBottom();
  } else if (m.t === "flag") {
    const n = findMsgDom(String(m.id || ""), m.from || null, m.mts != null ? Number(m.mts) : null);
    if (n) {
      const bubble = n.querySelector(".bubble");
      if (bubble) bubble.classList.toggle("flagged", !!m.flagged);
      n.dataset.flagged = m.flagged ? "1" : "0";
      if (n.dataset.ts && n.dataset.from) sbSetFlag(n.dataset.ts, n.dataset.from, !!m.flagged);
    } else if (m.t === "pin") {
    if (m.pin) renderPinned(m.pin);
  } else if (m.t === "unpin") {
    renderPinned(null);
  }
  } else if (m.t === "react") {
    const ref = { id: m.id || null, from: m.from || null, ts: m.mts != null ? m.mts : m.ts };
    rxRememberNames(m.nm);
    rxSet(ref.from, ref.ts, m.rx);
    rxApply(ref);
  } else if (m.t === "rx_fail") {
    toast("Can't react to that one — it's too old");
    loadReactions();
  } else if (m.t === "ban") {
    const name = String(m.name || "");
    if (!name) return;
    bannedNames.add(name);
    refreshBanUI(name);
    if (name === myName) showBannedModal();
  } else if (m.t === "unban") {
    const name = String(m.name || "");
    if (!name) return;
    bannedNames.delete(name);
    refreshBanUI(name);
  } else if (m.t === "you_banned") {
    showBannedModal();
  } else if (m.t === "vpn_blocked") {
    showVpnBlocked();
  } else if (m.t === "protected_logout") {
    const oldName = String(m.name || "");
    if (m.guest) myName = String(m.guest);
    savedNickApplied = false;
    joinedOnce = false;
    clearSavedPass();
    updateGate();
    showProtectedLogoutModal(oldName);
  } else if (m.t === "title") {
    setRoomTitle(m.title);
  } else if (m.t === "icon") {
    applyIcon(m.url);
  } else if (m.t === "pfp") {
    setPfpLocal(String(m.name || ""), String(m.url || ""));
  } else if (m.t === "verified") {
    const vname = String(m.name || "");
    if (!vname) return;
    verifiedSet.add(vname);
    refreshVerifiedUI();
  } else if (m.t === "unverified") {
    const vname = String(m.name || "");
    if (!vname) return;
    verifiedSet.delete(vname);
    refreshVerifiedUI();
  }
}

const SB_URL = "https://yvqndfyiwkegxkeolvoh.supabase.co";
const SB_KEY = "sb_publishable_AVPKoEterodpUPjlLCn3RA_d6q3ZJNn";
const SB_H = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: "return=minimal" };
async function sbInsert(row) { try { await fetch(SB_URL + "/rest/v1/messages", { method: "POST", headers: SB_H, body: JSON.stringify(row) }); } catch (e) {} }
async function sbDeleteBy(ts, sender) { try { await fetch(SB_URL + "/rest/v1/messages?ts=eq." + encodeURIComponent(ts) + "&sender=eq." + encodeURIComponent(sender), { method: "DELETE", headers: SB_H }); } catch (e) {} }
async function sbPatchText(ts, sender, text) { try { await fetch(SB_URL + "/rest/v1/messages?ts=eq." + encodeURIComponent(ts) + "&sender=eq." + encodeURIComponent(sender), { method: "PATCH", headers: SB_H, body: JSON.stringify({ text }) }); } catch (e) {} }
async function sbSetFlag(ts, sender, flagged) { try { await fetch(SB_URL + "/rest/v1/messages?ts=eq." + encodeURIComponent(ts) + "&sender=eq." + encodeURIComponent(sender), { method: "PATCH", headers: SB_H, body: JSON.stringify({ flagged }) }); } catch (e) {} }
async function sbRenameMyRows(oldName, newName) {
  // Own rows are recognised by the sent-timestamp ledger, plus anything the
  // chat is currently rendering as ours (covers messages sent before the
  // ledger existed / from another tab). Never matched on name alone - that
  // used to relabel other people's history.
  const set = new Set([...mySentTs]);
  // Room rows only - the private-chat mirror is keyed on the pair, not on a
  // sender/ts pair, so a rename re-keys it separately (sbRenameDmMirror).
  for (const wrap of roomMessagesEl.children) {
    if (wrap.dataset && wrap.dataset.ts && wrapIsMine(wrap)) set.add(String(wrap.dataset.ts));
  }
  const ts = [...set];
  if (!ts.length) return;
  for (let i = 0; i < ts.length; i += 40) {
    const list = ts.slice(i, i + 40).map((t) => encodeURIComponent(t)).join(",");
    let q = SB_URL + "/rest/v1/messages?ts=in.(" + list + ")";
    if (oldName) q += "&sender=eq." + encodeURIComponent(oldName);
    try { await fetch(q, { method: "PATCH", headers: SB_H, body: JSON.stringify({ sender: newName }) }); } catch (e) {}
  }
}
function renameMyDomMessages(newName) {
  for (const host of msgContainers()) {
    for (const wrap of [...host.children]) {
      if (!wrap.dataset || !wrap.classList.contains("msg")) continue;
      if (!wrapIsMine(wrap)) continue;
      wrap.dataset.from = newName;
      const mm = msgByWrap.get(wrap);
      if (mm) mm.from = newName;
    }
  }
}
/* ---- private chats, mirrored into the Supabase history table --------------
   Room history has always been mirrored here (sbInsert), but private chats
   lived only in the server's DM region, which caps each thread at
   DM_MSGS_MAX (150) messages and evicts whole threads once the region fills -
   so a busy conversation lost its oldest messages. Every DM message is now
   written here too, in the same `messages` table (the only table this
   generator has), under a `type` of "dm." + a hash of the two names. That one
   trick keeps the row out of every room query (they all filter
   `type=not.like.dm.*`) while still letting a single conversation - and only
   that conversation - be fetched back by key. The content kind, the message id
   and any reply context ride in `reply_to` as JSON, which also keeps the two
   names readable there for later diagnosis.
   This is a mirror, never the source of truth: every write is best-effort and
   swallows its own errors, and the server's DM region still drives the live
   thread. When a thread is opened, whatever Supabase holds for that pair is
   merged in behind the server's copy, so the scrollback outlives the cap. */
const SB_DM_ON = true;
async function dmThreadKey(a, b) {
  const [x, y] = a < b ? [a, b] : [b, a];
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(x + "\u0000" + y));
  let h = "";
  for (const byte of new Uint8Array(digest)) h += byte.toString(16).padStart(2, "0");
  return "dm." + h.slice(0, 32);
}
function sbDmMeta(peer, payload) {
  const [a, b] = myName < peer ? [myName, peer] : [peer, myName];
  const meta = { a, b, s: payload.sub || "chat" };
  if (payload.id) meta.id = String(payload.id);
  if (payload.replyTo) meta.rp = payload.replyTo;
  return meta;
}
// A sent message: one row. `sender` is the author, `text` doubles as the image
// caption (exactly as the room's img rows do), and the pair/hash keep the row
// addressable without a dedicated table.
async function sbDmMirrorSend(peer, payload) {
  if (!SB_DM_ON || !peer || !payload || !payload.sub || !payload.ts) return;
  try {
    const row = {
      ts: Number(payload.ts), sender: myName, type: await dmThreadKey(myName, peer),
      text: null, url: null, dur: null, size: null,
      reply_to: JSON.stringify(sbDmMeta(peer, payload)), flagged: false
    };
    if (payload.sub === "img") { row.url = String(payload.url || ""); if (payload.caption) row.text = String(payload.caption); }
    else if (payload.sub === "voice") { row.url = String(payload.url || ""); row.dur = Number(payload.dur) || 0; row.size = Number(payload.size) || 0; }
    else row.text = String(payload.text || "");
    await fetch(SB_URL + "/rest/v1/messages", { method: "POST", headers: SB_H, body: JSON.stringify(row) });
  } catch (e) {}
}
// An edit: only the author can make one, so the key is always the author's own
// pair and (type, ts) pinpoints the row.
async function sbDmMirrorEdit(peer, payload) {
  if (!SB_DM_ON || !peer || !payload || !payload.ts) return;
  try {
    const q = SB_URL + "/rest/v1/messages?type=eq." + (await dmThreadKey(myName, peer)) + "&ts=eq." + Number(payload.ts);
    await fetch(q, { method: "PATCH", headers: SB_H, body: JSON.stringify({ text: String(payload.text || "") }) });
  } catch (e) {}
}
// An unsend: same addressing. The message is dropped from the mirror too, so
// Supabase matches the thread - the deleted-message archive on the server is
// still the only record of it (see the DEL region).
async function sbDmMirrorDelete(peer, msg) {
  if (!SB_DM_ON || !peer || !msg || !msg.ts) return;
  try {
    const q = SB_URL + "/rest/v1/messages?type=eq." + (await dmThreadKey(myName, peer)) + "&ts=eq." + Number(msg.ts);
    await fetch(q, { method: "DELETE", headers: SB_H });
  } catch (e) {}
}
// "Delete the whole conversation for both of you" removes its mirror as well.
async function sbDmMirrorClear(peer) {
  if (!SB_DM_ON || !peer) return;
  try {
    await fetch(SB_URL + "/rest/v1/messages?type=eq." + (await dmThreadKey(myName, peer)), { method: "DELETE", headers: SB_H });
  } catch (e) {}
}
// Everything Supabase holds for one pair, oldest first. `owner` defaults to you.
async function sbDmFetch(peer, owner) {
  const key = await dmThreadKey(owner || myName, peer);
  const res = await fetch(SB_URL + "/rest/v1/messages?select=" + HISTORY_SEL + "&type=eq." + key + "&order=ts.asc&limit=5000", { headers: SB_H });
  const rows = await res.json().catch(() => null);
  return Array.isArray(rows) ? rows : [];
}
function sbDmRowToMsg(row) {
  let meta = {};
  try { meta = JSON.parse(row.reply_to || "{}"); } catch (e) {}
  const kind = meta.s === "img" || meta.s === "voice" ? meta.s : "chat";
  const m = { t: kind, from: row.sender, ts: Number(row.ts) || 0, sb: true, id: meta.id ? "sb-" + meta.id : "sb-dm-" + row.id };
  if (kind === "chat") m.text = row.text || "";
  else if (kind === "img") { m.url = row.url || ""; if (row.text) m.caption = row.text; }
  else { m.url = row.url || ""; m.dur = Number(row.dur) || 0; m.size = Number(row.size) || 0; }
  if (meta.rp) m.replyTo = meta.rp;
  return m;
}
async function sbDmFetchMsgs(peer, owner) {
  let rows = [];
  try { rows = await sbDmFetch(peer, owner); } catch (e) { rows = []; }
  return rows.map(sbDmRowToMsg).filter(Boolean);
}
// Stitch the mirror's messages into the server's copy. Server copies win on a
// shared timestamp because they carry the uid, caption and reply fields the
// mirror does not, and the whole thing comes back in chronological order.
function mergeDmMsgs(msgs, extra) {
  const list = Array.isArray(msgs) ? msgs.slice() : [];
  if (!Array.isArray(extra) || !extra.length) return list;
  const seen = new Set(list.map((m) => Number(m && m.ts) || 0));
  for (const m of extra) {
    if (!m || seen.has(Number(m.ts) || 0)) continue;
    seen.add(Number(m.ts) || 0);
    list.push(m);
  }
  return list.sort((x, y) => (Number(x.ts) || 0) - (Number(y.ts) || 0));
}
// The server hands over the newest DM_MSGS_MAX messages; this bolts the rest of
// the conversation on in front of them.
async function dmHistoryWithSupabase(peer, msgs, owner) {
  if (!SB_DM_ON) return Array.isArray(msgs) ? msgs.slice() : [];
  return mergeDmMsgs(msgs, await sbDmFetchMsgs(peer, owner));
}
// A rename changes the hash the mirror is keyed on, so the pair's rows have to
// be re-keyed or that conversation's scrollback is orphaned. Both sides' rows
// carry the same key, so patching by (type, author) moves the whole pair. Only
// the peers in the thread list are handled - those are the conversations this
// client can see and open.
async function sbRenameDmMirror(oldName, newName) {
  if (!SB_DM_ON || !oldName || !newName || oldName === newName) return;
  const peers = [...new Set((dmThreads || []).map((t) => t && t.peer).filter(Boolean))];
  for (const peer of peers) {
    const oldKey = await dmThreadKey(oldName, peer);
    const newKey = await dmThreadKey(newName, peer);
    if (oldKey === newKey) continue;
    try {
      await fetch(SB_URL + "/rest/v1/messages?type=eq." + oldKey + "&sender=eq." + encodeURIComponent(oldName), { method: "PATCH", headers: SB_H, body: JSON.stringify({ sender: newName }) });
      await fetch(SB_URL + "/rest/v1/messages?type=eq." + oldKey, { method: "PATCH", headers: SB_H, body: JSON.stringify({ type: newKey }) });
    } catch (e) {}
  }
}
// Self-healing backfill: a message sent before the mirror existed (or while it
// was briefly unreachable) is written the first time its author opens the
// thread. Only the author's own messages are written - the peer's client mirrors
// theirs - so this can never double-write a message that arrived from the other
// side. Best-effort like every other mirror write.
async function sbDmBackfill(peer, msgs, owner) {
  if (!SB_DM_ON || !peer || !Array.isArray(msgs) || !msgs.length) return;
  const me = owner || myName;
  let have = new Set();
  try { have = new Set((await sbDmFetchMsgs(peer, me)).map((m) => Number(m.ts) || 0)); } catch (e) { have = new Set(); }
  const key = await dmThreadKey(me, peer);
  const rows = [];
  for (const m of msgs) {
    if (!m || m.from !== me) continue;
    const ts = Number(m.ts) || 0;
    if (!ts || have.has(ts)) continue;
    have.add(ts);
    const sub = m.t === "img" || m.t === "voice" ? m.t : "chat";
    const row = {
      ts, sender: me, type: key, text: null, url: null, dur: null, size: null,
      reply_to: JSON.stringify(sbDmMeta(peer, { sub, id: m.id, replyTo: m.replyTo })), flagged: false
    };
    if (sub === "chat") row.text = String(m.text || "");
    else if (sub === "img") { row.url = String(m.url || ""); if (m.caption) row.text = String(m.caption); }
    else { row.url = String(m.url || ""); row.dur = Number(m.dur) || 0; row.size = Number(m.size) || 0; }
    rows.push(row);
  }
  if (!rows.length) return;
  try { await fetch(SB_URL + "/rest/v1/messages", { method: "POST", headers: SB_H, body: JSON.stringify(rows) }); } catch (e) {}
}
function sbDeleteDom(id) {
  for (const host of msgContainers()) {
    for (const n of [...host.children]) {
      if (n.dataset && n.dataset.id === id) {
        if (n.dataset.from && !wrapIsMine(n) && !isAdmin()) return false;
        if (n.dataset.ts && n.dataset.from) sbDeleteBy(n.dataset.ts, n.dataset.from);
        n.remove();
        return true;
      }
    }
  }
  return false;
}
function flagMsgDom(id) {
  for (const host of msgContainers()) {
    for (const n of [...host.children]) {
      if (n.dataset && n.dataset.id === id) {
        const bubble = n.querySelector(".bubble");
        const newState = bubble ? !bubble.classList.contains("flagged") : true;
        if (bubble) bubble.classList.toggle("flagged", newState);
        n.dataset.flagged = newState ? "1" : "0";
        if (n.dataset.ts && n.dataset.from) sbSetFlag(n.dataset.ts, n.dataset.from, newState);
        return newState;
      }
    }
  }
  return null;
}
// Clearing the room history must not touch the private-chat mirror: a clear is
// a room action, and the server's own clearAll preserves DMs too.
async function sbClearAll() { try { await fetch(SB_URL + "/rest/v1/messages?type=not.like.dm.*", { method: "DELETE", headers: SB_H }); } catch (e) {} }
function findMsgById(id) {
  for (const [w, mm] of msgByWrap) if (mm && String(mm.id) === String(id)) return mm;
  return null;
}
function findMsgDom(id, from, mts) {
  // Every conversation's rendered DOM, so a room-side delete still lands while
  // a private chat is covering the room (and vice versa).
  for (const host of msgContainers()) {
    for (const n of [...host.children]) {
      if (!n.dataset) continue;
      if (id && n.dataset.id === id) return n;
      if (from && mts != null && n.dataset.from === from && n.dataset.ts && Number(n.dataset.ts) === Number(mts)) return n;
    }
  }
  return null;
}
function enrichReply(m) {
  if (m && m.replyTo && m.replyTo.id) {
    const t = findMsgById(m.replyTo.id);
    if (t) {
      m.replyTo.from = t.from;
      m.replyTo.t = t.t || "chat";
      m.replyTo.text = t.text || "";
      m.replyTo.url = t.url || "";
      m.replyTo.dur = t.dur || 0;
      m.replyTo.size = t.size || 0;
    } else {
      // The quoted message isn't loaded (its row is on another page, or it was
      // only ever seen live) - fall back to the snapshot this browser kept in kv.
      const s = replyKvGet(m.replyTo.id);
      if (s) {
        m.replyTo.from = s.from;
        m.replyTo.t = s.t || "chat";
        m.replyTo.text = s.text || "";
        m.replyTo.url = s.url || "";
        m.replyTo.dur = s.dur || 0;
        m.replyTo.size = s.size || 0;
      }
    }
  }
  return m;
}
function sbRowToMsg(row) {
  const base = { id: "sb-" + row.id, from: row.sender, ts: row.ts, flagged: !!row.flagged };
  if (row.reply_to) base.replyTo = { id: String(row.reply_to) };
  if (row.type === "delnote") {
    const out = Object.assign(base, { t: "delnote" });
    if (row.text && String(row.text).indexOf("__deln__") === 0) {
      try {
        const p = JSON.parse(String(row.text).slice(8));
        // Newer rows wrap the original with the deleter's name; older ones are
        // the bare original.
        if (p && typeof p === "object" && ("o" in p || "b" in p)) {
          if (p.o) out.orig = p.o;
          if (p.b) out.by = String(p.b);
        } else if (p) out.orig = p;
      } catch (e) {}
    }
    return out;
  }
  if (row.type === "chat") return Object.assign(base, { t: "chat", text: row.text || "" });
  if (row.type === "img") return Object.assign(base, { t: "img", url: row.url || "", caption: row.text || undefined });
  if (row.type === "voice") return Object.assign(base, { t: "voice", url: row.url || "", dur: row.dur || 0, size: row.size || 0 });
  return null;
}

// ---------- incremental history loading ----------
// Only a few recent messages load on open (all unread ones plus the newest page),
// and older messages load progressively when the user scrolls up to the top.
const HISTORY_SEL = "id,ts,sender,type,text,url,dur,size,reply_to,flagged";
// Private-chat rows share this table, tagged "dm.<hash>" (see SB_DM_ON). Room
// queries must exclude them or a busy DM could starve the room's paging: a page
// of 25 rows would come back all-DM, leave nothing to render, and end the
// scrollback early.
const SB_ROOM_ONLY = "type=not.like.dm.*";
async function sbFetchRows(url) {
  let r = await fetch(url, { headers: SB_H }).then(r => r.json()).catch(() => null);
  if (!Array.isArray(r)) {
    r = await fetch(url.replace(HISTORY_SEL, "id,ts,sender,type,text,url,dur,size,reply_to"), { headers: SB_H }).then(r => r.json()).catch(() => null);
  }
  return Array.isArray(r) ? r : [];
}
function sbFetchOlder(cursorTs, limit) {
  let q = SB_URL + "/rest/v1/messages?select=" + HISTORY_SEL + "&" + SB_ROOM_ONLY + "&order=ts.desc&limit=" + limit;
  if (cursorTs) q += "&ts=lt." + cursorTs;
  return sbFetchRows(q);
}
function rowTs(row) { return Number(row && row.ts) || 0; }
function rowDomWorth(row) {
  if (row.type === "delnote") return true;
  if (row.type === "chat" && row.text && String(row.text).trim()) return true;
  if (row.type === "img" && row.url) return true;
  if (row.type === "voice" && row.url) return true;
  return false;
}
function showOlderLoader(on) {
  if (!olderLoader) return;
  olderLoader.classList.toggle("hide", !on);
}
function firstRealNode() {
  for (const n of roomMessagesEl.children) {
    if (n.id === "stickyDateWrap") continue;
    if (n.classList.contains("sep") || n.classList.contains("unreadBanner")) continue;
    return n;
  }
  return null;
}
function renderRowsInto(rows) {
  let count = 0;
  for (const row of rows) {
    try {
      const id = "sb-" + row.id;
      if (seenMsgIds.has(id)) continue;
      seenMsgIds.add(id);
      if (clearedAt && rowTs(row) <= clearedAt) continue;
      const m = enrichReply(sbRowToMsg(row));
      if (!m) continue;
      // A live copy of this message may already be on screen (it arrived while
      // the fetch was in flight, or it was drawn from the buffer). The row is
      // remembered above either way, so it can never be drawn twice.
      if (alreadyRendered(roomMessagesEl, m)) continue;
      addRoomMessageDom(m);
      count++;
    } catch (e) { console.error("render-sb-row", row.id, e); }
  }
  return count;
}
function prependRows(rows) {
  const frag = document.createDocumentFragment();
  const ref = firstRealNode();
  let prev = null;
  if (ref && ref.classList.contains("msg")) prev = msgByWrap.get(ref) || null;
  let count = 0;
  for (const row of rows) {
    const id = "sb-" + row.id;
    if (seenMsgIds.has(id)) continue;
    seenMsgIds.add(id);
    if (clearedAt && rowTs(row) <= clearedAt) continue;
    const m = enrichReply(sbRowToMsg(row));
    if (!m) continue;
    const grouped = !!(prev && prev.from === m.from);
    frag.appendChild(buildMessageDom(m, grouped));
    prev = m;
    count++;
  }
  if (!count) return 0;
  if (ref) roomMessagesEl.insertBefore(frag, ref);
  else roomMessagesEl.appendChild(frag);
  return count;
}
function maybeLoadOlder() {
  if (convo.mode !== "room") return;
  if (loadingOlder || allOlderLoaded || !oldestLoadedTs) return;
  if (scrollCtnEl.scrollTop < 150) loadOlder();
}
let olderFailures = 0;
async function loadOlder() {
  if (loadingOlder || allOlderLoaded) return;
  loadingOlder = true;
  showOlderLoader(true);
  const anchor = firstRealNode();
  const anchorTop = anchor ? anchor.getBoundingClientRect().top : null;
  const scrollTop = scrollCtnEl.scrollTop;
  try {
    const rows = await sbFetchOlder(oldestLoadedTs, OLDER_PAGE);
    if (!rows.length) { allOlderLoaded = true; return; }
    const minTs = Math.min.apply(null, rows.map(rowTs).filter((t) => t > 0));
    if (isFinite(minTs)) oldestLoadedTs = Math.min(oldestLoadedTs || Infinity, minTs);
    const real = rows.filter(rowDomWorth).reverse();
    let added = 0;
    if (real.length) added = prependRows(real);
    if (rows.length < OLDER_PAGE) allOlderLoaded = true;
    if (added === 0) allOlderLoaded = true;
    olderFailures = 0;
  } catch (e) {
    console.error("load-older", e);
    olderFailures++;
    if (olderFailures >= 3) allOlderLoaded = true;
  } finally {
    showOlderLoader(false);
    if (anchor && anchor.isConnected && anchorTop != null) {
      scrollCtnEl.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
    } else if (scrollTop != null) {
      scrollCtnEl.scrollTop = scrollTop;
    }
    if (scrollCtnEl.scrollTop < 150) scrollCtnEl.scrollTop = 150;
    loadingOlder = false;
  }
}
function flushHistoryBuffer() {
  if (!historyBuffer.length) return;
  const pending = historyBuffer;
  historyBuffer = [];
  // Anything that arrived live while the history was loading is drawn here -
  // unless the history render already drew it (`alreadyRendered`), which is the
  // normal case for a message the room's history store also has. The check is
  // made per message against the container as it is now, so it dedupes the
  // buffer against both the history rows and an earlier buffered copy, and it
  // only ever matches the same message (sender + timestamp), never a different
  // one that merely looks similar.
  for (const m of pending) {
    if (m.t !== "chat" && m.t !== "img" && m.t !== "voice") continue;
    if (alreadyRendered(roomMessagesEl, m)) continue;
    const wrap = addRoomMessageDom(m);
    if (wrap) translateRealtimeMessage(m, wrap);
  }
}
async function loadHistoryCore() {
  historyLoading = true;
  showOlderLoader(true);
  try {
    // 1) all unread messages (newest-first fetch, reversed to render oldest→newest)
    let unread = [];
    if (lastSeenAt) {
      let q = SB_URL + "/rest/v1/messages?select=" + HISTORY_SEL + "&" + SB_ROOM_ONLY + "&order=ts.desc&limit=2000&ts=gt." + lastSeenAt;
      unread = (await sbFetchRows(q)).filter(rowDomWorth).reverse();
    }
    // 2) the newest page (covers unread too). Render whichever set spans further back in time
    //    so the DOM stays in chronological order (oldest at top, newest at bottom).
    const latest = await sbFetchOlder(null, 40);
    if (latest.length) {
      const realLatest = latest.filter(rowDomWorth).reverse();
      const real = unread.length > realLatest.length ? unread : realLatest;
      renderRowsInto(real);
      const firstTs = real.map(rowTs).filter((t) => t > 0);
      if (!firstTs.length) { allOlderLoaded = true; }
      else oldestLoadedTs = Math.min.apply(null, firstTs);
      let totalRendered = roomMessagesEl.querySelectorAll(".msg").length;
      while (!allOlderLoaded && totalRendered < 40 && oldestLoadedTs) {
        const need = 40 - totalRendered;
        const more = await sbFetchOlder(oldestLoadedTs, need);
        if (!more.length) { allOlderLoaded = true; break; }
        const realMore = more.filter(rowDomWorth).reverse();
        if (!realMore.length) { allOlderLoaded = true; break; }
        const added = renderRowsInto(realMore);
        totalRendered = roomMessagesEl.querySelectorAll(".msg").length;
        oldestLoadedTs = Math.min(oldestLoadedTs, ...realMore.map(rowTs));
        if (added === 0 || more.length < need) { allOlderLoaded = true; break; }
      }
    } else {
      allOlderLoaded = true;
    }
  } catch (e) {
    allOlderLoaded = true;
    console.error("load-initial-history", e);
  }
  historyLoading = false;
  showOlderLoader(false);
  flushHistoryBuffer();
  reclassifyOwnership();
  if (translateOn) translateViewport();
  // The room row in a wide layout previews the newest room message.
  refreshListView();
}

async function loadInitialHistory() {
  if (historyLoaded) return;
  historyLoaded = true;
  await loadHistoryCore();
}

function reloadChatHistory() {
  if (historyLoading) return;
  // History renders into the room's container; if a private chat (or the people
  // screen) is up right now, remember to do it when the room comes back.
  if (convo.mode !== "room") { roomHistoryStale = true; return; }
  historyLoading = true;
  msgByWrapCleanup(roomMessagesEl);
  roomMessagesEl.textContent = "";
  seenMsgIds.clear();
  typers.clear();
  unreadCount = 0;
  unreadChipBtn.classList.add("hide");
  endSelection();
  historyLoaded = false;
  allOlderLoaded = false;
  oldestLoadedTs = null;
  loadHistoryCore();
}

function dmSend(payload) {
  if (!socket || socket.readyState !== 1 || convo.mode !== "dm") return;
  const peer = convo.peer;
  socket.send(JSON.stringify(Object.assign({ t: "dm", to: peer }, payload)));
  // Every outgoing private message is also mirrored to Supabase, so the thread
  // survives the server's 150-message cap (see SB_DM_ON). Edits and unsends are
  // mirrored from their own call sites; read/typing notices are not content and
  // are never stored anywhere.
  if (payload && payload.sub) sbDmMirrorSend(peer, payload);
}

function sendChat() {
  if (!interactionReady()) { tacModal.classList.remove("hide"); return; }
  const text = msgInput.textContent.trim().slice(0, MAX_TEXT);
  if (!socket || socket.readyState !== 1) return;
  const dm = convo.mode === "dm";
  if (editingMsg) {
    if (!text && editingMsg.t !== "img") { cancelEdit(); return; }
    // In a private chat the same edit goes to the thread instead of the room.
    if (dm) {
      dmSend({ ev: "edit", id: editingMsg.id, text, ts: editingMsg.ts || null, from: editingMsg.from || null });
      sbDmMirrorEdit(convo.peer, { ts: editingMsg.ts, text });
    }
    else socket.send(JSON.stringify({ t: "edit", id: editingMsg.id, text, ts: editingMsg.ts || null, from: editingMsg.from || null }));
    cancelEdit();
    msgInput.focus();
    return;
  }
  if (!text) return;
  dismissFirstMsgGuide();
  const ts = Date.now();
  rememberSentTs(ts);
  addUploadPlaceholder("text", { text, replyTo: replyToMsg });
  if (dm) {
    dmSend({ sub: "chat", text, replyTo: replyToMsg, ts });
  } else {
    socket.send(JSON.stringify({ t: "chat", text, replyTo: replyToMsg, ts }));
    // A room row is written with a room `type`. Private messages are mirrored
    // too, but under a "dm."-tagged row that the room's queries exclude (see
    // SB_DM_ON) - never as a room row.
    sbInsert({ ts, sender: myName, type: "chat", text, reply_to: replyToMsg ? String(replyToMsg.id || "") : null });
  }
  clearReply();
  hideMentionPop();
  msgInput.textContent = "";
  updateSendBtn();
  closeEmojiPanel();
  msgInput.focus();
}

function sendTyping() {
  const now = Date.now();
  if (now - lastTypingSent > 1500 && socket && socket.readyState === 1) {
    lastTypingSent = now;
    if (convo.mode === "dm") dmSend({ ev: "typing" });
    else if (convo.mode === "room") socket.send(JSON.stringify({ t: "typing" }));
  }
}

function updateSendBtn() {
  const has = msgInput.textContent.trim().length > 0;
  sendBtn.classList.toggle("hide", !has);
  micBtn.classList.toggle("hide", has);
}

// ---------- voice recording ----------
let recording = false;
let mr = null;
let recStream = null;
let recChunks = [];
let recStart = 0;
let recTimer = null;
let recElapsed = 0;

function fmtRec(sec) {
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const tenth = Math.floor((sec % 1) * 10);
  return m + ":" + String(s).padStart(2, "0") + "," + tenth;
}

function setComposeState() {
  field.classList.toggle("hide", recording);
  recBar.classList.toggle("hide", !recording);
  const showSend = recording || msgInput.textContent.trim().length > 0;
  sendBtn.classList.toggle("hide", !showSend);
  micBtn.classList.toggle("hide", showSend);
}

async function startRecording() {
  closeEmojiPanel();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast("Voice recording isn't supported in this browser");
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    toast("Microphone access was denied");
    return;
  }
  recStream = stream;
  recChunks = [];
  mr = new MediaRecorder(stream);
  mr.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
  mr.start();
  recStart = Date.now();
  recording = true;
  setComposeState();
  recTime.textContent = "0:00,0";
  recTimer = setInterval(() => {
    recTime.textContent = fmtRec((Date.now() - recStart) / 1000);
  }, 100);
}

function stopRecording() {
  clearInterval(recTimer);
  recTimer = null;
  recElapsed = (Date.now() - recStart) / 1000;
  recording = false;
  setComposeState();
  const m = mr;
  mr = null;
  const tracks = recStream ? recStream.getTracks() : [];
  const done = m && m.state !== "inactive"
    ? new Promise((resolve) => {
        m.onstop = () => {
          const blob = new Blob(recChunks, { type: String(m.mimeType || "audio/webm").split(";")[0] });
          recChunks = [];
          resolve(blob);
        };
        m.stop();
      })
    : Promise.resolve(null);
  tracks.forEach((t) => t.stop());
  recStream = null;
  return done;
}

async function sendVoice() {
  const blob = await stopRecording();
  if (!blob || !blob.size || !socket || socket.readyState !== 1) return;
  const dur = Math.round(recElapsed * 10) / 10;
  const ph = addUploadPlaceholder("voice");
  try {
    const { url, error } = await root.uploadPlugin(blob);
    if (error || !url) { removeUploadPlaceholder(ph); toast("Upload failed: " + (error || "unknown error")); return; }
    const vts = Date.now();
    rememberSentTs(vts);
    if (convo.mode === "dm") {
      dmSend({ sub: "voice", url, dur, size: blob.size, replyTo: replyToMsg, ts: vts });
    } else {
      socket.send(JSON.stringify({ t: "voice", url, dur, size: blob.size, replyTo: replyToMsg, ts: vts }));
      sbInsert({ ts: vts, sender: myName, type: "voice", url, dur, size: blob.size, reply_to: replyToMsg ? String(replyToMsg.id || "") : null });
    }
    clearReply();
  } catch (e) {
    removeUploadPlaceholder(ph);
    toast("Upload failed.");
  }
}

// ---------- image sending ----------
function resizeImage(file, maxDim = 1280, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const cv = document.createElement("canvas");
      cv.width = w;
      cv.height = h;
      cv.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("load")); };
    img.src = url;
  });
}

function scheduleReconnect(s) {
  if (s._reconnectDone) return;
  s._reconnectDone = true;
  setTimeout(connect, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 15000);
}

function forceCleanReconnect() {
  if (!socket) return;
  if (socket.readyState === 1) { try { socket.close(); } catch (e) {} }
  setTimeout(() => {
    if (socket && socket.readyState !== 1 && !socket._reconnectDone) scheduleReconnect(socket);
  }, 700);
}

function silentAutoLoginRetry(s, loc, delay) {
  const d = delay || 4000;
  setTimeout(async () => {
    if (regionBlocked || vpnBlocked || savedNickApplied || !savedNick) return;
    if (false) return; // persistence: protected names stay logged in with saved password
    if (needsPass(savedNick) && !savedAdminPass) { promptNickReentry(); return; }
    if (!s || s !== socket || s.readyState !== 1) return;
    let r = null;
    try {
      const payload = JSON.stringify({ name: savedNick, uid: myUid, ...(needsPass(savedNick) && savedAdminPass ? { password: savedAdminPass } : {}), loc: loc || "" });
      r = await s.rpc.setName(payload);
    } catch (e) { r = null; }
    if (r === "ok") {
      myName = savedNick;
      savedNickApplied = true;
      joinedOnce = true;
      reclassifyOwnership();
      updateGate();
      persistNick(savedNick, needsPass(savedNick) ? savedAdminPass : "");
      if (savedNick === "admin") addAdminActionButtons();
      vpnModal.classList.add("hide");
      return;
    }
    if (r === "banned") { showBannedModal(); return; }
    if (r === "name_taken") { const taken = savedNick; savedNick = ""; lsSet(nickKvKey, ""); showNameTaken(taken); return; }
    if (r === "wrong_password") { if (needsPass(savedNick)) promptNickReentry(); return; }
    if (r === "unavailable_region") { showRegionBlocked(); return; }
    if (r === "vpn_blocked") { showVpnBlocked(); return; }

    silentAutoLoginRetry(s, loc, Math.min(d * 1.7, 30000));
  }, d);
}
window.addEventListener("pageshow", (e) => { if (e.persisted) forceCleanReconnect(); });
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && socket && socket.readyState !== 1 && !socket._reconnectDone) scheduleReconnect(socket);
});

let myLocPromise = null;
let myCountry = "";
const VPN_HINT_WORDS = [
  "vpn", "proxy", "nord", "surfshark", "expressvpn", "private internet access", "cyberghost",
  "windscribe", "mullvad", "vyprvpn", "purevpn", "hotspot shield", "tunnelbear", "betternet",
  "hide.me", "ivpn", "proton", "atlas vpn", "ipvanish", "hidemyass",
  "m247", "datacamp", "datapacket", "leaseweb", "ovh", "hetzner", "digitalocean", "linode",
  "vultr", "contabo", "choopa", "psychz", "quadranet", "scaleway", "cloudsigma", "ionos",
  "hostinger", "hosting", "data center", "datacenter", "colo", "cloud", "amazonaws", "azure"
];
function detectVpn(d) {
  if (!d) return false;
  const sec = d.security || {};
  if (sec.vpn || sec.proxy || sec.tor || sec.anonymous || sec.relay) return true;
  const conn = d.connection || {};
  if (conn.type === "hosting") return true;
  const org = String(conn.org || conn.isp || "").toLowerCase();
  return !!org && VPN_HINT_WORDS.some((w) => org.includes(w));
}
async function fetchJsonTimeout(url, ms, asText) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return asText ? await r.text() : await r.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
function geoCountryName(code) {
  if (!code) return "";
  if (/^[A-Za-z]{2}$/.test(code)) {
    try {
      const n = new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase());
      if (n && n !== code) return n;
    } catch (e) {}
  }
  return code;
}
const GEO_CACHE_KEY = "tgGeo_" + (window.generatorName || "chat");
const GEO_TTL = 6 * 60 * 60 * 1000;
// Several free IP-geolocation services are tried in turn: each returns
// { country, city, region, vpn } or null. A single provider being
// rate-limited/CORS-blocked used to leave every user with an empty location.
const GEO_PROVIDERS = [
  async () => {
    const d = await fetchJsonTimeout("https://get.geojs.io/v1/ip/geo.json", 5000);
    if (!d || (!d.country && !d.country_code)) return null;
    return { country: d.country || geoCountryName(d.country_code), city: d.city, region: d.region, vpn: false };
  },
  async () => {
    const d = await fetchJsonTimeout("https://ipinfo.io/json", 5000);
    if (!d || d.error) return null;
    return { country: geoCountryName(d.country), city: d.city, region: d.region, vpn: false };
  },
  async () => {
    const d = await fetchJsonTimeout("https://api.db-ip.com/v2/free/self", 5000);
    if (!d || (!d.countryName && !d.countryCode)) return null;
    return { country: d.countryName || geoCountryName(d.countryCode), city: d.city, region: d.stateProv, vpn: false };
  },
  async () => {
    const d = await fetchJsonTimeout("https://ipwho.is/", 5000);
    if (!d || d.success === false) return null;
    return { country: d.country, city: d.city, region: d.region, vpn: detectVpn(d) };
  },
  async () => {
    const d = await fetchJsonTimeout("https://api.country.is", 5000);
    if (!d || !d.country) return null;
    return { country: geoCountryName(d.country), city: "", region: "", vpn: false };
  },
  async () => {
    const t = await fetchJsonTimeout("https://1.1.1.1/cdn-cgi/trace", 5000, true);
    const cc = t && (t.match(/^loc=([A-Za-z]{2})$/m) || [])[1];
    if (!cc) return null;
    return { country: geoCountryName(cc), city: "", region: "", vpn: false };
  },
];
function geoFromCache() {
  try {
    const o = JSON.parse(lsGet(GEO_CACHE_KEY) || "");
    if (!o || !o.ts || Date.now() - o.ts > GEO_TTL) return null;
    return o;
  } catch (e) {
    return null;
  }
}
async function resolveGeo() {
  const cached = geoFromCache();
  if (cached) {
    myCountry = cached.country || "";
    return cached.loc || "";
  }
  for (const provider of GEO_PROVIDERS) {
    try {
      const g = await provider();
      if (g && g.country) {
        myCountry = String(g.country);
        const loc = [g.city, g.region, g.country].filter(Boolean).join(", ") + (g.vpn ? " \u26A0VPN" : "");
        try { lsSet(GEO_CACHE_KEY, JSON.stringify({ ts: Date.now(), country: myCountry, loc })); } catch (e) {}
        return loc;
      }
    } catch (e) {}
  }
  return "";
}
function getMyIPLocation() {
  if (!myLocPromise) myLocPromise = resolveGeo().catch(() => "");
  return myLocPromise;
}

let historyLoaded = false;
let historyLoading = false;
let historyBuffer = [];
const OLDER_PAGE = 25;
const olderLoader = document.getElementById("olderLoader");
let loadingOlder = false;
let allOlderLoaded = false;
let oldestLoadedTs = null;
const seenMsgIds = new Set();

function connect() {
  // Exactly one live socket at a time. A reconnect replaces the previous socket
  // rather than leaving it behind - and silences it first, so its own close
  // handler cannot schedule yet another connection. Two live sockets would both
  // be subscribed to the room, so every new message would be delivered (and
  // drawn) twice.
  const previous = socket;
  if (previous) {
    previous._reconnectDone = true;
    try { if (previous.readyState === 0 || previous.readyState === 1) previous.close(1000, "replaced"); } catch (e) {}
  }
  const s = root.createServerSocket();
  socket = s;
  savedNickApplied = false;
  let currentApplied = false;
  let bannedOnConnect = false;

  s.addEventListener("open", async () => {
    reconnectDelay = 500;
    try {
      const loc = await getMyIPLocation();
      try { s.rpc.reportLoc(loc).catch(() => {}); } catch (e) {}
      await ensureKvNick();
      if (savedNick && needsPass(savedNick) && !savedAdminPass) promptNickReentry();
      if (savedNick && !currentApplied && !(needsPass(savedNick) && !savedAdminPass)) {
        currentApplied = true;
        let r = null;
        for (let attempt = 0; attempt < 2 && r !== "ok" && r !== "banned" && r !== "wrong_password" && r !== "name_taken"; attempt++) {
          try {
            const payload = JSON.stringify({ name: savedNick, uid: myUid, ...(needsPass(savedNick) && savedAdminPass ? { password: savedAdminPass } : {}), loc });
            r = await s.rpc.setName(payload);
          } catch (err) { r = null; }
          if (r !== "ok" && r !== "banned" && r !== "wrong_password" && r !== "name_taken") await new Promise((res) => setTimeout(res, 500));
        }
        if (r === "ok") {
          myName = savedNick;
          savedNickApplied = true;
          joinedOnce = true;
          reclassifyOwnership();
          updateGate();
          persistNick(savedNick, needsPass(savedNick) ? savedAdminPass : "");
          if (savedNick === "admin") addAdminActionButtons();
          vpnModal.classList.add("hide");
        }
        if (r === "banned") { bannedOnConnect = true; showBannedModal(); }
        else if (r === "unavailable_region") { showRegionBlocked(); }
        else if (r === "vpn_blocked") { showVpnBlocked(); }
        else if (r === "wrong_password") { if (needsPass(savedNick)) promptNickReentry(); }

        else if (r === "name_taken") { const taken = savedNick; savedNick = ""; lsSet(nickKvKey, ""); showNameTaken(taken); }
        else if (savedNick && r !== "ok" && !savedNickApplied) silentAutoLoginRetry(s, loc);
      }
      if (!savedNickApplied && !savedNick && !joinedOnce && tacAgreed && ageApproved && !bannedOnConnect && !vpnBlocked) forceNick();
      await replyKvEnsure();
      // Pull the room's profile pictures before the first message render so
      // avatars appear painted (no initial-letter flash).
      try {
        const pf = JSON.parse(await s.rpc.getPfps(""));
        if (pf && typeof pf === "object") {
          for (const k of Object.keys(pf)) {
            const u = String(pf[k] || "");
            if (k && u) pfpMap[k] = u;
          }
          savePfpMap();
          refreshAvatars();
        }
      } catch (e) {}
      await reloadChatHistory();
      try {
        const b = JSON.parse(await s.rpc.getBanned(""));
        if (Array.isArray(b)) for (const n of b) bannedNames.add(n);
      } catch (e) {}
      loadReactions();
      loadPinned();
      if (translateOn) retranslateAll();
      if (isAdmin()) addAdminActionButtons();
      const t = await s.rpc.getTitle("");
      if (t) setRoomTitle(t);
      const ic = await s.rpc.getIcon("");
      if (ic) applyIcon(ic);
      const v = await s.rpc.getVerified("");
      try {
        const varr = JSON.parse(v);
        if (Array.isArray(varr)) { verifiedSet.clear(); for (const n of varr) verifiedSet.add(n); refreshVerifiedUI(); }
      } catch (e) {}
      // Seed the private-chat list and its unread badge straight away, rather
      // than waiting for the people screen to be opened.
      refreshPeople();
      applyHeader();
    } catch (e) {}
    unreadCount = addNewMsgsBanner();
    if (unreadCount) {
      showUnreadChip(unreadCount);
      if (!scrollToNewBanner(false)) scrollBottom(true);
    } else {
      scrollBottom(true);
    }
    if (interactionReady()) msgInput.focus();
  });

  s.addEventListener("message", (e) => {
    try { handleMessage(JSON.parse(e.data)); } catch (e) {}
  });

  s.addEventListener("close", (ev) => {
    onlineSub.textContent = "offline";
    if (ev.code === 4403) return;
    scheduleReconnect(s);
  });

  s.opened.catch(() => {
    onlineSub.textContent = "offline";
    scheduleReconnect(s);
  });
}

sendBtn.addEventListener("click", () => { if (recording) sendVoice(); else sendChat(); });
msgInput.addEventListener("keydown", (e) => {
  if (!mentionPop.classList.contains("hide")) {
    if (e.key === "ArrowDown") { e.preventDefault(); if (mentionFiltered.length) { mentionIdx = (mentionIdx + 1) % mentionFiltered.length; highlightMentionRow(); } }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (mentionFiltered.length) { mentionIdx = (mentionIdx - 1 + mentionFiltered.length) % mentionFiltered.length; highlightMentionRow(); } }
    else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); if (mentionFiltered[mentionIdx]) selectMention(mentionFiltered[mentionIdx]); }
    else if (e.key === "Escape") { e.preventDefault(); hideMentionPop(); }
    return;
  }
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
});
msgInput.addEventListener("input", () => { normalizeMsgInput(); updateSendBtn(); sendTyping(); updateMentionPopup(); });
msgInput.addEventListener("keyup", saveMsgSelection);
msgInput.addEventListener("click", saveMsgSelection);
document.addEventListener("selectionchange", saveMsgSelection);
function isGifUrlText(url) {
  return /^https?:\/\/.+\.(gif|webp)(\?|$)/i.test(url) || /(tenor\.com|giphy\.com|media[0-9]*\.giphy|cataas\.com)/i.test(url);
}
msgInput.addEventListener("paste", (e) => {
  const cd = e.clipboardData;
  if (!cd) return;
  const hasImage = [...cd.items].some((i) => i.type && i.type.startsWith("image/"));
  if (hasImage) return;
  const text = cd.getData("text/plain") || "";
  const url = text.trim().split(/\s+/)[0] || "";
  if (isGifUrlText(url)) {
    e.preventDefault();
    openGifUrlForSend(url);
    return;
  }
  if (!text) return;
  e.preventDefault();
  insertTextAtCaret(text);
});
micBtn.addEventListener("click", startRecording);
recCancelBtn.addEventListener("click", () => { stopRecording(); });

async function openImageForSend(file) {
  if (!file) return;
  let blob;
  if (file.type === "image/gif") {
    if (file.size > 4.5 * 1024 * 1024) { toast("GIF too large (max 4.5 MB)"); return; }
    blob = file;
  } else {
    try {
      blob = await resizeImage(file);
    } catch (e) {
      toast("Couldn't read that image.");
      return;
    }
  }
  pendingImgBlob = blob;
  pendingGifUrl = null;
  capImg.src = URL.createObjectURL(blob);
  capInput.value = "";
  captionModal.classList.remove("hide");
  capInput.focus();
}

function openGifUrlForSend(url) {
  if (!url) return;
  pendingGifUrl = String(url).trim().slice(0, 500);
  pendingImgBlob = null;
  capImg.src = pendingGifUrl;
  capInput.value = "";
  captionModal.classList.remove("hide");
  capInput.focus();
}

attachBtn.addEventListener("click", () => imgInput.click());
imgInput.addEventListener("change", () => {
  const file = imgInput.files[0];
  imgInput.value = "";
  openImageForSend(file);
});
document.addEventListener("paste", (e) => {
  if (!e.clipboardData) return;
  if (!captionModal.classList.contains("hide") || !nickModal.classList.contains("hide")) return;
  const imageItem = [...e.clipboardData.items].find((i) => i.type && i.type.startsWith("image/"));
  if (imageItem) {
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (file) openImageForSend(file);
    return;
  }
  const text = e.clipboardData.getData("text/uri-list") || e.clipboardData.getData("text/plain") || "";
  const url = text.trim().split(/\s+/)[0] || "";
  if (url && isGifUrlText(url)) {
    e.preventDefault();
    openGifUrlForSend(url);
    return;
  }
});
capCancelBtn.addEventListener("click", () => {
  if (pendingImgBlob) { URL.revokeObjectURL(capImg.src); pendingImgBlob = null; }
  pendingGifUrl = null;
  capImg.src = "";
  captionModal.classList.add("hide");
});
capInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); capSendBtn.click(); }
});
capSendBtn.addEventListener("click", async () => {
  const blob = pendingImgBlob;
  const gifUrl = pendingGifUrl;
  if (!blob && !gifUrl) return;
  if (!socket || socket.readyState !== 1) {
    toast("Not connected yet — try again in a moment");
    return;
  }
  const caption = capInput.value.trim().slice(0, 300);
  pendingImgBlob = null;
  pendingGifUrl = null;
  URL.revokeObjectURL(capImg.src);
  capImg.src = "";
  captionModal.classList.add("hide");
  if (gifUrl) {
    const m = { t: "img", url: gifUrl, replyTo: replyToMsg };
    if (caption) m.caption = caption;
    m.ts = Date.now();
    rememberSentTs(m.ts);
    if (convo.mode === "dm") {
      dmSend({ sub: "img", url: gifUrl, caption: caption || undefined, replyTo: replyToMsg, ts: m.ts });
    } else {
      socket.send(JSON.stringify(m));
      sbInsert({ ts: m.ts, sender: myName, type: "img", url: gifUrl, text: caption || null, reply_to: replyToMsg ? String(replyToMsg.id || "") : null });
    }
    clearReply();
    updateSendBtn();
    return;
  }
  const ph = addUploadPlaceholder("img");
  try {
    const { url, error } = await Promise.race([
      root.uploadPlugin(blob),
      new Promise((_, reject) => setTimeout(() => reject(new Error("upload timeout")), 30000))
    ]);
    if (error || !url) { removeUploadPlaceholder(ph); toast("Upload failed: " + (error || "unknown error")); return; }
    const m = { t: "img", url, replyTo: replyToMsg };
    if (caption) m.caption = caption;
    m.ts = Date.now();
    rememberSentTs(m.ts);
    if (convo.mode === "dm") {
      dmSend({ sub: "img", url, caption: caption || undefined, replyTo: replyToMsg, ts: m.ts });
    } else {
      socket.send(JSON.stringify(m));
      sbInsert({ ts: m.ts, sender: myName, type: "img", url, text: caption || null, reply_to: replyToMsg ? String(replyToMsg.id || "") : null });
    }
    clearReply();
  } catch (e) {
    removeUploadPlaceholder(ph);
    toast("Upload failed. Check your connection and try again.");
  }
});

/* ================= custom emoji keyboard ================= */
const emojiPanel = document.getElementById("emojiPanel");
const emojiTabsEl = document.getElementById("emojiTabs");
const emojiGridEl = document.getElementById("emojiGrid");
const emojiScroll = document.getElementById("emojiScroll");

const EMOJI_CATS = [
  { id: "recents", icon: "🕘", name: "Recents" },
  { id: "smileys", icon: "😀", name: "Smileys & Emotion" },
  { id: "people", icon: "🧑", name: "People & Body" },
  { id: "animals", icon: "🐶", name: "Animals & Nature" },
  { id: "food", icon: "🍕", name: "Food & Drink" },
  { id: "activity", icon: "⚽", name: "Activities" },
  { id: "travel", icon: "✈️", name: "Travel & Places" },
  { id: "objects", icon: "💡", name: "Objects" },
  { id: "symbols", icon: "❤️", name: "Symbols" },
  { id: "flags", icon: "🏁", name: "Flags" }
];

const EMOJI_MAP = {
  smileys: "😀😃😄😁😆😅🤣😂🙂🙃🫠😉😊😇🥰😍🤩😘😗☺️😚😙🥲😋😛😜🤪😝🤑🤗🤭🫢🫣🤫🤔🫡🤐🤨😐😑😶🫥😶‍🌫️😏😒🙄😬😮‍💨🤥🫨🙂‍↔️🙂‍↕️😌😔😪🤤😴🫩😷🤒🤕🤢🤮🤧🥵🥶🥴😵😵‍💫🤯🤠🥳🥸😎🤓🧐😕🫤😟🙁☹️😮😯😲😳🫪🥺🥹😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬😈👿💀☠️💩🤡👹👺👻👽👾🤖😺😸😹😻😼😽🙀😿😾🙈🙉🙊💌💘💝💖💗💓💞💕💟❣️💔❤️‍🔥❤️‍🩹❤️🩷🧡💛💚💙🩵💜🤎🖤🩶🤍💋💯💢🫯💥💫💦💨🕳️💬👁️‍🗨️🗨️🗯️💭💤",
  people: "👋🤚🖐️✋🖖🫱🫲🫳🫴🫷🫸👌🤌🤏✌️🤞🫰🤟🤘🤙👈👉👆🖕👇☝️🫵👍👎✊👊🤛🤜👏🙌🫶👐🤲🤝🙏✍️💅🤳💪🦾🦿🦵🦶👂🦻👃🧠🫀🫁🦷🦴👀👁️👅👄🫦👶🧒👦👧🧑👱👨🧔🧔‍♂️🧔‍♀️👨‍🦰👨‍🦱👨‍🦳👨‍🦲👩👩‍🦰🧑‍🦰👩‍🦱🧑‍🦱👩‍🦳🧑‍🦳👩‍🦲🧑‍🦲👱‍♀️👱‍♂️🧓👴👵🙍🙍‍♂️🙍‍♀️🙎🙎‍♂️🙎‍♀️🙅🙅‍♂️🙅‍♀️🙆🙆‍♂️🙆‍♀️💁💁‍♂️💁‍♀️🙋🙋‍♂️🙋‍♀️🧏🧏‍♂️🧏‍♀️🙇🙇‍♂️🙇‍♀️🤦🤦‍♂️🤦‍♀️🤷🤷‍♂️🤷‍♀️🧑‍⚕️👨‍⚕️👩‍⚕️🧑‍🎓👨‍🎓👩‍🎓🧑‍🏫👨‍🏫👩‍🏫🧑‍⚖️👨‍⚖️👩‍⚖️🧑‍🌾👨‍🌾👩‍🌾🧑‍🍳👨‍🍳👩‍🍳🧑‍🔧👨‍🔧👩‍🔧🧑‍🏭👨‍🏭👩‍🏭🧑‍💼👨‍💼👩‍💼🧑‍🔬👨‍🔬👩‍🔬🧑‍💻👨‍💻👩‍💻🧑‍🎤👨‍🎤👩‍🎤🧑‍🎨👨‍🎨👩‍🎨🧑‍✈️👨‍✈️👩‍✈️🧑‍🚀👨‍🚀👩‍🚀🧑‍🚒👨‍🚒👩‍🚒👮👮‍♂️👮‍♀️🕵️🕵️‍♂️🕵️‍♀️💂💂‍♂️💂‍♀️🥷👷👷‍♂️👷‍♀️🫅🤴👸👳👳‍♂️👳‍♀️👲🧕🤵🤵‍♂️🤵‍♀️👰👰‍♂️👰‍♀️🤰🫃🫄🤱👩‍🍼👨‍🍼🧑‍🍼👼🎅🤶🧑‍🎄🦸🦸‍♂️🦸‍♀️🦹🦹‍♂️🦹‍♀️🧙🧙‍♂️🧙‍♀️🧚🧚‍♂️🧚‍♀️🧛🧛‍♂️🧛‍♀️🧜🧜‍♂️🧜‍♀️🧝🧝‍♂️🧝‍♀️🧞🧞‍♂️🧞‍♀️🧟🧟‍♂️🧟‍♀️🧌🫈💆💆‍♂️💆‍♀️💇💇‍♂️💇‍♀️🚶🚶‍♂️🚶‍♀️🚶‍➡️🚶‍♀️‍➡️🚶‍♂️‍➡️🧍🧍‍♂️🧍‍♀️🧎🧎‍♂️🧎‍♀️🧎‍➡️🧎‍♀️‍➡️🧎‍♂️‍➡️🧑‍🦯🧑‍🦯‍➡️👨‍🦯👨‍🦯‍➡️👩‍🦯👩‍🦯‍➡️🧑‍🦼🧑‍🦼‍➡️👨‍🦼👨‍🦼‍➡️👩‍🦼👩‍🦼‍➡️🧑‍🦽🧑‍🦽‍➡️👨‍🦽👨‍🦽‍➡️👩‍🦽👩‍🦽‍➡️🏃🏃‍♂️🏃‍♀️🏃‍➡️🏃‍♀️‍➡️🏃‍♂️‍➡️🧑‍🩰💃🕺🕴️👯👯‍♂️👯‍♀️🧖🧖‍♂️🧖‍♀️🧗🧗‍♂️🧗‍♀️🤺🏇⛷️🏂🏌️🏌️‍♂️🏌️‍♀️🏄🏄‍♂️🏄‍♀️🚣🚣‍♂️🚣‍♀️🏊🏊‍♂️🏊‍♀️⛹️⛹️‍♂️⛹️‍♀️🏋️🏋️‍♂️🏋️‍♀️🚴🚴‍♂️🚴‍♀️🚵🚵‍♂️🚵‍♀️🤸🤸‍♂️🤸‍♀️🤼🤼‍♂️🤼‍♀️🤽🤽‍♂️🤽‍♀️🤾🤾‍♂️🤾‍♀️🤹🤹‍♂️🤹‍♀️🧘🧘‍♂️🧘‍♀️🛀🛌🧑‍🤝‍🧑👭👫👬💏👩‍❤️‍💋‍👨👨‍❤️‍💋‍👨👩‍❤️‍💋‍👩💑👩‍❤️‍👨👨‍❤️‍👨👩‍❤️‍👩👨‍👩‍👦👨‍👩‍👧👨‍👩‍👧‍👦👨‍👩‍👦‍👦👨‍👩‍👧‍👧👨‍👨‍👦👨‍👨‍👧👨‍👨‍👧‍👦👨‍👨‍👦‍👦👨‍👨‍👧‍👧👩‍👩‍👦👩‍👩‍👧👩‍👩‍👧‍👦👩‍👩‍👦‍👦👩‍👩‍👧‍👧👨‍👦👨‍👦‍👦👨‍👧👨‍👧‍👦👨‍👧‍👧👩‍👦👩‍👦‍👦👩‍👧👩‍👧‍👦👩‍👧‍👧🗣️👤👥🫂👪🧑‍🧑‍🧒🧑‍🧑‍🧒‍🧒🧑‍🧒🧑‍🧒‍🧒👣🫆",
  animals: "🐵🐒🦍🦧🐶🐕🦮🐕‍🦺🐩🐺🦊🦝🐱🐈🐈‍⬛🦁🐯🐅🐆🐴🫎🫏🐎🦄🦓🦌🦬🐮🐂🐃🐄🐷🐖🐗🐽🐏🐑🐐🐪🐫🦙🦒🐘🦣🦏🦛🐭🐁🐀🐹🐰🐇🐿️🦫🦔🦇🐻🐻‍❄️🐨🐼🦥🦦🦨🦘🦡🐾🦃🐔🐓🐣🐤🐥🐦🐧🕊️🦅🦆🦢🦉🦤🪶🦩🦚🦜🪽🐦‍⬛🪿🐦‍🔥🐸🐊🐢🦎🐍🐲🐉🦕🦖🐳🐋🐬🫍🦭🐟🐠🐡🦈🐙🐚🪸🪼🦀🦞🦐🦑🦪🐌🦋🐛🐜🐝🪲🐞🦗🪳🕷️🕸️🦂🦟🪰🪱🦠💐🌸💮🪷🏵️🌹🥀🌺🌻🌼🌷🪻🌱🪴🌲🌳🌴🌵🌾🌿☘️🍀🍁🍂🍃🪹🪺🍄🪾",
  food: "🍇🍈🍉🍊🍋🍋‍🟩🍌🍍🥭🍎🍏🍐🍑🍒🍓🫐🥝🍅🫒🥥🥑🍆🥔🥕🌽🌶️🫑🥒🥬🥦🧄🧅🥜🫘🌰🫚🫛🍄‍🟫🫜🍞🥐🥖🫓🥨🥯🥞🧇🧀🍖🍗🥩🥓🍔🍟🍕🌭🥪🌮🌯🫔🥙🧆🥚🍳🥘🍲🫕🥣🥗🍿🧈🧂🥫🍱🍘🍙🍚🍛🍜🍝🍠🍢🍣🍤🍥🥮🍡🥟🥠🥡🍦🍧🍨🍩🍪🎂🍰🧁🥧🍫🍬🍭🍮🍯🍼🥛☕🫖🍵🍶🍾🍷🍸🍹🍺🍻🥂🥃🫗🥤🧋🧃🧉🧊🥢🍽️🍴🥄🔪🫙🏺",
  activity: "🎃🎄🎆🎇🧨✨🎈🎉🎊🎋🎍🎎🎏🎐🎑🧧🎀🎁🎗️🎟️🎫🎖️🏆🏅🥇🥈🥉⚽⚾🥎🏀🏐🏈🏉🎾🥏🎳🏏🏑🏒🥍🏓🏸🥊🥋🥅⛳⛸️🎣🤿🎽🎿🛷🥌🎯🪀🪁🔫🎱🔮🪄🎮🕹️🎰🎲🧩🧸🪅🪩🪆♠️♥️♦️♣️♟️🃏🀄🎴🎭🖼️🎨🧵🪡🧶🪢",
  travel: "🌍🌎🌏🌐🗺️🗾🧭🏔️⛰️🛘🌋🗻🏕️🏖️🏜️🏝️🏞️🏟️🏛️🏗️🧱🪨🪵🛖🏘️🏚️🏠🏡🏢🏣🏤🏥🏦🏨🏩🏪🏫🏬🏭🏯🏰💒🗼🗽⛪🕌🛕🕍⛩️🕋⛲⛺🌁🌃🏙️🌄🌅🌆🌇🌉♨️🎠🛝🎡🎢💈🎪🚂🚃🚄🚅🚆🚇🚈🚉🚊🚝🚞🚋🚌🚍🚎🚐🚑🚒🚓🚔🚕🚖🚗🚘🚙🛻🚚🚛🚜🏎️🏍️🛵🦽🦼🛺🚲🛴🛹🛼🚏🛣️🛤️🛢️⛽🛞🚨🚥🚦🛑🚧⚓🛟⛵🛶🚤🛳️⛴️🛥️🚢✈️🛩️🛫🛬🪂💺🚁🚟🚠🚡🛰️🚀🛸🛎️🧳⌛⏳⌚⏰⏱️⏲️🕰️🕛🕧🕐🕜🕑🕝🕒🕞🕓🕟🕔🕠🕕🕡🕖🕢🕗🕣🕘🕤🕙🕥🕚🕦🌑🌒🌓🌔🌕🌖🌗🌘🌙🌚🌛🌜🌡️☀️🌝🌞🪐⭐🌟🌠🌌☁️⛅⛈️🌤️🌥️🌦️🌧️🌨️🌩️🌪️🌫️🌬️🌀🌈🌂☂️☔⛱️⚡❄️☃️⛄☄️🔥💧🌊",
  objects: "👓🕶️🥽🥼🦺👔👕👖🧣🧤🧥🧦👗👘🥻🩱🩲🩳👙👚🪭👛👜👝🛍️🎒🩴👞👟🥾🥿👠👡🩰👢🪮👑👒🎩🎓🧢🪖⛑️📿💄💍💎🔇🔈🔉🔊📢📣📯🔔🔕🎼🎵🎶🎙️🎚️🎛️🎤🎧📻🎷🎺🪊🪗🎸🎹🎻🪕🥁🪘🪇🪈🪉📱📲☎️📞📟📠🔋🪫🔌💻🖥️🖨️⌨️🖱️🖲️💽💾💿📀🧮🎥🎞️📽️🎬📺📷📸📹📼🔍🔎🕯️💡🔦🏮🪔📔📕📖📗📘📙📚📓📒📃📜📄📰🗞️📑🔖🏷️🪙💰🪎💴💵💶💷💸💳🧾💹✉️📧📨📩📤📥📦📫📪📬📭📮🗳️✏️✒️🖋️🖊️🖌️🖍️📝💼📁📂🗂️📅📆🗒️🗓️📇📈📉📊📋📌📍📎🖇️📏📐✂️🗃️🗄️🗑️🔒🔓🔏🔐🔑🗝️🔨🪓⛏️⚒️🛠️🗡️⚔️💣🪃🏹🛡️🪚🔧🪛🔩⚙️🗜️⚖️🦯🔗⛓️‍💥⛓️🪝🧰🧲🪜🪏⚗️🧪🧫🧬🔬🔭📡💉🩸💊🩹🩼🩺🩻🚪🛗🪞🪟🛏️🛋️🪑🚽🪠🚿🛁🪤🪒🧴🧷🧹🧺🧻🪣🧼🫧🪥🧽🧯🛒🚬⚰️🪦⚱️🧿🪬🗿🪧🪪",
  symbols: "🏧🚮🚰♿🚹🚺🚻🚼🚾🛂🛃🛄🛅⚠️🚸⛔🚫🚳🚭🚯🚱🚷📵🔞☢️☣️⬆️↗️➡️↘️⬇️↙️⬅️↖️↕️↔️↩️↪️⤴️⤵️🔃🔄🔙🔚🔛🔜🔝🛐⚛️🕉️✡️☸️☯️✝️☦️☪️☮️🕎🔯🪯♈♉♊♋♌♍♎♏♐♑♒♓⛎🔀🔁🔂▶️⏩⏭️⏯️◀️⏪⏮️🔼⏫🔽⏬⏸️⏹️⏺️⏏️🎦🔅🔆📶🛜📳📴♀️♂️⚧️✖️➕➖➗🟰♾️‼️⁉️❓❔❕❗〰️💱💲⚕️♻️⚜️🔱📛🔰⭕✅☑️✔️❌❎➰➿〽️✳️✴️❇️©️®️™️🫟#️⃣*️⃣0️⃣1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣9️⃣🔟🔠🔡🔢🔣🔤🅰️🆎🅱️🆑🆒🆓ℹ️🆔Ⓜ️🆕🆖🅾️🆗🅿️🆘🆙🆚🈁🈂️🈷️🈶🈯🉐🈹🈚🈲🉑🈸🈴🈳㊗️㊙️🈺🈵🔴🟠🟡🟢🔵🟣🟤⚫⚪🟥🟧🟨🟩🟦🟪🟫⬛⬜◼️◻️◾◽▪️▫️🔶🔷🔸🔹🔺🔻💠🔘🔳🔲",
  flags: "🏁🚩🎌🏴🏳️🏳️‍🌈🏳️‍⚧️🏴‍☠️🇦🇨🇦🇩🇦🇪🇦🇫🇦🇬🇦🇮🇦🇱🇦🇲🇦🇴🇦🇶🇦🇷🇦🇸🇦🇹🇦🇺🇦🇼🇦🇽🇦🇿🇧🇦🇧🇧🇧🇩🇧🇪🇧🇫🇧🇬🇧🇭🇧🇮🇧🇯🇧🇱🇧🇲🇧🇳🇧🇴🇧🇶🇧🇷🇧🇸🇧🇹🇧🇻🇧🇼🇧🇾🇧🇿🇨🇦🇨🇨🇨🇩🇨🇫🇨🇬🇨🇭🇨🇮🇨🇰🇨🇱🇨🇲🇨🇳🇨🇴🇨🇵🇨🇶🇨🇷🇨🇺🇨🇻🇨🇼🇨🇽🇨🇾🇨🇿🇩🇪🇩🇬🇩🇯🇩🇰🇩🇲🇩🇴🇩🇿🇪🇦🇪🇨🇪🇪🇪🇬🇪🇭🇪🇷🇪🇸🇪🇹🇪🇺🇫🇮🇫🇯🇫🇰🇫🇲🇫🇴🇫🇷🇬🇦🇬🇧🇬🇩🇬🇪🇬🇫🇬🇬🇬🇭🇬🇮🇬🇱🇬🇲🇬🇳🇬🇵🇬🇶🇬🇷🇬🇸🇬🇹🇬🇺🇬🇼🇬🇾🇭🇰🇭🇲🇭🇳🇭🇷🇭🇹🇭🇺🇮🇨🇮🇩🇮🇪🇮🇱🇮🇲🇮🇳🇮🇴🇮🇶🇮🇷🇮🇸🇮🇹🇯🇪🇯🇲🇯🇴🇯🇵🇰🇪🇰🇬🇰🇭🇰🇮🇰🇲🇰🇳🇰🇵🇰🇷🇰🇼🇰🇾🇰🇿🇱🇦🇱🇧🇱🇨🇱🇮🇱🇰🇱🇷🇱🇸🇱🇹🇱🇺🇱🇻🇱🇾🇲🇦🇲🇨🇲🇩🇲🇪🇲🇫🇲🇬🇲🇭🇲🇰🇲🇱🇲🇲🇲🇳🇲🇴🇲🇵🇲🇶🇲🇷🇲🇸🇲🇹🇲🇺🇲🇻🇲🇼🇲🇽🇲🇾🇲🇿🇳🇦🇳🇨🇳🇪🇳🇫🇳🇬🇳🇮🇳🇱🇳🇴🇳🇵🇳🇷🇳🇺🇳🇿🇴🇲🇵🇦🇵🇪🇵🇫🇵🇬🇵🇭🇵🇰🇵🇱🇵🇲🇵🇳🇵🇷🇵🇸🇵🇹🇵🇼🇵🇾🇶🇦🇷🇪🇷🇴🇷🇸🇷🇺🇷🇼🇸🇦🇸🇧🇸🇨🇸🇩🇸🇪🇸🇬🇸🇭🇸🇮🇸🇯🇸🇰🇸🇱🇸🇲🇸🇳🇸🇴🇸🇷🇸🇸🇸🇹🇸🇻🇸🇽🇸🇾🇸🇿🇹🇦🇹🇨🇹🇩🇹🇫🇹🇬🇹🇭🇹🇯🇹🇰🇹🇱🇹🇲🇹🇳🇹🇴🇹🇷🇹🇹🇹🇻🇹🇼🇹🇿🇺🇦🇺🇬🇺🇲🇺🇳🇺🇸🇺🇾🇺🇿🇻🇦🇻🇨🇻🇪🇻🇬🇻🇮🇻🇳🇻🇺🇼🇫🇼🇸🇽🇰🇾🇪🇾🇹🇿🇦🇿🇲🇿🇼🏴󠁧󠁢󠁥󠁮󠁧󠁿🏴󠁧󠁢󠁳󠁣󠁴󠁿🏴󠁧󠁢󠁷󠁬󠁳󠁿",
};

const EMOJI_POPULAR = "😂😊😍🥰😘😉😁😅😆🤣🙂😎🤩🥳😇😌😴🤤😭😢🥺😳😬😱🤔🤗🤭😒🙄😤😡👀👍👎🙏👏💪🤝✌️🤞💯🔥✨🎉❤️💕";

const recentsKey = "tgEmojiRecents_" + (window.generatorName || "chat");
let emojiRecents = [];
try { emojiRecents = JSON.parse(lsGet(recentsKey) || "[]"); } catch (e) { emojiRecents = []; }
function saveRecents() { try { lsSet(recentsKey, JSON.stringify(emojiRecents)); } catch (e) {} }

let activeCat = emojiRecents.length ? "recents" : "smileys";

function renderEmojiTabs() {
  emojiTabsEl.innerHTML = "";
  for (const cat of EMOJI_CATS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "emojiTab" + (cat.id === "recents" ? " recentsTab" : "");
    b.dataset.cat = cat.id;
    b.title = cat.name;
    b.textContent = cat.icon;
    b.addEventListener("click", (e) => { e.stopPropagation(); switchEmojiCat(cat.id); });
    emojiTabsEl.appendChild(b);
  }
}

let _emojiSeg = null;
function splitEmojis(str) {
  if (!_emojiSeg) _emojiSeg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return Array.from(_emojiSeg.segment(str), s => s.segment);
}

const BACKSPACE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 5H9l-7 7 7 7h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"/><path d="M12 9.5l5 5M17 9.5l-5 5"/></svg>';

function addEmojiSection(title, ems, empty) {
  const head = document.createElement("div");
  head.className = "emojiCatHead";
  const t = document.createElement("span");
  t.className = "emojiCatTitle";
  t.textContent = title;
  head.appendChild(t);
  const bb = document.createElement("button");
  bb.type = "button";
  bb.className = "emojiBack";
  bb.title = "Backspace";
  bb.setAttribute("aria-label", "Backspace");
  bb.innerHTML = BACKSPACE_SVG;
  bb.addEventListener("click", (e) => { e.stopPropagation(); backspaceEmoji(); });
  head.appendChild(bb);
  emojiGridEl.appendChild(head);
  if (empty) {
    const e = document.createElement("div");
    e.className = "emojiEmpty";
    e.textContent = "Tap emojis and they'll show up here";
    emojiGridEl.appendChild(e);
    return;
  }
  for (const em of ems) {
    const c = document.createElement("button");
    c.type = "button";
    c.className = "emojiCell";
    c.textContent = em;
    c.addEventListener("click", (e) => { e.stopPropagation(); insertEmoji(em); });
    emojiGridEl.appendChild(c);
  }
}

function renderEmojiGrid(catId) {
  emojiGridEl.innerHTML = "";
  if (catId === "recents") {
    if (emojiRecents.length) addEmojiSection("Recents", emojiRecents);
    else addEmojiSection("Recents", [], true);
    if (emojiRecents.length < 24) {
      addEmojiSection("Popular", splitEmojis(EMOJI_POPULAR).filter(e => !emojiRecents.includes(e)));
    }
    return;
  }
  const cat = EMOJI_CATS.find(c => c.id === catId);
  addEmojiSection(cat ? cat.name : "", splitEmojis(EMOJI_MAP[catId] || ""));
}

function switchEmojiCat(catId) {
  activeCat = catId;
  for (const t of emojiTabsEl.children) t.classList.toggle("active", t.dataset.cat === catId);
  renderEmojiGrid(catId);
  emojiScroll.scrollTop = 0;
}

let msgSelRange = null;

function saveMsgSelection() {
  if (document.activeElement !== msgInput) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const r = sel.getRangeAt(0);
  if (msgInput.contains(r.startContainer) && msgInput.contains(r.endContainer)) {
    msgSelRange = r.cloneRange();
  }
}

function normalizeMsgInput() {
  const t = msgInput.textContent;
  if (!t.trim()) { msgInput.textContent = ""; return; }
  if (t.length > MAX_TEXT) {
    msgInput.textContent = t.slice(0, MAX_TEXT);
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(msgInput);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    msgSelRange = range.cloneRange();
  }
}

function insertTextAtCaret(text) {
  const focused = document.activeElement === msgInput;
  const sel = window.getSelection();
  let range = null;
  if (focused && sel && sel.rangeCount) {
    const r = sel.getRangeAt(0);
    if (msgInput.contains(r.startContainer)) range = r;
  }
  if (!range && msgSelRange && msgInput.contains(msgSelRange.startContainer)) range = msgSelRange.cloneRange();
  if (!range) {
    range = document.createRange();
    range.selectNodeContents(msgInput);
    range.collapse(false);
  }
  range.deleteContents();
  const tn = document.createTextNode(text);
  range.insertNode(tn);
  range.setStartAfter(tn);
  range.collapse(true);
  msgSelRange = range.cloneRange();
  if (focused) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
  normalizeMsgInput();
  msgInput.dispatchEvent(new Event("input", { bubbles: true }));
}

/* ---------- text format toolbar (bold / italic / strike / code) ---------- */
const fmtBar = document.getElementById("fmtBar");
const FMT_MARK = { bold: ["**", "**"], italic: ["*", "*"], strike: ["~~", "~~"], code: ["`", "`"] };
let fmtSavedRange = null;

function fmtRangeInInput() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  if (!msgInput.contains(r.startContainer) || !msgInput.contains(r.endContainer)) return null;
  if (!r.toString().trim()) return null;
  return r.cloneRange();
}

document.addEventListener("selectionchange", () => {
  const r = fmtRangeInInput();
  if (r) {
    fmtSavedRange = r;
    fmtBar.classList.remove("hide");
  } else {
    fmtBar.classList.add("hide");
  }
});

function fmtOffsets(range, el) {
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  return { start, end: start + range.toString().length };
}

function setCaretInInput(offset) {
  const walker = document.createTreeWalker(msgInput, NodeFilter.SHOW_TEXT);
  let n, acc = 0, node = null, off = 0;
  while ((n = walker.nextNode())) {
    if (acc + n.data.length >= offset) { node = n; off = offset - acc; break; }
    acc += n.data.length;
  }
  const sel = window.getSelection();
  const range = document.createRange();
  if (!node) { range.selectNodeContents(msgInput); range.collapse(false); }
  else { range.setStart(node, off); range.collapse(true); }
  sel.removeAllRanges();
  sel.addRange(range);
  msgSelRange = range.cloneRange();
}

function applyFormat(fmt) {
  const pair = FMT_MARK[fmt];
  if (!pair) return;
  let range = fmtSavedRange ? fmtSavedRange.cloneRange() : fmtRangeInInput();
  if (!range) return;
  const full = msgInput.textContent;
  const { start, end } = fmtOffsets(range, msgInput);
  if (end <= start) return;
  const text = full.slice(start, end);
  const [o, c] = pair;
  let wrapped;
  if (text.length >= o.length + c.length && text.startsWith(o) && text.endsWith(c)) {
    wrapped = text.slice(o.length, text.length - c.length);
  } else {
    wrapped = o + text + c;
  }
  msgInput.textContent = full.slice(0, start) + wrapped + full.slice(end);
  normalizeMsgInput();
  fmtSavedRange = null;
  fmtBar.classList.add("hide");
  setCaretInInput(start + wrapped.length);
  msgInput.dispatchEvent(new Event("input", { bubbles: true }));
  updateSendBtn();
  msgInput.focus();
}
document.querySelectorAll("#fmtBar .fmtBtn").forEach((btn) => {
  const fmt = btn.dataset.fmt;
  btn.addEventListener("pointerdown", (e) => {
    const r = fmtRangeInInput();
    if (r) fmtSavedRange = r;
  });
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("touchstart", (e) => e.preventDefault());
  btn.addEventListener("click", () => applyFormat(fmt));
});
document.addEventListener("pointerdown", (e) => {
  if (e.target.closest("#fmtBar") || e.target.closest("#msgInput")) return;
  fmtSavedRange = null;
  fmtBar.classList.add("hide");
});


/* ---------- @mention ---------- */
const mentionPop = document.getElementById("mentionPop");
let mentionUsersCache = null;
let mentionUsersCacheT = 0;
let mentionFiltered = [];
let mentionIdx = 0;
let mentionGen = 0;
async function getMentionUsers() {
  const now = Date.now();
  if (mentionUsersCache && now - mentionUsersCacheT < 15000) return mentionUsersCache;
  try {
    const r = await socket.rpc.getOnline("");
    const list = JSON.parse(r);
    const names = (list || []).map((u) => u.name).filter((n) => n && n !== myName);
    mentionUsersCache = [...new Set(names)];
    mentionUsersCacheT = now;
  } catch (e) { if (!mentionUsersCache) mentionUsersCache = []; }
  return mentionUsersCache;
}
function hideMentionPop() {
  mentionGen++;
  mentionPop.classList.add("hide");
  mentionPop.textContent = "";
  mentionFiltered = [];
  mentionIdx = 0;
}
function highlightMentionRow() {
  [...mentionPop.children].forEach((r, i) => r.classList.toggle("sel", i === mentionIdx));
}
function updateMentionPop(users, partial) {
  const lower = partial.toLowerCase();
  let matches = users.filter((n) => n.toLowerCase().includes(lower));
  matches.sort((a, b) => {
    const ap = a.toLowerCase().startsWith(lower) ? 0 : 1;
    const bp = b.toLowerCase().startsWith(lower) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.localeCompare(b);
  });
  mentionFiltered = matches.slice(0, 8);
  mentionPop.textContent = "";
  if (!mentionFiltered.length) { mentionPop.classList.add("hide"); return; }
  mentionPop.classList.remove("hide");
  mentionFiltered.forEach((name, i) => {
    const row = el("div", "mRow" + (i === 0 ? " sel" : ""));
    const av = el("div", "mAv");
    if (name === "admin") av.classList.add("adminAvatar");
    paintAvatar(av, name);
    row.appendChild(av);
    row.appendChild(el("div", "mName", name));
    row.dataset.name = name;
    row.addEventListener("click", () => selectMention(name));
    row.addEventListener("mousemove", () => { mentionIdx = i; highlightMentionRow(); });
    mentionPop.appendChild(row);
  });
}
function textOffsetUpTo(range) {
  const walker = document.createTreeWalker(msgInput, NodeFilter.SHOW_TEXT);
  let count = 0;
  let node = walker.nextNode();
  while (node) {
    if (node === range.startContainer) { count += range.startOffset; break; }
    count += node.data.length;
    node = walker.nextNode();
  }
  return count;
}
function currentMentionToken() {
  const sel = window.getSelection();
  let range = null;
  if (sel && sel.rangeCount) {
    const r = sel.getRangeAt(0);
    if (msgInput.contains(r.startContainer)) range = r;
  }
  if (!range && msgSelRange && msgInput.contains(msgSelRange.startContainer)) range = msgSelRange.cloneRange();
  if (!range) return null;
  const caretPos = textOffsetUpTo(range);
  const preText = msgInput.textContent.slice(0, caretPos);
  const m = /(?:^|\s)(@[\w\u00c0-\uffff]*)$/.exec(preText);
  if (!m) return null;
  return { token: m[1], caretPos };
}
function updateMentionPopup() {
  mentionGen++;
  const myGen = mentionGen;
  const tok = currentMentionToken();
  if (!tok) { hideMentionPop(); return; }
  getMentionUsers().then((users) => {
    if (myGen !== mentionGen) return;
    const tok2 = currentMentionToken();
    if (!tok2 || tok2.token !== tok.token) { hideMentionPop(); return; }
    updateMentionPop(users, tok.token.slice(1));
  });
}
function selectMention(name) {
  const tok = currentMentionToken();
  if (!tok) return;
  const full = msgInput.textContent;
  const caretPos = tok.caretPos;
  const tokenStart = caretPos - tok.token.length;
  const replaced = full.slice(0, tokenStart) + "@" + name + " " + full.slice(caretPos);
  msgInput.textContent = replaced;
  hideMentionPop();
  const off = Math.min(tokenStart + 1 + name.length + 1, replaced.length);
  const range = document.createRange();
  range.selectNodeContents(msgInput);
  range.collapse(false);
  const node = msgInput.firstChild;
  range.setStart(node && node.nodeType === 3 ? node : msgInput, node && node.nodeType === 3 ? off : 0);
  range.collapse(true);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(range);
  msgSelRange = range.cloneRange();
  normalizeMsgInput();
  msgInput.dispatchEvent(new Event("input", { bubbles: true }));
}
function insertMentionIntoInput(name) {
  const cur = msgInput.textContent;
  const sep = cur && !/[\s]$/.test(cur) ? " " : "";
  msgInput.textContent = cur + sep + "@" + name + " ";
  msgInput.focus();
  const r = document.createRange();
  r.selectNodeContents(msgInput);
  r.collapse(false);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
  msgSelRange = r.cloneRange();
  msgInput.dispatchEvent(new Event("input", { bubbles: true }));
}

function backspaceEmoji() {
  const focused = document.activeElement === msgInput;
  const sel = window.getSelection();
  let range = null;
  if (focused && sel && sel.rangeCount) {
    const r = sel.getRangeAt(0);
    if (msgInput.contains(r.startContainer)) range = r;
  }
  if (!range && msgSelRange && msgInput.contains(msgSelRange.startContainer)) range = msgSelRange.cloneRange();
  if (!range) {
    range = document.createRange();
    range.selectNodeContents(msgInput);
    range.collapse(false);
  }
  if (!range.collapsed) {
    range.deleteContents();
  } else {
    const c = range.startContainer;
    let startNode = c, startOff = range.startOffset;
    if (c.nodeType === 3) {
      if (startOff > 0) {
        const gs = splitEmojis(c.data.slice(0, startOff));
        const last = gs[gs.length - 1];
        if (!last) return;
        startOff -= last.length;
      } else {
        let prev = c.previousSibling;
        while (prev && prev.nodeType !== 3) prev = prev.previousSibling;
        if (!prev) return;
        startNode = prev;
        startOff = prev.data.length;
      }
    } else if (c.nodeType === 1) {
      const pc = c.childNodes[startOff - 1];
      if (!pc) return;
      let lastText = pc.nodeType === 3 ? pc : pc.lastChild;
      while (lastText && lastText.nodeType !== 3) lastText = lastText.lastChild;
      if (!lastText) return;
      const gs = splitEmojis(lastText.data);
      const last = gs[gs.length - 1];
      if (!last) return;
      startNode = lastText;
      startOff = lastText.data.length - last.length;
    } else return;
    const r2 = document.createRange();
    r2.setStart(startNode, startOff);
    r2.setEnd(c, range.startOffset);
    r2.deleteContents();
    range = r2;
  }
  msgSelRange = range.cloneRange();
  if (focused) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
  normalizeMsgInput();
  msgInput.dispatchEvent(new Event("input", { bubbles: true }));
}

function insertEmoji(em) {
  insertTextAtCaret(em);
  emojiRecents = [em, ...emojiRecents.filter(e => e !== em)].slice(0, 40);
  saveRecents();
  if (activeCat === "recents") renderEmojiGrid("recents");
}

function syncPanelRaise() {
  document.getElementById("app").classList.toggle("panel-open",
    !emojiPanel.classList.contains("hide") || !gifPanel.classList.contains("hide"));
}

function openEmojiPanel() {
  if (!emojiPanel.classList.contains("hide")) return;
  emojiPanel.classList.remove("hide");
  emojiBtn.classList.add("active");
  if (!gifPanel.classList.contains("hide")) closeGifPanel();
  renderEmojiTabs();
  switchEmojiCat(activeCat);
  if (document.activeElement === msgInput) msgInput.blur();
  syncPanelRaise();
}
function closeEmojiPanel() {
  if (emojiPanel.classList.contains("hide")) return;
  emojiPanel.classList.add("hide");
  emojiBtn.classList.remove("active");
  syncPanelRaise();
}
function toggleEmojiPanel() {
  if (emojiPanel.classList.contains("hide")) openEmojiPanel();
  else closeEmojiPanel();
}

emojiBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleEmojiPanel();
});

msgInput.addEventListener("focus", () => {
  if (!emojiPanel.classList.contains("hide")) closeEmojiPanel();
});

/* ================= GIF search ================= */
const gifPanel = document.getElementById("gifPanel");
const gifSearchInput = document.getElementById("gifSearchInput");
const gifSearchBtn = document.getElementById("gifSearchBtn");
const gifChipsEl = document.getElementById("gifChips");
const gifGridEl = document.getElementById("gifGrid");
const gifScroll = document.getElementById("gifScroll");
const gifBtn = document.getElementById("gifBtn");

const GIF_CHIPS = ["funny", "cat", "dog", "dancing", "cute", "wow", "surprised", "laughing", "applause", "party", "thinking", "sleepy"];

function renderGifChips() {
  gifChipsEl.innerHTML = "";
  for (const c of GIF_CHIPS) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = c;
    b.addEventListener("click", () => { gifSearchInput.value = c; runGifSearch(c); });
    gifChipsEl.appendChild(b);
  }
}

const GIPHY_API_KEY = "0LY9G7vJ6CPe7pF1rD2N5xpPiiRjDoNz";

const GIF_PER_PAGE = 30;
const GIF_BAD_WORDS = [
  /\bsex\b/i, /porn/i, /naked/i, /nude/i, /nudity/i, /boob/i, /boobie/i, /titt/i,
  /\bass\b/i, /\bbooty\b/i, /\bthong\b/i, /lingerie/i, /milf/i, /\bslut\b/i, /\bwhore\b/i,
  /\bfuck/i, /\bbitch/i, /\bdick\b/i, /\bpenis\b/i, /\bvagina/i, /blowjob/i, /handjob/i,
  /orgasm/i, /hentai/i, /nsfw/i, /seduct/i, /striptease/i, /sexy/i, /\bstrip\b/i, /\bhorny\b/i,
  /\bboner/i, /busty/i, /jiggl/i, /pantie/i, /panty/i, /thicc/i, /\bjerk\b/i, /wank/i
];
function gifOk(r) {
  if (!r || !r.images) return false;
  if (r.rating && r.rating !== "g") return false;
  const s = ((r.title || "") + " " + (r.slug || "") + " " + (r.username || "")).toLowerCase();
  return !GIF_BAD_WORDS.some((re) => re.test(s));
}
async function gifFetchPage(query, offset) {
  const j = await root.superFetch("https://api.giphy.com/v1/gifs/search?api_key=" + GIPHY_API_KEY + "&q=" + encodeURIComponent(query) + "&limit=" + GIF_PER_PAGE + "&offset=" + offset + "&rating=g").then((r) => r.json());
  const raw = (j && j.data) || [];
  const total = (j && j.pagination && j.pagination.total_count) || 0;
  const items = [];
  for (const r of raw) if (gifOk(r)) items.push({ url: r.images.downsized.url, thumb: (r.images.preview_gif && r.images.preview_gif.url) || r.images.fixed_height_small.url });
  const done = raw.length === 0 || (total > 0 && offset + raw.length >= total);
  return { items, done };
}
let gifSearchBusy = false;
let gifState = { q: "", offset: 0, done: false, waiting: false };
function gifCellEl(r) {
  const cell = document.createElement("button");
  cell.type = "button";
  cell.className = "gifCell";
  const img = document.createElement("img");
  img.loading = "lazy";
  img.src = r.thumb;
  img.alt = "GIF";
  img.onerror = () => { img.remove(); };
  cell.appendChild(img);
  cell.addEventListener("click", () => {
    closeGifPanel();
    openGifUrlForSend(r.url);
  });
  return cell;
}
function appendGifItems(items) {
  for (const r of items) gifGridEl.appendChild(gifCellEl(r));
}
function showGifLoader(show) {
  const l = gifGridEl.querySelector(".gifLoad.more");
  if (show) {
    if (!l) gifGridEl.appendChild(el("div", "gifLoad more", "Loading more…"));
  } else if (l) l.remove();
}
async function gifLoadMore() {
  if (gifSearchBusy || gifState.waiting || gifState.done) return;
  gifState.waiting = true;
  showGifLoader(true);
  try {
    const { items, done } = await gifFetchPage(gifState.q, gifState.offset);
    gifState.offset += GIF_PER_PAGE;
    gifState.done = done;
    appendGifItems(items);
    if (gifState.done) showGifLoader(false);
    else checkGifScroll();
  } catch (e) {
    showGifLoader(false);
    gifState.done = true;
    gifGridEl.appendChild(el("div", "gifErr", "Couldn't load more GIFs."));
  } finally {
    gifState.waiting = false;
  }
}
function checkGifScroll() {
  if (gifSearchBusy || gifState.waiting || gifState.done) return;
  if (gifScroll.scrollTop + gifScroll.clientHeight >= gifScroll.scrollHeight - 220) gifLoadMore();
}
async function runGifSearch(query) {
  const q = (query || gifSearchInput.value || "").trim();
  if (!q || gifSearchBusy) return;
  gifSearchBusy = true;
  gifState = { q, offset: 0, done: false, waiting: false };
  gifGridEl.innerHTML = "<div class='gifLoad'><span class='miniSpinner'></span></div>";
  try {
    const { items, done } = await gifFetchPage(q, 0);
    gifState.offset = GIF_PER_PAGE;
    gifState.done = done;
    gifGridEl.innerHTML = "";
    if (!items.length) {
      if (done) gifGridEl.appendChild(el("div", "gifLoad", "No GIFs found — try another search."));
      else gifLoadMore();
      return;
    }
    appendGifItems(items);
    checkGifScroll();
  } catch (e) {
    gifGridEl.innerHTML = "<div class='gifErr'>Couldn't load GIFs. Check your connection and try again.</div>";
  } finally {
    gifSearchBusy = false;
  }
}
gifScroll.addEventListener("scroll", checkGifScroll);

function openGifPanel() {
  if (!gifPanel.classList.contains("hide")) return;
  gifPanel.classList.remove("hide");
  gifBtn.classList.add("active");
  if (!emojiPanel.classList.contains("hide")) closeEmojiPanel();
  renderGifChips();
  if (!gifGridEl.children.length) runGifSearch("funny");
  if (document.activeElement === msgInput) msgInput.blur();
  setTimeout(() => gifSearchInput.focus(), 60);
  syncPanelRaise();
}
function closeGifPanel() {
  if (gifPanel.classList.contains("hide")) return;
  gifPanel.classList.add("hide");
  gifBtn.classList.remove("active");
  syncPanelRaise();
}
function toggleGifPanel() {
  if (gifPanel.classList.contains("hide")) openGifPanel();
  else closeGifPanel();
}

gifBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleGifPanel();
});
gifSearchBtn.addEventListener("click", () => runGifSearch());
gifSearchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); runGifSearch(); }
});
msgInput.addEventListener("focus", () => {
  if (!gifPanel.classList.contains("hide")) closeGifPanel();
});

menuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  translatePop.classList.add("hide");
  textSizePop.classList.add("hide");
  menuPop.classList.toggle("hide");
});
document.addEventListener("click", (e) => {
  menuPop.classList.add("hide");
  translatePop.classList.add("hide");
  textSizePop.classList.add("hide");
  if (!e.target.closest("#emojiPanel") && !e.target.closest("#composeBar")) closeEmojiPanel();
  if (!e.target.closest("#gifPanel") && !e.target.closest("#composeBar")) closeGifPanel();
  if (!e.target.closest("#mentionPop") && !e.target.closest("#composeBar")) hideMentionPop();
});

nickItem.addEventListener("click", () => {
  menuPop.classList.add("hide");
  nickModal.classList.remove("force");
  nickModal.classList.remove("nopfp");
  nickModal.querySelector(".cardTitle").textContent = "Edit profile";
  nickModal.querySelector("#nickOkBtn").textContent = "Save";
  nickInput.value = myName || "";
  // A reserved nickname (admin / protected) is re-verified server-side, so the
  // saved password is offered again instead of demanding a retype.
  nickPassInput.classList.add("hide");
  nickPassInput.value = needsPass(nickInput.value.trim()) ? savedAdminPass : "";
  if (needsPass(nickInput.value.trim())) nickPassInput.classList.remove("hide");
  pfpDraft = null;
  renderPfpPreview();
  nickModal.classList.remove("hide");
  nickInput.focus();
});
nickCancelBtn.addEventListener("click", () => {
  // Drop any picture that was uploaded but never saved, so reopening the modal
  // starts from what the room actually has.
  pfpDraft = null;
  nickModal.classList.add("hide");
});

/* ---------- add to home screen ---------- */
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; });
function stepNum(n, txt) {
  const row = el("div", "istep");
  row.appendChild(el("div", "num", String(n)));
  const t = el("div", "txt");
  t.innerHTML = txt;
  row.appendChild(t);
  return row;
}
function buildInstallBody() {
  installBody.innerHTML = "";
  if (window.matchMedia("(display-mode: standalone)").matches) {
    installBody.appendChild(el("div", "ibHead", "Already installed"));
    installBody.appendChild(el("div", null, "You're using Chat Room as an installed app."));
    return;
  }
  if (deferredPrompt) {
    installBody.appendChild(el("div", "ibHead", "Install Chat Room"));
    installBody.appendChild(el("div", null, "Add it to your home screen so it opens like a real app, with its own icon."));
    installBtn.classList.remove("hide");
    return;
  }
  installBtn.classList.add("hide");
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) {
    installBody.appendChild(el("div", "ibHead", "Install on iPhone / iPad"));
    installBody.appendChild(stepNum(1, "Tap the <b>Share</b> button (square with an up arrow) in Safari's toolbar."));
    installBody.appendChild(stepNum(2, "Scroll down and tap <b>Add to Home Screen</b>."));
    installBody.appendChild(stepNum(3, "Tap <b>Add</b> in the top right."));
  } else if (/android/i.test(ua)) {
    installBody.appendChild(el("div", "ibHead", "Install on Android"));
    installBody.appendChild(stepNum(1, "Tap the <b>⋮</b> menu (three dots) in your browser."));
    installBody.appendChild(stepNum(2, "Tap <b>Add to Home screen</b> or <b>Install app</b>."));
    installBody.appendChild(stepNum(3, "Tap <b>Install</b> / <b>Add</b> to confirm."));
  } else {
    installBody.appendChild(el("div", "ibHead", "Install on this computer"));
    installBody.appendChild(stepNum(1, "Click the <b>install icon</b> in the address bar (or <b>⋮</b> menu → <b>Install Chat Room</b>)."));
  }
}
installItem.addEventListener("click", () => {
  menuPop.classList.add("hide");
  if (deferredPrompt) {
    const p = deferredPrompt;
    deferredPrompt = null;
    p.prompt();
    p.userChoice.catch(() => {});
    return;
  }
  buildInstallBody();
  installModal.classList.remove("hide");
});
installBtn.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  const p = deferredPrompt;
  deferredPrompt = null;
  installBtn.classList.add("hide");
  p.prompt();
  try { await p.userChoice; } catch (e) {}
  installBody.appendChild(el("div", "ibHead", "Added"));
  installBody.appendChild(el("div", null, "Check your home screen for the new Chat Room icon. If it didn't appear, follow the manual steps below."));
});
installCancelBtn.addEventListener("click", () => installModal.classList.add("hide"));
installModal.addEventListener("click", (e) => { if (e.target === installModal) installModal.classList.add("hide"); });

function forceNick() {
  nickModal.classList.add("force");
  nickModal.classList.remove("nopfp");
  nickModal.querySelector(".cardTitle").textContent = "Create your profile";
  nickModal.querySelector("#nickOkBtn").textContent = "Join";
  nickInput.value = savedNick || "";
  nickPassInput.value = "";
  pfpDraft = null;
  renderPfpPreview();
  nickInput.dispatchEvent(new Event("input"));
  nickModal.classList.remove("hide");
  nickInput.focus();
}
// Force a protected account (or admin) offline so they must re-enter the
// password. Used when the server logs them out, and on reload so a saved
// password never silently keeps a reserved name signed in.
function promptProtectedLogin(name) {
  // persistence: keep saved password so reload restores the session; explicit logouts call clearSavedPass() first
  savedNickApplied = false;
  joinedOnce = false;
  forceNick();
  nickModal.classList.add("nopfp");
  const nm = name || savedNick || "";
  nickModal.querySelector(".cardTitle").textContent = "Log in with your password";
  nickModal.querySelector("#nickOkBtn").textContent = "Log in";
  nickInput.value = nm;
  nickInput.dispatchEvent(new Event("input"));
  nickPassInput.focus();
  toast("Please log in with your password");
}
nickInput.addEventListener("input", () => {
  const v = nickInput.value.trim();
  const wantsAdmin = /^admin$/i.test(v);
  const protName = wantsAdmin ? null : protectedNameFor(v);
  nickPassInput.classList.toggle("hide", !(wantsAdmin || protName || v !== ""));
  if (wantsAdmin) nickPassInput.placeholder = "Admin password";
  else if (protName) nickPassInput.placeholder = "Password for " + protName;
  else if (v !== "") nickPassInput.placeholder = "Password";
  renderPfpPreview();
});
nickOkBtn.addEventListener("click", async () => {
  const prevName = myName;
  const rawName = nickInput.value.trim();
  let name = rawName.slice(0, 20);
  if (!name) {
    if (nickModal.classList.contains("force")) toast("Enter a name to join the chat");
    return;
  }
  const ruleMsg = nameRuleMsg(name);
  if (ruleMsg) {
    toast(ruleMsg);
    nickInput.focus();
    return;
  }
  if (nameHasBlacklisted(name)) {
    toast("That name contains a blocked word — please pick another");
    nickInput.focus();
    return;
  }
  const wantsAdmin = /^admin$/i.test(name);
  const protName = wantsAdmin ? null : protectedNameFor(name);
  const needsPassword = wantsAdmin || !!protName || nickPassInput.value !== "";
  if (wantsAdmin) name = "admin";
  else if (protName) name = protName;
  if (needsPassword && !nickPassInput.value) {
    nickPassInput.classList.remove("hide");
    nickPassInput.placeholder = wantsAdmin ? "Admin password" : "Password for " + protName;
    nickPassInput.focus();
    toast(wantsAdmin ? "Enter the admin password" : "Enter the password for " + protName);
    return;
  }
  if (!wantsAdmin && (myCountry === "India" || myCountry === "Pakistan")) {
    showRegionBlocked();
    return;
  }
  for (let i = 0; i < 50 && !(socket && socket.readyState === 1); i++) await new Promise((r) => setTimeout(r, 200));
  if (!socket || socket.readyState !== 1) return;
  if (pfpBusy) { toast("Wait for the photo to finish uploading"); return; }
  try {
    const payload = { name, uid: myUid, ...(needsPassword ? { password: nickPassInput.value } : {}), loc: await getMyIPLocation() };
    // Only sent when this visit actually changed the picture, so an ordinary
    // rename never clears it.
    if (pfpDraft !== null) payload.pfp = pfpDraft;
    const r = await socket.rpc.setName(JSON.stringify(payload));
    if (r === "ok") {
      if (prevName && prevName !== name) {
        renameMyDomMessages(name);
        sbRenameMyRows(prevName, name);
        sbRenameDmMirror(prevName, name);
      }
      myName = name;
      savedNickApplied = true;
      joinedOnce = true;
      if (pfpDraft !== null) { setPfpLocal(name, pfpDraft); pfpDraft = null; }
      reclassifyOwnership();
      updateGate();
      persistNick(name, needsPassword ? nickPassInput.value : "");
      if (name === "admin") toast("Admin mode: golden badge enabled");
      else if (protName) toast("Signed in as " + protName);
      nickModal.classList.remove("force");
      nickModal.classList.add("hide");
      vpnModal.classList.add("hide");
      if (name === "admin") {
        addAdminActionButtons();
      }
    } else if (r === "wrong_password") {
      toast(wantsAdmin ? "Wrong admin password" : "Wrong password for " + name);
      nickPassInput.value = "";
      nickPassInput.focus();
    } else if (r === "password_required") {
      nickPassInput.classList.remove("hide");
      nickPassInput.placeholder = wantsAdmin ? "Admin password" : "Password for " + name;
      nickPassInput.focus();
      toast(wantsAdmin ? "Enter the admin password" : "Enter the password for " + name);
    } else if (r === "password_setup") {
      nickPassInput.classList.remove("hide");
      nickPassInput.placeholder = "Create a password for " + name;
      nickPassInput.focus();
      toast("New username — create a password for " + name);
    } else if (r === "weak_password") {
      toast("Password must be at least 4 characters");
      nickPassInput.value = "";
      nickPassInput.focus();
    } else if (r === "db_error") {
      toast("Accounts update needed — ask admin to run supabase.sql");
    } else if (r === "too_many_attempts") {
      toast("Too many attempts. Try again later.");
    } else if (r === "name_taken") {
      toast("\u201C" + name + "\u201D is already in use \u2014 please pick another name");
      nickInput.focus();
    } else if (r === "vpn_blocked") {
      showVpnBlocked();
    } else if (r === "unavailable_region") {
      showRegionBlocked();
    } else if (r === "banned") {
      showBannedModal();
      toast("That name is banned in this chat");
    } else if (r === "blocked_word") {
      toast("That name contains a blocked word — please pick another");
      nickInput.focus();
    } else if (r === "invalid") {
      toast("Use at least 4 letters — only letters, numbers, - and _ allowed");
    }
  } catch (e) {}
});
nickInput.addEventListener("keydown", (e) => { if (e.key === "Enter") nickOkBtn.click(); });
nickPassInput.addEventListener("keydown", (e) => { if (e.key === "Enter") nickOkBtn.click(); });

titleEditBtn.addEventListener("click", () => {
  titleInput.value = chatTitle.textContent;
  titleModal.classList.remove("hide");
  titleInput.focus();
});
// view-as eye removed per privacy terms
titleCancelBtn.addEventListener("click", () => titleModal.classList.add("hide"));
titleOkBtn.addEventListener("click", async () => {
  const v = titleInput.value.trim().slice(0, 60);
  if (!v) { toast("Enter a title"); return; }
  titleModal.classList.add("hide");
  try {
    const r = await socket.rpc.setTitle(v);
    if (r !== "ok") toast("Couldn't change title: " + r);
  } catch (e) {}
});
titleInput.addEventListener("keydown", (e) => { if (e.key === "Enter") titleOkBtn.click(); });

iconBtn.addEventListener("click", () => {
  iconModal.classList.remove("hide");
});
iconCancelBtn.addEventListener("click", () => iconModal.classList.add("hide"));
iconUploadBtn.addEventListener("click", () => iconInput.click());
iconInput.addEventListener("change", async () => {
  const file = iconInput.files[0];
  iconInput.value = "";
  if (!file) return;
  let blob;
  try {
    blob = await resizeImage(file, 512, 0.9);
  } catch (e) {
    toast("Couldn't read that image.");
    return;
  }
  iconDesc.textContent = "Uploading…";
  iconUploadBtn.disabled = true;
  iconRemoveBtn.disabled = true;
  try {
    const up2 = await root.uploadPlugin(blob);
    const url = String(up2.url || "");
    if (up2.error || !url) { toast("Upload failed: " + (up2.error || "unknown error")); return; }
    const r = await socket.rpc.setIcon(url);
    if (r === "ok") toast("Group icon updated");
    else toast("Couldn't set icon: " + r);
  } catch (e) {
    toast("Upload failed.");
  } finally {
    iconDesc.textContent = "Upload a new icon for this chat.";
    iconUploadBtn.disabled = false;
    iconRemoveBtn.disabled = false;
    iconModal.classList.add("hide");
  }
});
iconRemoveBtn.addEventListener("click", async () => {
  try {
    const r = await socket.rpc.setIcon("");
    if (r === "ok") toast("Group icon removed");
  } catch (e) {}
  iconModal.classList.add("hide");
});

clearItem.addEventListener("click", () => {
  menuPop.classList.add("hide");
  const desc = clearModal.querySelector(".cardDesc");
  desc.textContent = isAdmin()
    ? "This permanently deletes the conversation for everyone from the server."
    : "This clears the chat from your view only. Other users can still see the history.";
  clearModal.classList.remove("hide");
});
clearCancelBtn.addEventListener("click", () => clearModal.classList.add("hide"));
clearOkBtn.addEventListener("click", async () => {
  clearModal.classList.add("hide");
  if (isAdmin()) {
    try {
      const r = await socket.rpc.clearAll("");
      if (r === "ok") toast("Chat history cleared for everyone");
      else toast("Clear failed: " + r);
    } catch (e) {}
  } else {
    clearedAt = Date.now();
    lsSet(clearedKey, String(clearedAt));
    seenMsgIds.clear();
    msgByWrapCleanup(roomMessagesEl);
    roomMessagesEl.textContent = "";
    toast("Chat cleared (your view)");
  }
});

delCancelBtn.addEventListener("click", () => {
  delModal.classList.add("hide");
  pendingDelIds = [];
});
const delSilentBtn = document.getElementById("delSilentBtn");
// Deleting a message in a private chat means "unsend": it goes to the thread,
// never to the room's moderation path, and only your own messages qualify.
function performDelete(id, forceSilent) {
  if (!id) return;
  const n = [...messagesEl.children].find((c) => c.dataset && c.dataset.id === id);
  if (n && !nodeDeletable(n)) return;
  if (convo.mode === "dm") {
    if (!n || !wrapIsMine(n)) return;
    sbDmMirrorDelete(convo.peer, { ts: n.dataset.ts, from: n.dataset.from });
    n.remove();
    updateBubbleTails();
    dmSend({ ev: "del", id });
    return;
  }
  const isOwn = !!(n && n.dataset.from && wrapIsMine(n));
  // The audit archive lives on the server, which may not hold this message at
  // all (old rows exist only in the history store), so ship a snapshot of what
  // is being deleted along with the request.
  const mm = findMsgById(id);
  const snap = mm ? { t: mm.t, text: mm.text || "", url: mm.url || "", caption: mm.caption || "", dur: mm.dur || 0, size: mm.size || 0 } : null;
  // A moderator deleting someone else's message leaves a note, so the row stays
  // put for the server's delnote broadcast to replace it.
  const keepForDelNote = !forceSilent && !isOwn && (isAdmin() || verifiedSet.has(myName)) && n && n.dataset.from && socket && socket.readyState === 1;
  if (!keepForDelNote) sbDeleteDom(id);
  if (socket && socket.readyState === 1) {
    socket.send(JSON.stringify({
      t: "del", id, snap,
      silent: forceSilent ? true : (isOwn ? true : undefined),
      ts: n ? Number(n.dataset.ts) || null : null,
      from: n ? n.dataset.from || null : null,
      uid: n ? n.dataset.uid || null : null
    }));
  }
}
delSilentBtn.addEventListener("click", () => {
  delModal.classList.add("hide");
  const ids = pendingDelIds;
  pendingDelIds = [];
  for (const id of ids) performDelete(id, true);
  endSelection();
});
delOkBtn.addEventListener("click", () => {
  delModal.classList.add("hide");
  const ids = pendingDelIds;
  pendingDelIds = [];
  for (const id of ids) performDelete(id, false);
  endSelection();
});

// ---------- multi-select toolbar (long-press a message, tools in header) ----------
const appEl = document.getElementById("app");
const selBar = document.getElementById("selBar");
const selCount = document.getElementById("selCount");
const actReplyBtn = document.getElementById("actReplyBtn");
const actCopyBtn = document.getElementById("actCopyBtn");
const actEditBtn = document.getElementById("actEditBtn");
const actVerBtn = document.getElementById("actVerBtn");
const actFlagBtn = document.getElementById("actFlagBtn");
const actInfoBtn = document.getElementById("actInfoBtn");
const actBanBtn = document.getElementById("actBanBtn");
const actDelBtn = document.getElementById("actDelBtn");
const actPinBtn = document.getElementById("actPinBtn");
const selCloseBtn = document.getElementById("selCloseBtn");
const selActionBar = document.getElementById("selActionBar");
actReplyBtn.innerHTML = REPLY_SVG;
actCopyBtn.innerHTML = COPY_SVG;
actEditBtn.innerHTML = EDIT_SVG;
actPinBtn.innerHTML = PIN_SVG;
actDelBtn.innerHTML = DEL_SVG;
actFlagBtn.innerHTML = FLAG_SVG;
actInfoBtn.innerHTML = INFO_SVG;
actBanBtn.innerHTML = BAN_SVG;
actVerBtn.innerHTML = VERIFY_SVG;

const msgByWrap = new Map();
const selItems = new Map();
let selectionMode = false;

function selectedMsgs() { return [...selItems.values()]; }
function distinctSelUsers() { const s = new Set(); for (const m of selItems.values()) if (m.from) s.add(m.from); return [...s]; }

function updateSelBar() {
  const n = selItems.size;
  selCount.textContent = n ? (n === 1 ? "1 selected" : n + " selected") : "select messages";
  const admin = isAdmin();
  const users = distinctSelUsers();
  const target = users[0];
  const protectedSel = users.some((u) => u === "admin" || verifiedSet.has(u));
  const mod = admin || (verifiedSet.has(myName) && !protectedSel);
  // A private chat has no moderation tools: nobody can be verified, flagged,
  // inspected or banned from inside a one-to-one conversation.
  const dm = convo.mode === "dm";
  actVerBtn.classList.toggle("hide", !admin || dm);
  actFlagBtn.classList.toggle("hide", !mod || dm);
  actInfoBtn.classList.toggle("hide", !admin || dm);
  actBanBtn.classList.toggle("hide", !mod || dm);
  const ver = target && verifiedSet.has(target);
  actVerBtn.title = ver ? "Remove verification badge" : "Give verification badge to " + (target || "user");
  actVerBtn.innerHTML = ver ? VERIFIED_BADGE_SVG : VERIFY_SVG;
  const banned = target && bannedNames.has(target);
  actBanBtn.title = banned ? "Unban " + target : "Ban " + target + " (permanent)";
  actBanBtn.innerHTML = banned ? UNBAN_SVG : BAN_SVG;
  const selAll = [...selItems.values()];
  const _pinSingle = selAll.length === 1 ? selAll[0] : null;
  const canPin = (isAdmin() || verifiedSet.has(myName)) && !dm && !!_pinSingle && (_pinSingle.t === "chat" || _pinSingle.t === "img");
  const _pb = document.getElementById("actPinBtn");
  if (_pb) _pb.classList.toggle("hide", !canPin);
  const canDel = dm ? selAll.every((x) => isMine(x)) : (admin || selAll.every((x) => isMine(x)) || (verifiedSet.has(myName) && selAll.every(canDeleteMsg)));
  actDelBtn.classList.toggle("hide", !canDel);
  const selList = [...selItems.values()];
  const single = selList.length === 1 ? selList[0] : null;
  actEditBtn.classList.toggle("hide", !(single && isMine(single) && (single.t === "chat" || single.t === "img")));
  const btmEmpty = [actVerBtn, actFlagBtn, actInfoBtn, actBanBtn].every((b) => b.classList.contains("hide"));
  selActionBar.classList.toggle("empty", btmEmpty);
  appEl.classList.toggle("selModeNoComposer", selectionMode && !btmEmpty);
}

function withScrollPinned(fn, anchorEl) {
  const sc = scrollCtnEl;
  const sct = sc.getBoundingClientRect();
  let anchor = null;
  if (anchorEl) {
    anchor = { el: anchorEl, off: anchorEl.getBoundingClientRect().top - sct.top };
  } else {
    for (const child of messagesEl.children) {
      const r = child.getBoundingClientRect();
      if (r.bottom > sct.top + 1) { anchor = { el: child, off: r.top - sct.top }; break; }
    }
  }
  fn();
  if (!anchor) return;
  const cr = sc.getBoundingClientRect();
  const ar = anchor.el.getBoundingClientRect();
  sc.scrollTop += (ar.top - cr.top) - anchor.off;
}

function beginSelection(wrap, m) {
  selectionMode = true;
  closeReactionBar();
  closeEmojiPicker();
  withScrollPinned(() => {
    appEl.classList.add("selMode");
    selItems.set(wrap, m);
    wrap.classList.add("selected");
    updateSelBar();
  }, wrap);
}
function toggleSelect(wrap, m) {
  if (!selectionMode) { beginSelection(wrap, m); return; }
  if (selItems.has(wrap)) {
    selItems.delete(wrap);
    wrap.classList.remove("selected");
    if (selItems.size === 0) { endSelection(); return; }
  }
  else { selItems.set(wrap, m); wrap.classList.add("selected"); }
  updateSelBar();
}
function endSelection() {
  selectionMode = false;
  withScrollPinned(() => {
    appEl.classList.remove("selMode");
    appEl.classList.remove("selModeNoComposer");
    for (const w of selItems.keys()) w.classList.remove("selected");
    selItems.clear();
    updateSelBar();
  });
}

/* ================= message reactions =================
   Tap a message to pop up a short emoji bar; picking one toggles your reaction
   on that message. The server holds the canonical map (stored on the message
   itself, so it's durable and dies with the message); this mirrors it in rxMap
   keyed by author+timestamp, which lines up with rows rendered from the history
   store as well as live ones. */
const RX_EMOJIS = ["\u2764\uFE0F", "\uD83D\uDC4D", "\uD83D\uDC4E", "\uD83D\uDD25", "\uD83D\uDE02", "\uD83D\uDC4F", "\uD83D\uDE01"];

/* Generated from Unicode emoji-test.txt (fully-qualified, base forms; skin-tone variants omitted).
   Groups are [name, "emoji name\u0001emoji name\u0001..."]. */
const EMOJI_GROUPS = [
["Smileys & Emotion","😀 grinning face\u0001😃 grinning face with big eyes\u0001😄 grinning face with smiling eyes\u0001😁 beaming face with smiling eyes\u0001😆 grinning squinting face\u0001😅 grinning face with sweat\u0001🤣 rolling on the floor laughing\u0001😂 face with tears of joy\u0001🙂 slightly smiling face\u0001🙃 upside-down face\u0001🫠 melting face\u0001🫫 cracking face\u0001😉 winking face\u0001😊 smiling face with smiling eyes\u0001😇 smiling face with halo\u0001🥰 smiling face with hearts\u0001😍 smiling face with heart-eyes\u0001🤩 star-struck\u0001😘 face blowing a kiss\u0001😗 kissing face\u0001☺️ smiling face\u0001😚 kissing face with closed eyes\u0001😙 kissing face with smiling eyes\u0001🥲 smiling face with tear\u0001😋 face savoring food\u0001😛 face with tongue\u0001😜 winking face with tongue\u0001🤪 zany face\u0001😝 squinting face with tongue\u0001🤑 money-mouth face\u0001🤗 smiling face with open hands\u0001🤭 face with hand over mouth\u0001🫢 face with open eyes and hand over mouth\u0001🫣 face with peeking eye\u0001🤫 shushing face\u0001🤔 thinking face\u0001🫡 saluting face\u0001🤐 zipper-mouth face\u0001🤨 face with raised eyebrow\u0001😐 neutral face\u0001😑 expressionless face\u0001😶 face without mouth\u0001🫥 dotted line face\u0001😶‍🌫️ face in clouds\u0001😏 smirking face\u0001😒 unamused face\u0001🙄 face with rolling eyes\u0001😬 grimacing face\u0001😮‍💨 face exhaling\u0001🤥 lying face\u0001🫨 shaking face\u0001🙂‍↔️ head shaking horizontally\u0001🙂‍↕️ head shaking vertically\u0001😌 relieved face\u0001😔 pensive face\u0001😪 sleepy face\u0001🤤 drooling face\u0001😴 sleeping face\u0001🫩 face with bags under eyes\u0001😷 face with medical mask\u0001🤒 face with thermometer\u0001🤕 face with head-bandage\u0001🤢 nauseated face\u0001🤮 face vomiting\u0001🤧 sneezing face\u0001🥵 hot face\u0001🥶 cold face\u0001🥴 woozy face\u0001😵 face with crossed-out eyes\u0001😵‍💫 face with spiral eyes\u0001🤯 exploding head\u0001🤠 cowboy hat face\u0001🥳 partying face\u0001🥸 disguised face\u0001😎 smiling face with sunglasses\u0001🤓 nerd face\u0001🧐 face with monocle\u0001😕 confused face\u0001🫤 face with diagonal mouth\u0001😟 worried face\u0001🙁 slightly frowning face\u0001☹️ frowning face\u0001😮 face with open mouth\u0001😯 hushed face\u0001😲 astonished face\u0001😳 flushed face\u0001🫪 distorted face\u0001🥺 pleading face\u0001🥹 face holding back tears\u0001😦 frowning face with open mouth\u0001😧 anguished face\u0001😨 fearful face\u0001😰 anxious face with sweat\u0001😥 sad but relieved face\u0001😢 crying face\u0001😭 loudly crying face\u0001😱 face screaming in fear\u0001😖 confounded face\u0001😣 persevering face\u0001😞 disappointed face\u0001😓 downcast face with sweat\u0001😩 weary face\u0001😫 tired face\u0001🥱 yawning face\u0001😤 face with steam from nose\u0001😡 enraged face\u0001😠 angry face\u0001🤬 face with symbols on mouth\u0001😈 smiling face with horns\u0001👿 angry face with horns\u0001💀 skull\u0001☠️ skull and crossbones\u0001💩 pile of poo\u0001🤡 clown face\u0001👹 ogre\u0001👺 goblin\u0001👻 ghost\u0001👽 alien\u0001👾 alien monster\u0001🤖 robot\u0001😺 grinning cat\u0001😸 grinning cat with smiling eyes\u0001😹 cat with tears of joy\u0001😻 smiling cat with heart-eyes\u0001😼 cat with wry smile\u0001😽 kissing cat\u0001🙀 weary cat\u0001😿 crying cat\u0001😾 pouting cat\u0001🙈 see-no-evil monkey\u0001🙉 hear-no-evil monkey\u0001🙊 speak-no-evil monkey\u0001💌 love letter\u0001💘 heart with arrow\u0001💝 heart with ribbon\u0001💖 sparkling heart\u0001💗 growing heart\u0001💓 beating heart\u0001💞 revolving hearts\u0001💕 two hearts\u0001💟 heart decoration\u0001❣️ heart exclamation\u0001💔 broken heart\u0001❤️‍🔥 heart on fire\u0001❤️‍🩹 mending heart\u0001❤️ red heart\u0001🩷 pink heart\u0001🧡 orange heart\u0001💛 yellow heart\u0001💚 green heart\u0001💙 blue heart\u0001🩵 light blue heart\u0001💜 purple heart\u0001🤎 brown heart\u0001🖤 black heart\u0001🩶 grey heart\u0001🤍 white heart\u0001💋 kiss mark\u0001💯 hundred points\u0001💢 anger symbol\u0001🫯 fight cloud\u0001💥 collision\u0001💫 dizzy\u0001💦 sweat droplets\u0001💨 dashing away\u0001🕳️ hole\u0001💬 speech balloon\u0001👁️‍🗨️ eye in speech bubble\u0001🗨️ left speech bubble\u0001🗯️ right anger bubble\u0001💭 thought balloon\u0001💤 ZZZ"],
["People & Body","👋 waving hand\u0001🤚 raised back of hand\u0001🖐️ hand with fingers splayed\u0001✋ raised hand\u0001🖖 vulcan salute\u0001🫱 rightwards hand\u0001🫲 leftwards hand\u0001🫳 palm down hand\u0001🫴 palm up hand\u0001🫷 leftwards pushing hand\u0001🫸 rightwards pushing hand\u0001👌 OK hand\u0001🤌 pinched fingers\u0001🤏 pinching hand\u0001✌️ victory hand\u0001🤞 crossed fingers\u0001🫰 hand with index finger and thumb crossed\u0001🤟 love-you gesture\u0001🤘 sign of the horns\u0001🤙 call me hand\u0001👈 backhand index pointing left\u0001👉 backhand index pointing right\u0001👆 backhand index pointing up\u0001🖕 middle finger\u0001👇 backhand index pointing down\u0001☝️ index pointing up\u0001🫵 index pointing at the viewer\u0001👍 thumbs up\u0001👎 thumbs down\u0001🫹 leftwards thumb sign\u0001🫺 rightwards thumb sign\u0001✊ raised fist\u0001👊 oncoming fist\u0001🤛 left-facing fist\u0001🤜 right-facing fist\u0001👏 clapping hands\u0001🙌 raising hands\u0001🫶 heart hands\u0001👐 open hands\u0001🤲 palms up together\u0001🤝 handshake\u0001🙏 folded hands\u0001✍️ writing hand\u0001💅 nail polish\u0001🤳 selfie\u0001💪 flexed biceps\u0001🦾 mechanical arm\u0001🦿 mechanical leg\u0001🦵 leg\u0001🦶 foot\u0001👂 ear\u0001🦻 ear with hearing aid\u0001👃 nose\u0001🧠 brain\u0001🫀 anatomical heart\u0001🫁 lungs\u0001🦷 tooth\u0001🦴 bone\u0001👀 eyes\u0001👁️ eye\u0001👅 tongue\u0001👄 mouth\u0001🫦 biting lip\u0001👶 baby\u0001🧒 child\u0001👦 boy\u0001👧 girl\u0001🧑 person\u0001👱 person: blond hair\u0001👨 man\u0001🧔 person: beard\u0001🧔‍♂️ man: beard\u0001🧔‍♀️ woman: beard\u0001👨‍🦰 man: red hair\u0001👨‍🦱 man: curly hair\u0001👨‍🦳 man: white hair\u0001👨‍🦲 man: bald\u0001👩 woman\u0001👩‍🦰 woman: red hair\u0001🧑‍🦰 person: red hair\u0001👩‍🦱 woman: curly hair\u0001🧑‍🦱 person: curly hair\u0001👩‍🦳 woman: white hair\u0001🧑‍🦳 person: white hair\u0001👩‍🦲 woman: bald\u0001🧑‍🦲 person: bald\u0001👱‍♀️ woman: blond hair\u0001👱‍♂️ man: blond hair\u0001🧓 older person\u0001👴 old man\u0001👵 old woman\u0001🙍 person frowning\u0001🙍‍♂️ man frowning\u0001🙍‍♀️ woman frowning\u0001🙎 person pouting\u0001🙎‍♂️ man pouting\u0001🙎‍♀️ woman pouting\u0001🙅 person gesturing NO\u0001🙅‍♂️ man gesturing NO\u0001🙅‍♀️ woman gesturing NO\u0001🙆 person gesturing OK\u0001🙆‍♂️ man gesturing OK\u0001🙆‍♀️ woman gesturing OK\u0001💁 person tipping hand\u0001💁‍♂️ man tipping hand\u0001💁‍♀️ woman tipping hand\u0001🙋 person raising hand\u0001🙋‍♂️ man raising hand\u0001🙋‍♀️ woman raising hand\u0001🧏 deaf person\u0001🧏‍♂️ deaf man\u0001🧏‍♀️ deaf woman\u0001🙇 person bowing\u0001🙇‍♂️ man bowing\u0001🙇‍♀️ woman bowing\u0001🤦 person facepalming\u0001🤦‍♂️ man facepalming\u0001🤦‍♀️ woman facepalming\u0001🤷 person shrugging\u0001🤷‍♂️ man shrugging\u0001🤷‍♀️ woman shrugging\u0001🧑‍⚕️ health worker\u0001👨‍⚕️ man health worker\u0001👩‍⚕️ woman health worker\u0001🧑‍🎓 student\u0001👨‍🎓 man student\u0001👩‍🎓 woman student\u0001🧑‍🏫 teacher\u0001👨‍🏫 man teacher\u0001👩‍🏫 woman teacher\u0001🧑‍⚖️ judge\u0001👨‍⚖️ man judge\u0001👩‍⚖️ woman judge\u0001🧑‍🌾 farmer\u0001👨‍🌾 man farmer\u0001👩‍🌾 woman farmer\u0001🧑‍🍳 cook\u0001👨‍🍳 man cook\u0001👩‍🍳 woman cook\u0001🧑‍🔧 mechanic\u0001👨‍🔧 man mechanic\u0001👩‍🔧 woman mechanic\u0001🧑‍🏭 factory worker\u0001👨‍🏭 man factory worker\u0001👩‍🏭 woman factory worker\u0001🧑‍💼 office worker\u0001👨‍💼 man office worker\u0001👩‍💼 woman office worker\u0001🧑‍🔬 scientist\u0001👨‍🔬 man scientist\u0001👩‍🔬 woman scientist\u0001🧑‍💻 technologist\u0001👨‍💻 man technologist\u0001👩‍💻 woman technologist\u0001🧑‍🎤 singer\u0001👨‍🎤 man singer\u0001👩‍🎤 woman singer\u0001🧑‍🎨 artist\u0001👨‍🎨 man artist\u0001👩‍🎨 woman artist\u0001🧑‍✈️ pilot\u0001👨‍✈️ man pilot\u0001👩‍✈️ woman pilot\u0001🧑‍🚀 astronaut\u0001👨‍🚀 man astronaut\u0001👩‍🚀 woman astronaut\u0001🧑‍🚒 firefighter\u0001👨‍🚒 man firefighter\u0001👩‍🚒 woman firefighter\u0001👮 police officer\u0001👮‍♂️ man police officer\u0001👮‍♀️ woman police officer\u0001🕵️ detective\u0001🕵️‍♂️ man detective\u0001🕵️‍♀️ woman detective\u0001💂 guard\u0001💂‍♂️ man guard\u0001💂‍♀️ woman guard\u0001🥷 ninja\u0001👷 construction worker\u0001👷‍♂️ man construction worker\u0001👷‍♀️ woman construction worker\u0001🫅 person with crown\u0001🤴 prince\u0001👸 princess\u0001👳 person wearing turban\u0001👳‍♂️ man wearing turban\u0001👳‍♀️ woman wearing turban\u0001👲 person with skullcap\u0001🧕 woman with headscarf\u0001🤵 person in tuxedo\u0001🤵‍♂️ man in tuxedo\u0001🤵‍♀️ woman in tuxedo\u0001👰 person with veil\u0001👰‍♂️ man with veil\u0001👰‍♀️ woman with veil\u0001🤰 pregnant woman\u0001🫃 pregnant man\u0001🫄 pregnant person\u0001🤱 breast-feeding\u0001👩‍🍼 woman feeding baby\u0001👨‍🍼 man feeding baby\u0001🧑‍🍼 person feeding baby\u0001👼 baby angel\u0001🎅 Santa Claus\u0001🤶 Mrs. Claus\u0001🧑‍🎄 Mx Claus\u0001🦸 superhero\u0001🦸‍♂️ man superhero\u0001🦸‍♀️ woman superhero\u0001🦹 supervillain\u0001🦹‍♂️ man supervillain\u0001🦹‍♀️ woman supervillain\u0001🧙 mage\u0001🧙‍♂️ man mage\u0001🧙‍♀️ woman mage\u0001🧚 fairy\u0001🧚‍♂️ man fairy\u0001🧚‍♀️ woman fairy\u0001🧛 vampire\u0001🧛‍♂️ man vampire\u0001🧛‍♀️ woman vampire\u0001🧜 merperson\u0001🧜‍♂️ merman\u0001🧜‍♀️ mermaid\u0001🧝 elf\u0001🧝‍♂️ man elf\u0001🧝‍♀️ woman elf\u0001🧞 genie\u0001🧞‍♂️ man genie\u0001🧞‍♀️ woman genie\u0001🧟 zombie\u0001🧟‍♂️ man zombie\u0001🧟‍♀️ woman zombie\u0001🧌 troll\u0001🫈 hairy creature\u0001💆 person getting massage\u0001💆‍♂️ man getting massage\u0001💆‍♀️ woman getting massage\u0001💇 person getting haircut\u0001💇‍♂️ man getting haircut\u0001💇‍♀️ woman getting haircut\u0001🚶 person walking\u0001🚶‍♂️ man walking\u0001🚶‍♀️ woman walking\u0001🚶‍➡️ person walking facing right\u0001🚶‍♀️‍➡️ woman walking facing right\u0001🚶‍♂️‍➡️ man walking facing right\u0001🧍 person standing\u0001🧍‍♂️ man standing\u0001🧍‍♀️ woman standing\u0001🧎 person kneeling\u0001🧎‍♂️ man kneeling\u0001🧎‍♀️ woman kneeling\u0001🧎‍➡️ person kneeling facing right\u0001🧎‍♀️‍➡️ woman kneeling facing right\u0001🧎‍♂️‍➡️ man kneeling facing right\u0001🧑‍🦯 person with white cane\u0001🧑‍🦯‍➡️ person with white cane facing right\u0001👨‍🦯 man with white cane\u0001👨‍🦯‍➡️ man with white cane facing right\u0001👩‍🦯 woman with white cane\u0001👩‍🦯‍➡️ woman with white cane facing right\u0001🧑‍🦼 person in motorized wheelchair\u0001🧑‍🦼‍➡️ person in motorized wheelchair facing right\u0001👨‍🦼 man in motorized wheelchair\u0001👨‍🦼‍➡️ man in motorized wheelchair facing right\u0001👩‍🦼 woman in motorized wheelchair\u0001👩‍🦼‍➡️ woman in motorized wheelchair facing right\u0001🧑‍🦽 person in manual wheelchair\u0001🧑‍🦽‍➡️ person in manual wheelchair facing right\u0001👨‍🦽 man in manual wheelchair\u0001👨‍🦽‍➡️ man in manual wheelchair facing right\u0001👩‍🦽 woman in manual wheelchair\u0001👩‍🦽‍➡️ woman in manual wheelchair facing right\u0001🏃 person running\u0001🏃‍♂️ man running\u0001🏃‍♀️ woman running\u0001🏃‍➡️ person running facing right\u0001🏃‍♀️‍➡️ woman running facing right\u0001🏃‍♂️‍➡️ man running facing right\u0001🧑‍🩰 ballet dancer\u0001💃 woman dancing\u0001🕺 man dancing\u0001🕴️ person in suit levitating\u0001👯 people with bunny ears\u0001👯‍♂️ men with bunny ears\u0001👯‍♀️ women with bunny ears\u0001🧖 person in steamy room\u0001🧖‍♂️ man in steamy room\u0001🧖‍♀️ woman in steamy room\u0001🧗 person climbing\u0001🧗‍♂️ man climbing\u0001🧗‍♀️ woman climbing\u0001🤺 person fencing\u0001🏇 horse racing\u0001⛷️ skier\u0001🏂 snowboarder\u0001🏌️ person golfing\u0001🏌️‍♂️ man golfing\u0001🏌️‍♀️ woman golfing\u0001🏄 person surfing\u0001🏄‍♂️ man surfing\u0001🏄‍♀️ woman surfing\u0001🚣 person rowing boat\u0001🚣‍♂️ man rowing boat\u0001🚣‍♀️ woman rowing boat\u0001🏊 person swimming\u0001🏊‍♂️ man swimming\u0001🏊‍♀️ woman swimming\u0001⛹️ person bouncing ball\u0001⛹️‍♂️ man bouncing ball\u0001⛹️‍♀️ woman bouncing ball\u0001🏋️ person lifting weights\u0001🏋️‍♂️ man lifting weights\u0001🏋️‍♀️ woman lifting weights\u0001🚴 person biking\u0001🚴‍♂️ man biking\u0001🚴‍♀️ woman biking\u0001🚵 person mountain biking\u0001🚵‍♂️ man mountain biking\u0001🚵‍♀️ woman mountain biking\u0001🤸 person cartwheeling\u0001🤸‍♂️ man cartwheeling\u0001🤸‍♀️ woman cartwheeling\u0001🤼 people wrestling\u0001🤼‍♂️ men wrestling\u0001🤼‍♀️ women wrestling\u0001🤽 person playing water polo\u0001🤽‍♂️ man playing water polo\u0001🤽‍♀️ woman playing water polo\u0001🤾 person playing handball\u0001🤾‍♂️ man playing handball\u0001🤾‍♀️ woman playing handball\u0001🤹 person juggling\u0001🤹‍♂️ man juggling\u0001🤹‍♀️ woman juggling\u0001🧘 person in lotus position\u0001🧘‍♂️ man in lotus position\u0001🧘‍♀️ woman in lotus position\u0001🛀 person taking bath\u0001🛌 person in bed\u0001🧑‍🤝‍🧑 people holding hands\u0001👭 women holding hands\u0001👫 woman and man holding hands\u0001👬 men holding hands\u0001💏 kiss\u0001👩‍❤️‍💋‍👨 kiss: woman, man\u0001👨‍❤️‍💋‍👨 kiss: man, man\u0001👩‍❤️‍💋‍👩 kiss: woman, woman\u0001💑 couple with heart\u0001👩‍❤️‍👨 couple with heart: woman, man\u0001👨‍❤️‍👨 couple with heart: man, man\u0001👩‍❤️‍👩 couple with heart: woman, woman\u0001👨‍👩‍👦 family: man, woman, boy\u0001👨‍👩‍👧 family: man, woman, girl\u0001👨‍👩‍👧‍👦 family: man, woman, girl, boy\u0001👨‍👩‍👦‍👦 family: man, woman, boy, boy\u0001👨‍👩‍👧‍👧 family: man, woman, girl, girl\u0001👨‍👨‍👦 family: man, man, boy\u0001👨‍👨‍👧 family: man, man, girl\u0001👨‍👨‍👧‍👦 family: man, man, girl, boy\u0001👨‍👨‍👦‍👦 family: man, man, boy, boy\u0001👨‍👨‍👧‍👧 family: man, man, girl, girl\u0001👩‍👩‍👦 family: woman, woman, boy\u0001👩‍👩‍👧 family: woman, woman, girl\u0001👩‍👩‍👧‍👦 family: woman, woman, girl, boy\u0001👩‍👩‍👦‍👦 family: woman, woman, boy, boy\u0001👩‍👩‍👧‍👧 family: woman, woman, girl, girl\u0001👨‍👦 family: man, boy\u0001👨‍👦‍👦 family: man, boy, boy\u0001👨‍👧 family: man, girl\u0001👨‍👧‍👦 family: man, girl, boy\u0001👨‍👧‍👧 family: man, girl, girl\u0001👩‍👦 family: woman, boy\u0001👩‍👦‍👦 family: woman, boy, boy\u0001👩‍👧 family: woman, girl\u0001👩‍👧‍👦 family: woman, girl, boy\u0001👩‍👧‍👧 family: woman, girl, girl\u0001🗣️ speaking head\u0001👤 bust in silhouette\u0001👥 busts in silhouette\u0001🫂 people hugging\u0001👪 family\u0001🧑‍🧑‍🧒 family: adult, adult, child\u0001🧑‍🧑‍🧒‍🧒 family: adult, adult, child, child\u0001🧑‍🧒 family: adult, child\u0001🧑‍🧒‍🧒 family: adult, child, child\u0001👣 footprints\u0001🫆 fingerprint"],
["Animals & Nature","🐵 monkey face\u0001🐒 monkey\u0001🦍 gorilla\u0001🦧 orangutan\u0001🐶 dog face\u0001🐕 dog\u0001🦮 guide dog\u0001🐕‍🦺 service dog\u0001🐩 poodle\u0001🐺 wolf\u0001🦊 fox\u0001🦝 raccoon\u0001🐱 cat face\u0001🐈 cat\u0001🐈‍⬛ black cat\u0001🦁 lion\u0001🐯 tiger face\u0001🐅 tiger\u0001🐆 leopard\u0001🐴 horse face\u0001🫎 moose\u0001🫏 donkey\u0001🐎 horse\u0001🦄 unicorn\u0001🦓 zebra\u0001🦌 deer\u0001🦬 bison\u0001🐮 cow face\u0001🐂 ox\u0001🐃 water buffalo\u0001🐄 cow\u0001🐷 pig face\u0001🐖 pig\u0001🐗 boar\u0001🐽 pig nose\u0001🐏 ram\u0001🐑 ewe\u0001🐐 goat\u0001🐪 camel\u0001🐫 two-hump camel\u0001🦙 llama\u0001🦒 giraffe\u0001🐘 elephant\u0001🦣 mammoth\u0001🦏 rhinoceros\u0001🦛 hippopotamus\u0001🐭 mouse face\u0001🐁 mouse\u0001🐀 rat\u0001🐹 hamster\u0001🐰 rabbit face\u0001🐇 rabbit\u0001🐿️ chipmunk\u0001🦫 beaver\u0001🦔 hedgehog\u0001🦇 bat\u0001🐻 bear\u0001🐻‍❄️ polar bear\u0001🐨 koala\u0001🐼 panda\u0001🦥 sloth\u0001🦦 otter\u0001🦨 skunk\u0001🦘 kangaroo\u0001🦡 badger\u0001🐾 paw prints\u0001🦃 turkey\u0001🐔 chicken\u0001🐓 rooster\u0001🐣 hatching chick\u0001🐤 baby chick\u0001🐥 front-facing baby chick\u0001🐦 bird\u0001🐧 penguin\u0001🕊️ dove\u0001🦅 eagle\u0001🦆 duck\u0001🦢 swan\u0001🦉 owl\u0001🦤 dodo\u0001🪶 feather\u0001🦩 flamingo\u0001🦚 peacock\u0001🦜 parrot\u0001🪽 wing\u0001🐦‍⬛ black bird\u0001🪿 goose\u0001🐦‍🔥 phoenix\u0001🐸 frog\u0001🐊 crocodile\u0001🐢 turtle\u0001🦎 lizard\u0001🐍 snake\u0001🐲 dragon face\u0001🐉 dragon\u0001🦕 sauropod\u0001🦖 T-Rex\u0001🐳 spouting whale\u0001🐋 whale\u0001🐬 dolphin\u0001🫍 orca\u0001🦭 seal\u0001🐟 fish\u0001🐠 tropical fish\u0001🐡 blowfish\u0001🦈 shark\u0001🐙 octopus\u0001🐚 spiral shell\u0001🪸 coral\u0001🪼 jellyfish\u0001🦀 crab\u0001🦞 lobster\u0001🦐 shrimp\u0001🦑 squid\u0001🦪 oyster\u0001🐌 snail\u0001🦋 butterfly\u0001🫌 monarch butterfly\u0001🐛 bug\u0001🐜 ant\u0001🐝 honeybee\u0001🪲 beetle\u0001🐞 lady beetle\u0001🦗 cricket\u0001🪳 cockroach\u0001🕷️ spider\u0001🕸️ spider web\u0001🦂 scorpion\u0001🦟 mosquito\u0001🪰 fly\u0001🪱 worm\u0001🦠 microbe\u0001💐 bouquet\u0001🌸 cherry blossom\u0001💮 white flower\u0001🪷 lotus\u0001🏵️ rosette\u0001🌹 rose\u0001🥀 wilted flower\u0001🌺 hibiscus\u0001🌻 sunflower\u0001🌼 blossom\u0001🌷 tulip\u0001🪻 hyacinth\u0001🌱 seedling\u0001🪴 potted plant\u0001🌲 evergreen tree\u0001🌳 deciduous tree\u0001🌴 palm tree\u0001🌵 cactus\u0001🌾 sheaf of rice\u0001🌿 herb\u0001☘️ shamrock\u0001🍀 four leaf clover\u0001🍁 maple leaf\u0001🍂 fallen leaf\u0001🍃 leaf fluttering in wind\u0001🪹 empty nest\u0001🪺 nest with eggs\u0001🍄 mushroom\u0001🪾 leafless tree"],
["Food & Drink","🍇 grapes\u0001🍈 melon\u0001🍉 watermelon\u0001🍊 tangerine\u0001🍋 lemon\u0001🍋‍🟩 lime\u0001🍌 banana\u0001🍍 pineapple\u0001🥭 mango\u0001🍎 red apple\u0001🍏 green apple\u0001🍐 pear\u0001🍑 peach\u0001🍒 cherries\u0001🍓 strawberry\u0001🫐 blueberries\u0001🥝 kiwi fruit\u0001🍅 tomato\u0001🫒 olive\u0001🥥 coconut\u0001🥑 avocado\u0001🍆 eggplant\u0001🥔 potato\u0001🥕 carrot\u0001🌽 ear of corn\u0001🌶️ hot pepper\u0001🫑 bell pepper\u0001🥒 cucumber\u0001🫝 pickle\u0001🥬 leafy green\u0001🥦 broccoli\u0001🧄 garlic\u0001🧅 onion\u0001🥜 peanuts\u0001🫘 beans\u0001🌰 chestnut\u0001🫚 ginger root\u0001🫛 pea pod\u0001🍄‍🟫 brown mushroom\u0001🫜 root vegetable\u0001🍞 bread\u0001🥐 croissant\u0001🥖 baguette bread\u0001🫓 flatbread\u0001🥨 pretzel\u0001🥯 bagel\u0001🥞 pancakes\u0001🧇 waffle\u0001🧀 cheese wedge\u0001🍖 meat on bone\u0001🍗 poultry leg\u0001🥩 cut of meat\u0001🥓 bacon\u0001🍔 hamburger\u0001🍟 french fries\u0001🍕 pizza\u0001🌭 hot dog\u0001🥪 sandwich\u0001🌮 taco\u0001🌯 burrito\u0001🫔 tamale\u0001🥙 stuffed flatbread\u0001🧆 falafel\u0001🥚 egg\u0001🍳 cooking\u0001🥘 shallow pan of food\u0001🍲 pot of food\u0001🫕 fondue\u0001🥣 bowl with spoon\u0001🥗 green salad\u0001🍿 popcorn\u0001🧈 butter\u0001🧂 salt\u0001🥫 canned food\u0001🍱 bento box\u0001🍘 rice cracker\u0001🍙 rice ball\u0001🍚 cooked rice\u0001🍛 curry rice\u0001🍜 steaming bowl\u0001🍝 spaghetti\u0001🍠 roasted sweet potato\u0001🍢 oden\u0001🍣 sushi\u0001🍤 fried shrimp\u0001🍥 fish cake with swirl\u0001🥮 moon cake\u0001🍡 dango\u0001🥟 dumpling\u0001🥠 fortune cookie\u0001🥡 takeout box\u0001🍦 soft ice cream\u0001🍧 shaved ice\u0001🍨 ice cream\u0001🍩 doughnut\u0001🍪 cookie\u0001🎂 birthday cake\u0001🍰 shortcake\u0001🧁 cupcake\u0001🥧 pie\u0001🍫 chocolate bar\u0001🍬 candy\u0001🍭 lollipop\u0001🍮 custard\u0001🍯 honey pot\u0001🍼 baby bottle\u0001🥛 glass of milk\u0001☕ hot beverage\u0001🫖 teapot\u0001🍵 teacup without handle\u0001🍶 sake\u0001🍾 bottle with popping cork\u0001🍷 wine glass\u0001🍸 cocktail glass\u0001🍹 tropical drink\u0001🍺 beer mug\u0001🍻 clinking beer mugs\u0001🥂 clinking glasses\u0001🥃 tumbler glass\u0001🫗 pouring liquid\u0001🥤 cup with straw\u0001🧋 bubble tea\u0001🧃 beverage box\u0001🧉 mate\u0001🧊 ice\u0001🥢 chopsticks\u0001🍽️ fork and knife with plate\u0001🍴 fork and knife\u0001🥄 spoon\u0001🔪 kitchen knife\u0001🫙 jar\u0001🏺 amphora"],
["Travel & Places","🌍 globe showing Europe-Africa\u0001🌎 globe showing Americas\u0001🌏 globe showing Asia-Australia\u0001🌐 globe with meridians\u0001🗺️ world map\u0001🗾 map of Japan\u0001🧭 compass\u0001🏔️ snow-capped mountain\u0001⛰️ mountain\u0001🛘 landslide\u0001🌋 volcano\u0001🗻 mount fuji\u0001🏕️ camping\u0001🏖️ beach with umbrella\u0001🏜️ desert\u0001🏝️ desert island\u0001🏞️ national park\u0001🏟️ stadium\u0001🏛️ classical building\u0001🏗️ building construction\u0001🧱 brick\u0001🪨 rock\u0001🪵 wood\u0001🛖 hut\u0001🏘️ houses\u0001🏚️ derelict house\u0001🏠 house\u0001🏡 house with garden\u0001🏢 office building\u0001🏣 Japanese post office\u0001🏤 post office\u0001🏥 hospital\u0001🏦 bank\u0001🏨 hotel\u0001🏩 love hotel\u0001🏪 convenience store\u0001🏫 school\u0001🏬 department store\u0001🏭 factory\u0001🏯 Japanese castle\u0001🏰 castle\u0001💒 wedding\u0001🗼 Tokyo tower\u0001🗽 Statue of Liberty\u0001⛪ church\u0001🕌 mosque\u0001🛕 hindu temple\u0001🕍 synagogue\u0001⛩️ shinto shrine\u0001🕋 kaaba\u0001⛲ fountain\u0001⛺ tent\u0001🌁 foggy\u0001🌃 night with stars\u0001🏙️ cityscape\u0001🌄 sunrise over mountains\u0001🌅 sunrise\u0001🌆 cityscape at dusk\u0001🌇 sunset\u0001🌉 bridge at night\u0001♨️ hot springs\u0001🎠 carousel horse\u0001🛝 playground slide\u0001🎡 ferris wheel\u0001🎢 roller coaster\u0001💈 barber pole\u0001🎪 circus tent\u0001🚂 locomotive\u0001🚃 railway car\u0001🚄 high-speed train\u0001🚅 bullet train\u0001🚆 train\u0001🚇 metro\u0001🚈 light rail\u0001🚉 station\u0001🚊 tram\u0001🚝 monorail\u0001🚞 mountain railway\u0001🚋 tram car\u0001🚌 bus\u0001🚍 oncoming bus\u0001🚎 trolleybus\u0001🚐 minibus\u0001🚑 ambulance\u0001🚒 fire engine\u0001🚓 police car\u0001🚔 oncoming police car\u0001🚕 taxi\u0001🚖 oncoming taxi\u0001🚗 automobile\u0001🚘 oncoming automobile\u0001🚙 sport utility vehicle\u0001🛻 pickup truck\u0001🚚 delivery truck\u0001🚛 articulated lorry\u0001🚜 tractor\u0001🏎️ racing car\u0001🏍️ motorcycle\u0001🛵 motor scooter\u0001🦽 manual wheelchair\u0001🦼 motorized wheelchair\u0001🛺 auto rickshaw\u0001🚲 bicycle\u0001🛴 kick scooter\u0001🛹 skateboard\u0001🛼 roller skate\u0001🚏 bus stop\u0001🛣️ motorway\u0001🛤️ railway track\u0001🛢️ oil drum\u0001⛽ fuel pump\u0001🛞 wheel\u0001🚨 police car light\u0001🚥 horizontal traffic light\u0001🚦 vertical traffic light\u0001🛑 stop sign\u0001🚧 construction\u0001🛙 lighthouse\u0001⚓ anchor\u0001🛟 ring buoy\u0001⛵ sailboat\u0001🛶 canoe\u0001🚤 speedboat\u0001🛳️ passenger ship\u0001⛴️ ferry\u0001🛥️ motor boat\u0001🚢 ship\u0001✈️ airplane\u0001🛩️ small airplane\u0001🛫 airplane departure\u0001🛬 airplane arrival\u0001🪂 parachute\u0001💺 seat\u0001🚁 helicopter\u0001🚟 suspension railway\u0001🚠 mountain cableway\u0001🚡 aerial tramway\u0001🛰️ satellite\u0001🚀 rocket\u0001🛸 flying saucer\u0001🛎️ bellhop bell\u0001🧳 luggage\u0001⌛ hourglass done\u0001⏳ hourglass not done\u0001⌚ watch\u0001⏰ alarm clock\u0001⏱️ stopwatch\u0001⏲️ timer clock\u0001🕰️ mantelpiece clock\u0001🕛 twelve o’clock\u0001🕧 twelve-thirty\u0001🕐 one o’clock\u0001🕜 one-thirty\u0001🕑 two o’clock\u0001🕝 two-thirty\u0001🕒 three o’clock\u0001🕞 three-thirty\u0001🕓 four o’clock\u0001🕟 four-thirty\u0001🕔 five o’clock\u0001🕠 five-thirty\u0001🕕 six o’clock\u0001🕡 six-thirty\u0001🕖 seven o’clock\u0001🕢 seven-thirty\u0001🕗 eight o’clock\u0001🕣 eight-thirty\u0001🕘 nine o’clock\u0001🕤 nine-thirty\u0001🕙 ten o’clock\u0001🕥 ten-thirty\u0001🕚 eleven o’clock\u0001🕦 eleven-thirty\u0001🌑 new moon\u0001🌒 waxing crescent moon\u0001🌓 first quarter moon\u0001🌔 waxing gibbous moon\u0001🌕 full moon\u0001🌖 waning gibbous moon\u0001🌗 last quarter moon\u0001🌘 waning crescent moon\u0001🌙 crescent moon\u0001🌚 new moon face\u0001🌛 first quarter moon face\u0001🌜 last quarter moon face\u0001🌡️ thermometer\u0001☀️ sun\u0001🌝 full moon face\u0001🌞 sun with face\u0001🪐 ringed planet\u0001⭐ star\u0001🌟 glowing star\u0001🌠 shooting star\u0001🌌 milky way\u0001☁️ cloud\u0001⛅ sun behind cloud\u0001⛈️ cloud with lightning and rain\u0001🌤️ sun behind small cloud\u0001🌥️ sun behind large cloud\u0001🌦️ sun behind rain cloud\u0001🌧️ cloud with rain\u0001🌨️ cloud with snow\u0001🌩️ cloud with lightning\u0001🌪️ tornado\u0001🌫️ fog\u0001🌬️ wind face\u0001🌀 cyclone\u0001🌈 rainbow\u0001🌂 closed umbrella\u0001☂️ umbrella\u0001☔ umbrella with rain drops\u0001⛱️ umbrella on ground\u0001⚡ high voltage\u0001❄️ snowflake\u0001☃️ snowman\u0001⛄ snowman without snow\u0001☄️ comet\u0001🪋 meteor\u0001🔥 fire\u0001💧 droplet\u0001🌊 water wave"],
["Activities","🎃 jack-o-lantern\u0001🎄 Christmas tree\u0001🎆 fireworks\u0001🎇 sparkler\u0001🧨 firecracker\u0001✨ sparkles\u0001🎈 balloon\u0001🎉 party popper\u0001🎊 confetti ball\u0001🎋 tanabata tree\u0001🎍 pine decoration\u0001🎎 Japanese dolls\u0001🎏 carp streamer\u0001🎐 wind chime\u0001🎑 moon viewing ceremony\u0001🧧 red envelope\u0001🎀 ribbon\u0001🎁 wrapped gift\u0001🎗️ reminder ribbon\u0001🎟️ admission tickets\u0001🎫 ticket\u0001🎖️ military medal\u0001🏆 trophy\u0001🏅 sports medal\u0001🥇 1st place medal\u0001🥈 2nd place medal\u0001🥉 3rd place medal\u0001⚽ soccer ball\u0001⚾ baseball\u0001🥎 softball\u0001🏀 basketball\u0001🏐 volleyball\u0001🏈 american football\u0001🏉 rugby football\u0001🎾 tennis\u0001🥏 flying disc\u0001🎳 bowling\u0001🏏 cricket game\u0001🏑 field hockey\u0001🏒 ice hockey\u0001🥍 lacrosse\u0001🏓 ping pong\u0001🏸 badminton\u0001🥊 boxing glove\u0001🥋 martial arts uniform\u0001🥅 goal net\u0001⛳ flag in hole\u0001⛸️ ice skate\u0001🎣 fishing pole\u0001🤿 diving mask\u0001🎽 running shirt\u0001🎿 skis\u0001🛷 sled\u0001🥌 curling stone\u0001🎯 bullseye\u0001🪀 yo-yo\u0001🪁 kite\u0001🔫 water pistol\u0001🎱 pool 8 ball\u0001🔮 crystal ball\u0001🪄 magic wand\u0001🎮 video game\u0001🕹️ joystick\u0001🎰 slot machine\u0001🎲 game die\u0001🧩 puzzle piece\u0001🧸 teddy bear\u0001🪅 piñata\u0001🪩 mirror ball\u0001🪆 nesting dolls\u0001♠️ spade suit\u0001♥️ heart suit\u0001♦️ diamond suit\u0001♣️ club suit\u0001♟️ chess pawn\u0001🃏 joker\u0001🀄 mahjong red dragon\u0001🎴 flower playing cards\u0001🎭 performing arts\u0001🖼️ framed picture\u0001🎨 artist palette\u0001🧵 thread\u0001🪡 sewing needle\u0001🧶 yarn\u0001🪢 knot"],
["Objects","👓 glasses\u0001🕶️ sunglasses\u0001🥽 goggles\u0001🥼 lab coat\u0001🦺 safety vest\u0001👔 necktie\u0001👕 t-shirt\u0001👖 jeans\u0001🧣 scarf\u0001🧤 gloves\u0001🧥 coat\u0001🧦 socks\u0001👗 dress\u0001👘 kimono\u0001🥻 sari\u0001🩱 one-piece swimsuit\u0001🩲 briefs\u0001🩳 shorts\u0001👙 bikini\u0001👚 woman’s clothes\u0001🪭 folding hand fan\u0001👛 purse\u0001👜 handbag\u0001👝 clutch bag\u0001🛍️ shopping bags\u0001🎒 backpack\u0001🩴 thong sandal\u0001👞 man’s shoe\u0001👟 running shoe\u0001🥾 hiking boot\u0001🥿 flat shoe\u0001👠 high-heeled shoe\u0001👡 woman’s sandal\u0001🩰 ballet shoes\u0001👢 woman’s boot\u0001🪮 hair pick\u0001👑 crown\u0001👒 woman’s hat\u0001🎩 top hat\u0001🎓 graduation cap\u0001🧢 billed cap\u0001🪖 military helmet\u0001⛑️ rescue worker’s helmet\u0001📿 prayer beads\u0001💄 lipstick\u0001💍 ring\u0001💎 gem stone\u0001🔇 muted speaker\u0001🔈 speaker low volume\u0001🔉 speaker medium volume\u0001🔊 speaker high volume\u0001📢 loudspeaker\u0001📣 megaphone\u0001📯 postal horn\u0001🔔 bell\u0001🔕 bell with slash\u0001🎼 musical score\u0001🎵 musical note\u0001🎶 musical notes\u0001🎙️ studio microphone\u0001🎚️ level slider\u0001🎛️ control knobs\u0001🎤 microphone\u0001🎧 headphone\u0001📻 radio\u0001🎷 saxophone\u0001🎺 trumpet\u0001🪊 trombone\u0001🪗 accordion\u0001🎸 guitar\u0001🎹 musical keyboard\u0001🎻 violin\u0001🪕 banjo\u0001🥁 drum\u0001🪘 long drum\u0001🪇 maracas\u0001🪈 flute\u0001🪉 harp\u0001📱 mobile phone\u0001📲 mobile phone with arrow\u0001☎️ telephone\u0001📞 telephone receiver\u0001📟 pager\u0001📠 fax machine\u0001🔋 battery\u0001🪫 low battery\u0001🔌 electric plug\u0001💻 laptop\u0001🖥️ desktop computer\u0001🖨️ printer\u0001⌨️ keyboard\u0001🖱️ computer mouse\u0001🖲️ trackball\u0001💽 computer disk\u0001💾 floppy disk\u0001💿 optical disk\u0001📀 dvd\u0001🧮 abacus\u0001🎥 movie camera\u0001🎞️ film frames\u0001📽️ film projector\u0001🎬 clapper board\u0001📺 television\u0001📷 camera\u0001📸 camera with flash\u0001📹 video camera\u0001📼 videocassette\u0001🔍 magnifying glass tilted left\u0001🔎 magnifying glass tilted right\u0001🕯️ candle\u0001💡 light bulb\u0001🔦 flashlight\u0001🏮 red paper lantern\u0001🪔 diya lamp\u0001📔 notebook with decorative cover\u0001📕 closed book\u0001📖 open book\u0001📗 green book\u0001📘 blue book\u0001📙 orange book\u0001📚 books\u0001📓 notebook\u0001📒 ledger\u0001📃 page with curl\u0001📜 scroll\u0001📄 page facing up\u0001📰 newspaper\u0001🗞️ rolled-up newspaper\u0001📑 bookmark tabs\u0001🔖 bookmark\u0001🏷️ label\u0001🪙 coin\u0001💰 money bag\u0001🪎 treasure chest\u0001💴 yen banknote\u0001💵 dollar banknote\u0001💶 euro banknote\u0001💷 pound banknote\u0001💸 money with wings\u0001💳 credit card\u0001🧾 receipt\u0001💹 chart increasing with yen\u0001✉️ envelope\u0001📧 e-mail\u0001📨 incoming envelope\u0001📩 envelope with arrow\u0001📤 outbox tray\u0001📥 inbox tray\u0001📦 package\u0001📫 closed mailbox with raised flag\u0001📪 closed mailbox with lowered flag\u0001📬 open mailbox with raised flag\u0001📭 open mailbox with lowered flag\u0001📮 postbox\u0001🗳️ ballot box with ballot\u0001✏️ pencil\u0001✒️ black nib\u0001🖋️ fountain pen\u0001🖊️ pen\u0001🖌️ paintbrush\u0001🖍️ crayon\u0001📝 memo\u0001🪌 eraser\u0001💼 briefcase\u0001📁 file folder\u0001📂 open file folder\u0001🗂️ card index dividers\u0001📅 calendar\u0001📆 tear-off calendar\u0001🗒️ spiral notepad\u0001🗓️ spiral calendar\u0001📇 card index\u0001📈 chart increasing\u0001📉 chart decreasing\u0001📊 bar chart\u0001📋 clipboard\u0001📌 pushpin\u0001📍 round pushpin\u0001📎 paperclip\u0001🖇️ linked paperclips\u0001📏 straight ruler\u0001📐 triangular ruler\u0001✂️ scissors\u0001🗃️ card file box\u0001🗄️ file cabinet\u0001🗑️ wastebasket\u0001🔒 locked\u0001🔓 unlocked\u0001🔏 locked with pen\u0001🔐 locked with key\u0001🔑 key\u0001🗝️ old key\u0001🪍 net with handle\u0001🔨 hammer\u0001🪓 axe\u0001⛏️ pick\u0001⚒️ hammer and pick\u0001🛠️ hammer and wrench\u0001🗡️ dagger\u0001⚔️ crossed swords\u0001💣 bomb\u0001🪃 boomerang\u0001🏹 bow and arrow\u0001🛡️ shield\u0001🪚 carpentry saw\u0001🔧 wrench\u0001🪛 screwdriver\u0001🔩 nut and bolt\u0001⚙️ gear\u0001🗜️ clamp\u0001⚖️ balance scale\u0001🦯 white cane\u0001🔗 link\u0001⛓️‍💥 broken chain\u0001⛓️ chains\u0001🪝 hook\u0001🧰 toolbox\u0001🧲 magnet\u0001🪜 ladder\u0001🪏 shovel\u0001⚗️ alembic\u0001🧪 test tube\u0001🧫 petri dish\u0001🧬 dna\u0001🔬 microscope\u0001🔭 telescope\u0001📡 satellite antenna\u0001💉 syringe\u0001🩸 drop of blood\u0001💊 pill\u0001🩹 adhesive bandage\u0001🩼 crutch\u0001🩺 stethoscope\u0001🩻 x-ray\u0001🚪 door\u0001🛗 elevator\u0001🪞 mirror\u0001🪟 window\u0001🛏️ bed\u0001🛋️ couch and lamp\u0001🪑 chair\u0001🚽 toilet\u0001🪠 plunger\u0001🚿 shower\u0001🛁 bathtub\u0001🪤 mouse trap\u0001🪒 razor\u0001🧴 lotion bottle\u0001🧷 safety pin\u0001🧹 broom\u0001🧺 basket\u0001🧻 roll of paper\u0001🪣 bucket\u0001🧼 soap\u0001🫧 bubbles\u0001🪥 toothbrush\u0001🧽 sponge\u0001🧯 fire extinguisher\u0001🛒 shopping cart\u0001🚬 cigarette\u0001⚰️ coffin\u0001🪦 headstone\u0001⚱️ funeral urn\u0001🧿 nazar amulet\u0001🪬 hamsa\u0001🗿 moai\u0001🪧 placard\u0001🪪 identification card"],
["Symbols","🏧 ATM sign\u0001🚮 litter in bin sign\u0001🚰 potable water\u0001♿ wheelchair symbol\u0001🚹 men’s room\u0001🚺 women’s room\u0001🚻 restroom\u0001🚼 baby symbol\u0001🚾 water closet\u0001🛂 passport control\u0001🛃 customs\u0001🛄 baggage claim\u0001🛅 left luggage\u0001⚠️ warning\u0001🚸 children crossing\u0001⛔ no entry\u0001🚫 prohibited\u0001🚳 no bicycles\u0001🚭 no smoking\u0001🚯 no littering\u0001🚱 non-potable water\u0001🚷 no pedestrians\u0001📵 no mobile phones\u0001🔞 no one under eighteen\u0001☢️ radioactive\u0001☣️ biohazard\u0001⬆️ up arrow\u0001↗️ up-right arrow\u0001➡️ right arrow\u0001↘️ down-right arrow\u0001⬇️ down arrow\u0001↙️ down-left arrow\u0001⬅️ left arrow\u0001↖️ up-left arrow\u0001↕️ up-down arrow\u0001↔️ left-right arrow\u0001↩️ right arrow curving left\u0001↪️ left arrow curving right\u0001⤴️ right arrow curving up\u0001⤵️ right arrow curving down\u0001🔃 clockwise vertical arrows\u0001🔄 counterclockwise arrows button\u0001🔙 BACK arrow\u0001🔚 END arrow\u0001🔛 ON! arrow\u0001🔜 SOON arrow\u0001🔝 TOP arrow\u0001🛐 place of worship\u0001⚛️ atom symbol\u0001🕉️ om\u0001✡️ star of David\u0001☸️ wheel of dharma\u0001☯️ yin yang\u0001✝️ latin cross\u0001☦️ orthodox cross\u0001☪️ star and crescent\u0001☮️ peace symbol\u0001🕎 menorah\u0001🔯 dotted six-pointed star\u0001🪯 khanda\u0001♈ Aries\u0001♉ Taurus\u0001♊ Gemini\u0001♋ Cancer\u0001♌ Leo\u0001♍ Virgo\u0001♎ Libra\u0001♏ Scorpio\u0001♐ Sagittarius\u0001♑ Capricorn\u0001♒ Aquarius\u0001♓ Pisces\u0001⛎ Ophiuchus\u0001🔀 shuffle tracks button\u0001🔁 repeat button\u0001🔂 repeat single button\u0001▶️ play button\u0001⏩ fast-forward button\u0001⏭️ next track button\u0001⏯️ play or pause button\u0001◀️ reverse button\u0001⏪ fast reverse button\u0001⏮️ last track button\u0001🔼 upwards button\u0001⏫ fast up button\u0001🔽 downwards button\u0001⏬ fast down button\u0001⏸️ pause button\u0001⏹️ stop button\u0001⏺️ record button\u0001⏏️ eject button\u0001🎦 cinema\u0001🔅 dim button\u0001🔆 bright button\u0001📶 antenna bars\u0001🛜 wireless\u0001📳 vibration mode\u0001📴 mobile phone off\u0001♀️ female sign\u0001♂️ male sign\u0001⚧️ transgender symbol\u0001✖️ multiply\u0001➕ plus\u0001➖ minus\u0001➗ divide\u0001🟰 heavy equals sign\u0001♾️ infinity\u0001‼️ double exclamation mark\u0001⁉️ exclamation question mark\u0001❓ red question mark\u0001❔ white question mark\u0001❕ white exclamation mark\u0001❗ red exclamation mark\u0001〰️ wavy dash\u0001💱 currency exchange\u0001💲 heavy dollar sign\u0001⚕️ medical symbol\u0001♻️ recycling symbol\u0001⚜️ fleur-de-lis\u0001🔱 trident emblem\u0001📛 name badge\u0001🔰 Japanese symbol for beginner\u0001⭕ hollow red circle\u0001✅ check mark button\u0001☑️ check box with check\u0001✔️ check mark\u0001❌ cross mark\u0001❎ cross mark button\u0001➰ curly loop\u0001➿ double curly loop\u0001〽️ part alternation mark\u0001✳️ eight-spoked asterisk\u0001✴️ eight-pointed star\u0001❇️ sparkle\u0001©️ copyright\u0001®️ registered\u0001™️ trade mark\u0001🫟 splatter\u0001#️⃣ keycap: #\u0001*️⃣ keycap: *\u00010️⃣ keycap: 0\u00011️⃣ keycap: 1\u00012️⃣ keycap: 2\u00013️⃣ keycap: 3\u00014️⃣ keycap: 4\u00015️⃣ keycap: 5\u00016️⃣ keycap: 6\u00017️⃣ keycap: 7\u00018️⃣ keycap: 8\u00019️⃣ keycap: 9\u0001🔟 keycap: 10\u0001🔠 input latin uppercase\u0001🔡 input latin lowercase\u0001🔢 input numbers\u0001🔣 input symbols\u0001🔤 input latin letters\u0001🅰️ A button (blood type)\u0001🆎 AB button (blood type)\u0001🅱️ B button (blood type)\u0001🆑 CL button\u0001🆒 COOL button\u0001🆓 FREE button\u0001ℹ️ information\u0001🆔 ID button\u0001Ⓜ️ circled M\u0001🆕 NEW button\u0001🆖 NG button\u0001🅾️ O button (blood type)\u0001🆗 OK button\u0001🅿️ P button\u0001🆘 SOS button\u0001🆙 UP! button\u0001🆚 VS button\u0001🈁 Japanese “here” button\u0001🈂️ Japanese “service charge” button\u0001🈷️ Japanese “monthly amount” button\u0001🈶 Japanese “not free of charge” button\u0001🈯 Japanese “reserved” button\u0001🉐 Japanese “bargain” button\u0001🈹 Japanese “discount” button\u0001🈚 Japanese “free of charge” button\u0001🈲 Japanese “prohibited” button\u0001🉑 Japanese “acceptable” button\u0001🈸 Japanese “application” button\u0001🈴 Japanese “passing grade” button\u0001🈳 Japanese “vacancy” button\u0001㊗️ Japanese “congratulations” button\u0001㊙️ Japanese “secret” button\u0001🈺 Japanese “open for business” button\u0001🈵 Japanese “no vacancy” button\u0001🔴 red circle\u0001🟠 orange circle\u0001🟡 yellow circle\u0001🟢 green circle\u0001🔵 blue circle\u0001🟣 purple circle\u0001🟤 brown circle\u0001⚫ black circle\u0001⚪ white circle\u0001🟥 red square\u0001🟧 orange square\u0001🟨 yellow square\u0001🟩 green square\u0001🟦 blue square\u0001🟪 purple square\u0001🟫 brown square\u0001⬛ black large square\u0001⬜ white large square\u0001◼️ black medium square\u0001◻️ white medium square\u0001◾ black medium-small square\u0001◽ white medium-small square\u0001▪️ black small square\u0001▫️ white small square\u0001🔶 large orange diamond\u0001🔷 large blue diamond\u0001🔸 small orange diamond\u0001🔹 small blue diamond\u0001🔺 red triangle pointed up\u0001🔻 red triangle pointed down\u0001💠 diamond with a dot\u0001🔘 radio button\u0001🔳 white square button\u0001🔲 black square button"],
["Flags","🏁 chequered flag\u0001🚩 triangular flag\u0001🎌 crossed flags\u0001🏴 black flag\u0001🏳️ white flag\u0001🏳️‍🌈 rainbow flag\u0001🏳️‍⚧️ transgender flag\u0001🏴‍☠️ pirate flag\u0001🇦🇨 flag: Ascension Island\u0001🇦🇩 flag: Andorra\u0001🇦🇪 flag: United Arab Emirates\u0001🇦🇫 flag: Afghanistan\u0001🇦🇬 flag: Antigua & Barbuda\u0001🇦🇮 flag: Anguilla\u0001🇦🇱 flag: Albania\u0001🇦🇲 flag: Armenia\u0001🇦🇴 flag: Angola\u0001🇦🇶 flag: Antarctica\u0001🇦🇷 flag: Argentina\u0001🇦🇸 flag: American Samoa\u0001🇦🇹 flag: Austria\u0001🇦🇺 flag: Australia\u0001🇦🇼 flag: Aruba\u0001🇦🇽 flag: Åland Islands\u0001🇦🇿 flag: Azerbaijan\u0001🇧🇦 flag: Bosnia & Herzegovina\u0001🇧🇧 flag: Barbados\u0001🇧🇩 flag: Bangladesh\u0001🇧🇪 flag: Belgium\u0001🇧🇫 flag: Burkina Faso\u0001🇧🇬 flag: Bulgaria\u0001🇧🇭 flag: Bahrain\u0001🇧🇮 flag: Burundi\u0001🇧🇯 flag: Benin\u0001🇧🇱 flag: St. Barthélemy\u0001🇧🇲 flag: Bermuda\u0001🇧🇳 flag: Brunei\u0001🇧🇴 flag: Bolivia\u0001🇧🇶 flag: Caribbean Netherlands\u0001🇧🇷 flag: Brazil\u0001🇧🇸 flag: Bahamas\u0001🇧🇹 flag: Bhutan\u0001🇧🇻 flag: Bouvet Island\u0001🇧🇼 flag: Botswana\u0001🇧🇾 flag: Belarus\u0001🇧🇿 flag: Belize\u0001🇨🇦 flag: Canada\u0001🇨🇨 flag: Cocos (Keeling) Islands\u0001🇨🇩 flag: Congo - Kinshasa\u0001🇨🇫 flag: Central African Republic\u0001🇨🇬 flag: Congo - Brazzaville\u0001🇨🇭 flag: Switzerland\u0001🇨🇮 flag: Côte d’Ivoire\u0001🇨🇰 flag: Cook Islands\u0001🇨🇱 flag: Chile\u0001🇨🇲 flag: Cameroon\u0001🇨🇳 flag: China\u0001🇨🇴 flag: Colombia\u0001🇨🇵 flag: Clipperton Island\u0001🇨🇶 flag: Sark\u0001🇨🇷 flag: Costa Rica\u0001🇨🇺 flag: Cuba\u0001🇨🇻 flag: Cape Verde\u0001🇨🇼 flag: Curaçao\u0001🇨🇽 flag: Christmas Island\u0001🇨🇾 flag: Cyprus\u0001🇨🇿 flag: Czechia\u0001🇩🇪 flag: Germany\u0001🇩🇬 flag: Diego Garcia\u0001🇩🇯 flag: Djibouti\u0001🇩🇰 flag: Denmark\u0001🇩🇲 flag: Dominica\u0001🇩🇴 flag: Dominican Republic\u0001🇩🇿 flag: Algeria\u0001🇪🇦 flag: Ceuta & Melilla\u0001🇪🇨 flag: Ecuador\u0001🇪🇪 flag: Estonia\u0001🇪🇬 flag: Egypt\u0001🇪🇭 flag: Western Sahara\u0001🇪🇷 flag: Eritrea\u0001🇪🇸 flag: Spain\u0001🇪🇹 flag: Ethiopia\u0001🇪🇺 flag: European Union\u0001🇫🇮 flag: Finland\u0001🇫🇯 flag: Fiji\u0001🇫🇰 flag: Falkland Islands\u0001🇫🇲 flag: Micronesia\u0001🇫🇴 flag: Faroe Islands\u0001🇫🇷 flag: France\u0001🇬🇦 flag: Gabon\u0001🇬🇧 flag: United Kingdom\u0001🇬🇩 flag: Grenada\u0001🇬🇪 flag: Georgia\u0001🇬🇫 flag: French Guiana\u0001🇬🇬 flag: Guernsey\u0001🇬🇭 flag: Ghana\u0001🇬🇮 flag: Gibraltar\u0001🇬🇱 flag: Greenland\u0001🇬🇲 flag: Gambia\u0001🇬🇳 flag: Guinea\u0001🇬🇵 flag: Guadeloupe\u0001🇬🇶 flag: Equatorial Guinea\u0001🇬🇷 flag: Greece\u0001🇬🇸 flag: South Georgia & South Sandwich Islands\u0001🇬🇹 flag: Guatemala\u0001🇬🇺 flag: Guam\u0001🇬🇼 flag: Guinea-Bissau\u0001🇬🇾 flag: Guyana\u0001🇭🇰 flag: Hong Kong SAR China\u0001🇭🇲 flag: Heard Island & McDonald Islands\u0001🇭🇳 flag: Honduras\u0001🇭🇷 flag: Croatia\u0001🇭🇹 flag: Haiti\u0001🇭🇺 flag: Hungary\u0001🇮🇨 flag: Canary Islands\u0001🇮🇩 flag: Indonesia\u0001🇮🇪 flag: Ireland\u0001🇮🇱 flag: Israel\u0001🇮🇲 flag: Isle of Man\u0001🇮🇳 flag: India\u0001🇮🇴 flag: British Indian Ocean Territory\u0001🇮🇶 flag: Iraq\u0001🇮🇷 flag: Iran\u0001🇮🇸 flag: Iceland\u0001🇮🇹 flag: Italy\u0001🇯🇪 flag: Jersey\u0001🇯🇲 flag: Jamaica\u0001🇯🇴 flag: Jordan\u0001🇯🇵 flag: Japan\u0001🇰🇪 flag: Kenya\u0001🇰🇬 flag: Kyrgyzstan\u0001🇰🇭 flag: Cambodia\u0001🇰🇮 flag: Kiribati\u0001🇰🇲 flag: Comoros\u0001🇰🇳 flag: St. Kitts & Nevis\u0001🇰🇵 flag: North Korea\u0001🇰🇷 flag: South Korea\u0001🇰🇼 flag: Kuwait\u0001🇰🇾 flag: Cayman Islands\u0001🇰🇿 flag: Kazakhstan\u0001🇱🇦 flag: Laos\u0001🇱🇧 flag: Lebanon\u0001🇱🇨 flag: St. Lucia\u0001🇱🇮 flag: Liechtenstein\u0001🇱🇰 flag: Sri Lanka\u0001🇱🇷 flag: Liberia\u0001🇱🇸 flag: Lesotho\u0001🇱🇹 flag: Lithuania\u0001🇱🇺 flag: Luxembourg\u0001🇱🇻 flag: Latvia\u0001🇱🇾 flag: Libya\u0001🇲🇦 flag: Morocco\u0001🇲🇨 flag: Monaco\u0001🇲🇩 flag: Moldova\u0001🇲🇪 flag: Montenegro\u0001🇲🇫 flag: St. Martin\u0001🇲🇬 flag: Madagascar\u0001🇲🇭 flag: Marshall Islands\u0001🇲🇰 flag: North Macedonia\u0001🇲🇱 flag: Mali\u0001🇲🇲 flag: Myanmar (Burma)\u0001🇲🇳 flag: Mongolia\u0001🇲🇴 flag: Macao SAR China\u0001🇲🇵 flag: Northern Mariana Islands\u0001🇲🇶 flag: Martinique\u0001🇲🇷 flag: Mauritania\u0001🇲🇸 flag: Montserrat\u0001🇲🇹 flag: Malta\u0001🇲🇺 flag: Mauritius\u0001🇲🇻 flag: Maldives\u0001🇲🇼 flag: Malawi\u0001🇲🇽 flag: Mexico\u0001🇲🇾 flag: Malaysia\u0001🇲🇿 flag: Mozambique\u0001🇳🇦 flag: Namibia\u0001🇳🇨 flag: New Caledonia\u0001🇳🇪 flag: Niger\u0001🇳🇫 flag: Norfolk Island\u0001🇳🇬 flag: Nigeria\u0001🇳🇮 flag: Nicaragua\u0001🇳🇱 flag: Netherlands\u0001🇳🇴 flag: Norway\u0001🇳🇵 flag: Nepal\u0001🇳🇷 flag: Nauru\u0001🇳🇺 flag: Niue\u0001🇳🇿 flag: New Zealand\u0001🇴🇲 flag: Oman\u0001🇵🇦 flag: Panama\u0001🇵🇪 flag: Peru\u0001🇵🇫 flag: French Polynesia\u0001🇵🇬 flag: Papua New Guinea\u0001🇵🇭 flag: Philippines\u0001🇵🇰 flag: Pakistan\u0001🇵🇱 flag: Poland\u0001🇵🇲 flag: St. Pierre & Miquelon\u0001🇵🇳 flag: Pitcairn Islands\u0001🇵🇷 flag: Puerto Rico\u0001🇵🇸 flag: Palestinian Territories\u0001🇵🇹 flag: Portugal\u0001🇵🇼 flag: Palau\u0001🇵🇾 flag: Paraguay\u0001🇶🇦 flag: Qatar\u0001🇷🇪 flag: Réunion\u0001🇷🇴 flag: Romania\u0001🇷🇸 flag: Serbia\u0001🇷🇺 flag: Russia\u0001🇷🇼 flag: Rwanda\u0001🇸🇦 flag: Saudi Arabia\u0001🇸🇧 flag: Solomon Islands\u0001🇸🇨 flag: Seychelles\u0001🇸🇩 flag: Sudan\u0001🇸🇪 flag: Sweden\u0001🇸🇬 flag: Singapore\u0001🇸🇭 flag: St. Helena, Ascension & Tristan da Cunha\u0001🇸🇮 flag: Slovenia\u0001🇸🇯 flag: Svalbard & Jan Mayen\u0001🇸🇰 flag: Slovakia\u0001🇸🇱 flag: Sierra Leone\u0001🇸🇲 flag: San Marino\u0001🇸🇳 flag: Senegal\u0001🇸🇴 flag: Somalia\u0001🇸🇷 flag: Suriname\u0001🇸🇸 flag: South Sudan\u0001🇸🇹 flag: São Tomé & Príncipe\u0001🇸🇻 flag: El Salvador\u0001🇸🇽 flag: Sint Maarten\u0001🇸🇾 flag: Syria\u0001🇸🇿 flag: Eswatini\u0001🇹🇦 flag: Tristan da Cunha\u0001🇹🇨 flag: Turks & Caicos Islands\u0001🇹🇩 flag: Chad\u0001🇹🇫 flag: French Southern and Antarctic Lands\u0001🇹🇬 flag: Togo\u0001🇹🇭 flag: Thailand\u0001🇹🇯 flag: Tajikistan\u0001🇹🇰 flag: Tokelau\u0001🇹🇱 flag: Timor-Leste\u0001🇹🇲 flag: Turkmenistan\u0001🇹🇳 flag: Tunisia\u0001🇹🇴 flag: Tonga\u0001🇹🇷 flag: Türkiye\u0001🇹🇹 flag: Trinidad & Tobago\u0001🇹🇻 flag: Tuvalu\u0001🇹🇼 flag: Taiwan\u0001🇹🇿 flag: Tanzania\u0001🇺🇦 flag: Ukraine\u0001🇺🇬 flag: Uganda\u0001🇺🇲 flag: U.S. Outlying Islands\u0001🇺🇳 flag: United Nations\u0001🇺🇸 flag: United States\u0001🇺🇾 flag: Uruguay\u0001🇺🇿 flag: Uzbekistan\u0001🇻🇦 flag: Vatican City\u0001🇻🇨 flag: St. Vincent & Grenadines\u0001🇻🇪 flag: Venezuela\u0001🇻🇬 flag: British Virgin Islands\u0001🇻🇮 flag: U.S. Virgin Islands\u0001🇻🇳 flag: Vietnam\u0001🇻🇺 flag: Vanuatu\u0001🇼🇫 flag: Wallis & Futuna\u0001🇼🇸 flag: Samoa\u0001🇽🇰 flag: Kosovo\u0001🇾🇪 flag: Yemen\u0001🇾🇹 flag: Mayotte\u0001🇿🇦 flag: South Africa\u0001🇿🇲 flag: Zambia\u0001🇿🇼 flag: Zimbabwe\u0001🏴󠁧󠁢󠁥󠁮󠁧󠁿 flag: England\u0001🏴󠁧󠁢󠁳󠁣󠁴󠁿 flag: Scotland\u0001🏴󠁧󠁢󠁷󠁬󠁳󠁿 flag: Wales"]
];
const RX_MAX_KEYS = 400;
const rxMap = new Map();
const rxBar = document.getElementById("rxBar");
const rxBarInner = document.getElementById("rxBarInner");
const rxBarTail = document.getElementById("rxBarTail");
let rxBarWrap = null;
let rxBarMsg = null;
const rxWhoPop = document.getElementById("rxWhoPop");
const rxWhoEmojiEl = document.getElementById("rxWhoEmoji");
const rxWhoCountEl = document.getElementById("rxWhoCount");
const rxWhoListEl = document.getElementById("rxWhoList");
const rxWhoTail = document.getElementById("rxWhoTail");
// Identity -> display name, straight from the server (it records the name a
// reactor is using right now), so a list of "who reacted" needs no lookups.
const rxWhoMap = new Map();
let rxWhoPill = null;
let rxWhoMsg = null;
let rxWhoEmoji = "";
let rxLpTimer = null, rxLpX = 0, rxLpY = 0;

function rxKey(from, ts) { return String(from || "") + "|" + String(Number(ts) || 0); }
function myRxId() { return myUid ? "u:" + myUid : "n:" + myName; }
function rxGet(from, ts) { return rxMap.get(rxKey(from, ts)) || null; }

function rxRememberNames(nm) {
  if (!nm || typeof nm !== "object") return;
  for (const k of Object.keys(nm)) {
    if (!nm[k]) continue;
    rxWhoMap.delete(k);
    rxWhoMap.set(k, String(nm[k]));
  }
  while (rxWhoMap.size > 800) rxWhoMap.delete(rxWhoMap.keys().next().value);
}

function rxIdsFor(m, emoji) {
  const rx = m ? rxGet(m.from, m.ts) : null;
  return (rx && Array.isArray(rx[emoji])) ? rx[emoji].slice() : [];
}

function rxWhoName(who) {
  who = String(who || "");
  if (!who) return "";
  // A nickname-only identity carries its own name; a uid identity needs the
  // server's name map, with a message they sent in this session as a fallback.
  if (who.slice(0, 2) === "n:") return who.slice(2);
  if (who === myRxId()) return myName || "You";
  const known = rxWhoMap.get(who);
  if (known) return known;
  const uid = who.slice(2);
  for (const mm of msgByWrap.values()) if (mm && mm.uid === uid && mm.from) return String(mm.from);
  return "Someone";
}
// Insertion order doubles as recency, so trimming the oldest keys is a trim of
// the least-recently-touched entries.
function rxSet(from, ts, rx) {
  const k = rxKey(from, ts);
  if (k === "|0" || !rx || !Object.keys(rx).length) { rxMap.delete(k); return; }
  rxMap.delete(k);
  rxMap.set(k, rx);
  while (rxMap.size > RX_MAX_KEYS) rxMap.delete(rxMap.keys().next().value);
}

/* ---------- the reactions this browser remembers (kv) ----------
   The server owns the canonical map, but this browser also keeps its own
   reactions in kv (keyed like rxMap, by author+timestamp), so a reload brings
   them back even if the server's copy is gone, and re-asserts them to the
   server for the messages still on screen. */
const RX_KV_KEY = "tgRx_" + (window.generatorName || "chat");
const rxSaved = new Map();

function rxKvFolder() { return (root.kv && root.kv.reactions) ? root.kv.reactions : null; }

async function rxKvLoad() {
  const f = rxKvFolder();
  if (!f) return;
  try {
    const obj = await f.get(RX_KV_KEY);
    if (!obj || typeof obj !== "object") return;
    rxSaved.clear();
    for (const k of Object.keys(obj).slice(-RX_MAX_KEYS)) {
      const mine = (Array.isArray(obj[k]) ? obj[k] : []).filter((e) => typeof e === "string" && e.length > 0 && e.length <= 32);
      if (mine.length) rxSaved.set(k, mine);
    }
  } catch (e) {}
}

async function rxKvSave() {
  const f = rxKvFolder();
  if (!f) return;
  const obj = {};
  for (const [k, mine] of rxSaved) obj[k] = mine;
  try { await f.set(RX_KV_KEY, obj); } catch (e) {}
}

// Record what `m` currently says about *my* reactions (called on every toggle).
function rxKvNote(m) {
  const k = rxKey(m.from, m.ts);
  if (k === "|0") return;
  const me = myRxId();
  const rx = rxMap.get(k) || {};
  const mine = Object.keys(rx).filter((e) => Array.isArray(rx[e]) && rx[e].indexOf(me) !== -1);
  rxSaved.delete(k);
  if (mine.length) rxSaved.set(k, mine);
  while (rxSaved.size > RX_MAX_KEYS) rxSaved.delete(rxSaved.keys().next().value);
  rxKvSave();
}

function rxMsgVisible(from, ts) {
  for (const mm of msgByWrap.values()) if (mm && mm.from === from && Number(mm.ts) === Number(ts)) return true;
  return false;
}

// Forget a message's saved reactions (it's gone).
function rxKvDrop(from, ts) {
  if (!from || ts == null) return;
  if (rxSaved.delete(rxKey(from, ts))) rxKvSave();
}

// Paint a message's remembered reactions into the local map.
function rxKvApply(m) {
  if (!m || !rxSaved.size) return;
  const k = rxKey(m.from, m.ts);
  const mine = rxSaved.get(k);
  if (!mine) return;
  const me = myRxId();
  const cur = Object.assign({}, rxMap.get(k) || {});
  let touched = false;
  for (const e of mine) {
    const list = Array.isArray(cur[e]) ? cur[e].slice() : [];
    if (list.indexOf(me) === -1) { list.push(me); cur[e] = list; touched = true; }
  }
  if (touched) rxSet(m.from, m.ts, cur);
}

// Restore everything this browser remembers, and return the reactions the
// server's copy was missing (they get re-sent once the history has rendered).
function rxKvRestore(srv) {
  const me = myRxId();
  const push = [];
  for (const [k, mine] of rxSaved) {
    const i = k.lastIndexOf("|");
    if (i <= 0) continue;
    const from = k.slice(0, i);
    const ts = Number(k.slice(i + 1)) || 0;
    if (!from || !ts) continue;
    rxKvApply({ from, ts });
    const before = (srv && srv.get(k)) || {};
    const emojis = mine.filter((e) => !(Array.isArray(before[e]) && before[e].indexOf(me) !== -1));
    if (emojis.length) push.push({ from, ts, emojis });
  }
  return push;
}

// Re-assert them only for messages the reader can actually see - a reaction to
// something deleted while they were away is never resurrected - and wait for
// the history to render, since this runs before the first rows exist.
function rxKvPush(list) {
  if (!list.length) return;
  let tries = 0;
  const attempt = () => {
    const ready = list.filter((p) => rxMsgVisible(p.from, p.ts));
    if (!ready.length) { if (++tries < 40) setTimeout(attempt, 300); return; }
    if (!socket || socket.readyState !== 1) return;
    const q = [];
    for (const p of ready) for (const emoji of p.emojis) q.push({ from: p.from, ts: p.ts, emoji });
    let i = 0;
    const step = () => {
      if (i >= q.length || i >= 80 || !socket || socket.readyState !== 1) return;
      const p = q[i++];
      socket.send(JSON.stringify({ t: "react", id: null, from: p.from, ts: p.ts, emoji: p.emoji }));
      // The server rate-limits reactions per connection, so space them out.
      if (i < q.length && i < 80) setTimeout(step, 120);
    };
    step();
  };
  attempt();
}

/* ---------- the reply quotes this browser keeps (kv) ----------
   History rows carry only the *id* of a replied-to message, and the server ids
   never match the history store's row ids, so the quoted message would vanish on
   reload. So this browser keeps a snapshot of every message it has seen quoted,
   in kv, so the quotes survive a reload. Join/left notices are *not* stored. */
const REPLY_KV_KEY = "tgReplies_" + (window.generatorName || "chat");
const REPLY_KV_MAX = 300;
const replySaved = new Map();
let replyKvLoadPromise = null;

function replyKvFolder() { return (root.kv && root.kv.replies) ? root.kv.replies : null; }

// Live events can arrive before the stored copy has been read back, so every
// writer waits for the load rather than saving on top of an empty map.
function replyKvEnsure() { if (!replyKvLoadPromise) replyKvLoadPromise = replyKvLoad(); return replyKvLoadPromise; }

function sysDom(m) {
  const wrap = el("div", "sys");
  const ts = Number(m && m.ts) || 0;
  if (ts) wrap.dataset.ts = String(ts);
  const pill = el("span", null, String((m && m.text) || ""));
  wrap.appendChild(pill);
  return wrap;
}

async function replyKvLoad() {
  const f = replyKvFolder();
  if (!f) return;
  try {
    const obj = await f.get(REPLY_KV_KEY);
    if (!obj || typeof obj !== "object") return;
    replySaved.clear();
    for (const k of Object.keys(obj)) {
      const e = obj[k];
      if (e && typeof e === "object" && e.from) replySaved.set(k, e);
    }
    while (replySaved.size > REPLY_KV_MAX) replySaved.delete(replySaved.keys().next().value);
  } catch (e) {}
}

async function replyKvSave() {
  const f = replyKvFolder();
  if (!f) return;
  const obj = {};
  for (const [k, v] of replySaved) obj[k] = v;
  try { await f.set(REPLY_KV_KEY, obj); } catch (e) {}
}

// Remember what a quoted message said, keyed by the id a reply will carry.
async function replyKvNote(r) {
  if (!r || !r.id || !r.from) return;
  await replyKvEnsure();
  const id = String(r.id);
  const snap = {
    from: String(r.from).slice(0, 40),
    t: r.t || "chat",
    text: String(r.text || "").slice(0, 500),
    url: String(r.url || "").slice(0, 500),
    dur: Number(r.dur) || 0,
    size: Number(r.size) || 0,
  };
  replySaved.delete(id);
  replySaved.set(id, snap);
  while (replySaved.size > REPLY_KV_MAX) replySaved.delete(replySaved.keys().next().value);
  replyKvSave();
}

function replyKvGet(id) {
  if (!id) return null;
  return replySaved.get(String(id)) || null;
}

function rxRender(bubble, m) {
  if (!bubble || !m) return;
  rxKvApply(m);
  const rx = rxGet(m.from, m.ts);
  const keys = [];
  if (rx) {
    // The bar's own seven first, then whatever else arrived from the picker.
    for (const e of RX_EMOJIS) if (Array.isArray(rx[e]) && rx[e].length) keys.push(e);
    for (const e of Object.keys(rx)) if (RX_EMOJIS.indexOf(e) === -1 && Array.isArray(rx[e]) && rx[e].length) keys.push(e);
  }
  let row = bubble.querySelector(".rxRow");
  if (!keys.length) {
    if (row) {
      row.remove();
      if (typeof scheduleLongSync === "function") scheduleLongSync();
    }
    return;
  }
  if (!row) {
    row = el("div", "rxRow");
    bubble.appendChild(row);
  }
  row.textContent = "";
  const me = myRxId();
  for (const e of keys) {
    const ids = rx[e];
    const mineReaction = ids.indexOf(me) !== -1;
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "rxPill" + (mineReaction ? " mine" : "");
    pill.dataset.emoji = e;
    pill.title = (mineReaction ? "Remove your reaction " : "React ") + e + " (hold to see who reacted)";
    pill.appendChild(el("span", "rxEmoji", e));
    if (ids.length > 1) pill.appendChild(el("span", "rxCount", String(ids.length)));
    wireReactionPill(pill, m, e);
    row.appendChild(pill);
  }
  if (typeof scheduleLongSync === "function") scheduleLongSync();
}

/* ---------- who reacted (hold / right-click a pill) ---------- */
function rxLpStop() {
  if (rxLpTimer) { clearTimeout(rxLpTimer); rxLpTimer = null; }
}
function wireReactionPill(pill, m, emoji) {
  // A hold (or a right-click) opens the reactor list; a plain tap still toggles
  // your own reaction, so the click that follows a hold is swallowed.
  pill.addEventListener("pointerdown", (ev) => {
    if (ev.isPrimary === false || ev.button) return;
    rxLpStop();
    // A fresh press always clears the previous hold's suppression, so only the
    // click that belongs to a hold itself is swallowed.
    pill.__rxHeld = false;
    rxLpX = ev.clientX;
    rxLpY = ev.clientY;
    rxLpTimer = setTimeout(() => {
      rxLpTimer = null;
      pill.__rxHeld = true;
      if (navigator.vibrate) navigator.vibrate(12);
      openReactionWho(pill, m, emoji);
    }, 430);
  });
  pill.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    rxLpStop();
    openReactionWho(pill, m, emoji);
  });
  pill.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    rxLpStop();
    if (pill.__rxHeld) { pill.__rxHeld = false; return; }
    if (rxWhoPill === pill) { closeReactionWho(); return; }
    // In the admin's monitor the pill is read-only: a tap shows who reacted
    // instead of toggling a reaction the admin could never own.
    if (convo.mode === "monitor") { openReactionWho(pill, m, emoji); return; }
    toggleReaction(m, emoji);
  });
}
// One set of window listeners keeps any pending hold cancelled by a drag, a
// scroll or a released finger, without attaching listeners per rendered pill.
window.addEventListener("pointerup", rxLpStop);
window.addEventListener("pointercancel", rxLpStop);
window.addEventListener("pointermove", (ev) => {
  if (!rxLpTimer) return;
  if (Math.abs(ev.clientX - rxLpX) > 12 || Math.abs(ev.clientY - rxLpY) > 12) rxLpStop();
}, { passive: true });

function rxWhoOpen() { return !rxWhoPop.classList.contains("hide"); }
function closeReactionWho() {
  rxLpStop();
  rxWhoPill = null;
  rxWhoMsg = null;
  rxWhoEmoji = "";
  if (rxWhoOpen()) rxWhoPop.classList.add("hide");
}
function positionReactionWho() {
  if (!rxWhoPill || !rxWhoPill.isConnected) { closeReactionWho(); return; }
  const r = rxWhoPill.getBoundingClientRect();
  const w = rxWhoPop.offsetWidth, h = rxWhoPop.offsetHeight;
  if (!w || !h) return;
  const gap = 12;
  // Never sit on top of the app header - prefer dropping below the pill.
  const tb = document.getElementById("topbar");
  const limit = (tb ? Math.max(0, tb.getBoundingClientRect().bottom) : 0) + 6;
  const above = r.top - gap - h;
  let top, below = false;
  if (above >= limit) top = Math.min(above, window.innerHeight - h - 6);
  else if (r.bottom + gap + h <= window.innerHeight - 6) { top = r.bottom + gap; below = true; }
  else top = Math.max(limit, Math.min(above, window.innerHeight - h - 6));
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  rxWhoPop.style.left = Math.round(left) + "px";
  rxWhoPop.style.top = Math.round(top) + "px";
  rxWhoPop.classList.toggle("below", below);
  const cx = r.left + r.width / 2 - left;
  rxWhoTail.style.left = Math.round(Math.max(14, Math.min(cx, w - 14))) + "px";
}
function fillReactionWho(pill, ids) {
  rxWhoPill = pill;
  rxWhoEmojiEl.textContent = rxWhoEmoji;
  rxWhoCountEl.textContent = ids.length === 1 ? "1 reaction" : ids.length + " reactions";
  rxWhoListEl.textContent = "";
  const me = myRxId();
  for (const who of ids) {
    const mine = who === me;
    const name = rxWhoName(who);
    const row = el("div", "rxWhoRow" + (mine ? " rxWhoMe" : ""));
    const ava = el("span", "rxWhoAva");
    if (name === "admin") ava.classList.add("adminAvatar");
    paintAvatar(ava, name);
    row.appendChild(ava);
    row.appendChild(el("span", "rxWhoName", name));
    if (mine) row.appendChild(el("span", "rxWhoYou", "you"));
    rxWhoListEl.appendChild(row);
  }
  rxWhoPop.style.left = "-9999px";
  rxWhoPop.style.top = "0px";
  rxWhoPop.classList.remove("hide");
  positionReactionWho();
}
function openReactionWho(pill, m, emoji) {
  closeEmojiPicker();
  const ids = rxIdsFor(m, emoji);
  if (!ids.length || !pill || !pill.isConnected) return;
  closeReactionBar();
  rxWhoMsg = m;
  rxWhoEmoji = emoji;
  fillReactionWho(pill, ids);
}
// The reactor list stays live: when the server relays a change for this same
// message the pills are rebuilt, so re-anchor to the freshly rendered pill.
function refreshReactionWho(bubble) {
  if (!rxWhoOpen() || !rxWhoMsg) return;
  if (!bubble) { closeReactionWho(); return; }
  const ids = rxIdsFor(rxWhoMsg, rxWhoEmoji);
  if (!ids.length) { closeReactionWho(); return; }
  const pill = [...bubble.querySelectorAll(".rxPill")].find((p) => p.dataset.emoji === rxWhoEmoji);
  if (!pill) { closeReactionWho(); return; }
  fillReactionWho(pill, ids);
}

// Paint every rendered bubble that belongs to the same message as `ref`.
function rxApply(ref) {
  if (!ref) return;
  for (const [w, mm] of msgByWrap) {
    if (!mm) continue;
    const sameId = ref.id && mm.id && String(mm.id) === String(ref.id);
    const sameMsg = ref.from && mm.from === ref.from && Number(mm.ts) === Number(ref.ts);
    if (sameId || sameMsg) {
      const bubble = w.querySelector(".bubble");
      rxRender(bubble, mm);
      if (rxWhoMsg && mm.from === rxWhoMsg.from && Number(mm.ts) === Number(rxWhoMsg.ts)) refreshReactionWho(bubble);
    }
  }
}

function toggleReaction(m, emoji) {
  if (!m || !interactionReady()) return;
  if (!socket || socket.readyState !== 1) { toast("Not connected yet — try again in a moment"); return; }
  const me = myRxId();
  const rx = Object.assign({}, rxGet(m.from, m.ts));
  const list = Array.isArray(rx[emoji]) ? rx[emoji].slice() : [];
  const i = list.indexOf(me);
  if (i === -1) list.push(me); else list.splice(i, 1);
  if (list.length) rx[emoji] = list; else delete rx[emoji];
  rxSet(m.from, m.ts, rx);
  rxKvNote(m);
  rxApply(m);
  if (navigator.vibrate) navigator.vibrate(8);
  // A private reaction is aimed at the thread's two participants instead of the
  // room, so nothing about it is broadcast to everyone else.
  if (convo.mode === "dm") dmSend({ ev: "react", id: m.id || null, emoji });
  else socket.send(JSON.stringify({ t: "react", id: m.id || null, from: m.from || null, ts: m.ts || null, emoji }));
}

async function loadReactions() {
  if (!socket || socket.readyState !== 1) return;
  try {
    await rxKvLoad();
    const arr = JSON.parse(await socket.rpc.getReactions(""));
    if (!Array.isArray(arr)) return;
    // The server's answer is authoritative: drop anything optimistic that it
    // didn't confirm (e.g. a reaction to a message it can no longer store)...
    const srv = new Map();
    for (const e of arr) if (e && e.from) srv.set(rxKey(e.from, e.ts), e.rx);
    rxMap.clear();
    for (const e of arr) if (e && e.from) { rxSet(e.from, e.ts, e.rx); rxRememberNames(e.nm); }
    // ...but the reactions this browser remembers (kv) are restored on top, and
    // re-sent to the server for the messages still on screen.
    const push = rxKvRestore(srv);
    rxKvSave();
    for (const [w, mm] of msgByWrap) rxRender(w.querySelector(".bubble"), mm);
    if (rxWhoOpen()) refreshReactionWho(rxWhoPill && rxWhoPill.closest(".bubble"));
    rxKvPush(push);
  } catch (e) {}
}

/* ---------- the tap-to-react bar ---------- */
for (const e of RX_EMOJIS) {
  const b = el("button", "rxBarBtn", e);
  b.type = "button";
  b.dataset.emoji = e;
  b.title = "React " + e;
  b.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const m = rxBarMsg;
    closeReactionBar();
    if (m) toggleReaction(m, e);
  });
  rxBarInner.appendChild(b);
}

// A "+" ends the quick bar: it opens the full emoji picker (openEmojiPicker),
// so any emoji can be sent as a reaction, not just the seven in the bar.
const rxPlusBtn = el("button", "rxBarBtn rxPlus");
rxPlusBtn.type = "button";
rxPlusBtn.title = "More emoji";
rxPlusBtn.setAttribute("aria-label", "Choose another emoji");
rxPlusBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
rxPlusBtn.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); openEmojiPicker(); });
rxBarInner.appendChild(rxPlusBtn);

function rxBarOpen() { return !rxBar.classList.contains("hide"); }
function closeReactionBar() {
  rxBarWrap = null;
  rxBarMsg = null;
  if (rxBarOpen()) rxBar.classList.add("hide");
}
function positionReactionBar() {
  if (!rxBarWrap || !rxBarWrap.isConnected) { closeReactionBar(); return; }
  const bubble = rxBarWrap.querySelector(".bubble");
  if (!bubble) { closeReactionBar(); return; }
  const r = bubble.getBoundingClientRect();
  const w = rxBar.offsetWidth, h = rxBar.offsetHeight;
  if (!w || !h) return;
  const gap = 14;
  const above = r.top - gap - h;
  let top, below = false;
  if (above >= 6) top = above;
  else if (r.bottom + gap + h <= window.innerHeight - 6) { top = r.bottom + gap; below = true; }
  else top = Math.max(6, Math.min(above, window.innerHeight - h - 6));
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  rxBar.style.left = Math.round(left) + "px";
  rxBar.style.top = Math.round(top) + "px";
  rxBar.classList.toggle("below", below);
  const cx = r.left + r.width / 2 - left;
  rxBarTail.style.left = Math.round(Math.max(14, Math.min(cx, w - 14))) + "px";
}
function openReactionBar(wrap, m) {
  closeEmojiPicker();
  if (rxBarWrap === wrap) { closeReactionBar(); return; }
  if (!wrap.querySelector(".bubble")) return;
  rxBarWrap = wrap;
  rxBarMsg = m;
  rxBar.style.left = "-9999px";
  rxBar.style.top = "0px";
  rxBar.classList.remove("hide");
  positionReactionBar();
}

/* ---------- full emoji picker (the bar's "+") ----------
   A searchable grid built from the Unicode set in EMOJI_GROUPS, plus a short
   "Recently used" row. Picking an emoji reacts to the message the bar was opened
   for with that emoji, so *any* emoji can be sent - not just the bar's seven.
   The bar closes and the picker takes its place, anchored to the same bubble. */
const rxPick = document.getElementById("rxPick");
const rxPickBody = document.getElementById("rxPickBody");
const rxPickSearch = document.getElementById("rxPickSearch");
const rxPickTail = document.getElementById("rxPickTail");
const RX_RECENT_KEY = "tgEmojiRecent_" + (window.generatorName || "chat");
const RX_RECENT_MAX = 24;
let rxPickMsg = null;                     // the message the picker will react to
let rxPickWrap = null;                    // its wrap, so the picker anchors to the bubble

function rxRecents() {
  try {
    const a = JSON.parse(localStorage.getItem(RX_RECENT_KEY) || "[]");
    return Array.isArray(a) ? a.filter((x) => typeof x === "string" && x).slice(0, RX_RECENT_MAX) : [];
  } catch (e) { return []; }
}
function rxRecentAdd(emoji) {
  try {
    const a = rxRecents().filter((x) => x !== emoji);
    a.unshift(emoji);
    localStorage.setItem(RX_RECENT_KEY, JSON.stringify(a.slice(0, RX_RECENT_MAX)));
  } catch (e) {}
}

function rxPickOpen() { return !rxPick.classList.contains("hide"); }
function closeEmojiPicker() {
  rxPickMsg = null;
  rxPickWrap = null;
  if (rxPickOpen()) rxPick.classList.add("hide");
}
function openEmojiPicker() {
  const m = rxBarMsg, wrap = rxBarWrap;
  if (!m || !wrap || !wrap.querySelector(".bubble")) return;
  rxPickMsg = m;
  rxPickWrap = wrap;
  closeReactionBar();          // the picker takes the bar's place at the same anchor
  rxPick.classList.remove("hide");
  rxPickSearch.value = "";
  renderEmojiPicker("");
  positionEmojiPicker();
}
function positionEmojiPicker() {
  if (!rxPickWrap || !rxPickWrap.isConnected) { closeEmojiPicker(); return; }
  const bubble = rxPickWrap.querySelector(".bubble");
  if (!bubble) { closeEmojiPicker(); return; }
  const r = bubble.getBoundingClientRect();
  const w = rxPick.offsetWidth, h = rxPick.offsetHeight;
  if (!w || !h) return;
  const gap = 12, sw = window.innerWidth, sh = window.innerHeight;
  const above = r.top - gap - h;
  let top, below = false;
  if (above >= 6) top = above;
  else if (r.bottom + gap + h <= sh - 6) { top = r.bottom + gap; below = true; }
  else top = Math.max(6, Math.min(above, sh - h - 6));
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(8, Math.min(left, sw - w - 8));
  rxPick.style.left = Math.round(left) + "px";
  rxPick.style.top = Math.round(top) + "px";
  rxPick.classList.toggle("below", below);
  const cx = r.left + r.width / 2 - left;
  rxPickTail.style.left = Math.round(Math.max(14, Math.min(cx, w - 14))) + "px";
}
function rxPickBtn(emoji, name) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "rxPickBtn";
  b.textContent = emoji;
  b.title = name || emoji;
  b.setAttribute("aria-label", name || emoji);
  b.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  b.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); rxPickChoose(emoji); });
  return b;
}
function rxPickSection(title) {
  const h = document.createElement("div");
  h.className = "rxPickHead";
  h.textContent = title;
  return h;
}
function rxPickGrid() {
  const g = document.createElement("div");
  g.className = "rxPickGrid";
  return g;
}
function renderEmojiPicker(q) {
  const low = String(q || "").trim().toLowerCase();
  rxPickBody.textContent = "";
  let any = false;
  if (!low) {
    const recent = rxRecents();
    if (recent.length) {
      const g = rxPickGrid();
      for (const e of recent) g.appendChild(rxPickBtn(e, e + " \u00b7 recent"));
      rxPickBody.appendChild(rxPickSection("Recently used"));
      rxPickBody.appendChild(g);
      any = true;
    }
  }
  for (const grp of EMOJI_GROUPS) {
    const g = rxPickGrid();
    let n = 0;
    for (const item of grp[1].split("\u0001")) {
      const sp = item.indexOf(" ");
      const emoji = sp === -1 ? item : item.slice(0, sp);
      const name = sp === -1 ? "" : item.slice(sp + 1);
      if (low && name.toLowerCase().indexOf(low) === -1) continue;
      g.appendChild(rxPickBtn(emoji, name));
      n++;
    }
    if (!n) continue;
    rxPickBody.appendChild(rxPickSection(grp[0]));
    rxPickBody.appendChild(g);
    any = true;
  }
  if (!any) {
    const empty = document.createElement("div");
    empty.className = "rxPickEmpty";
    empty.textContent = "No emoji match that search";
    rxPickBody.appendChild(empty);
  }
  rxPickBody.scrollTop = 0;
}
function rxPickChoose(emoji) {
  const m = rxPickMsg;
  if (!emoji) { closeEmojiPicker(); return; }
  if (m) rxRecentAdd(emoji);
  closeEmojiPicker();
  if (m) toggleReaction(m, emoji);
}
rxPickSearch.addEventListener("input", () => renderEmojiPicker(rxPickSearch.value));
rxPickSearch.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeEmojiPicker(); });

// Tapping anywhere that isn't the bar or another message dismisses it; tapping
// another message re-anchors it there (see the click handler in wireSelection).
document.addEventListener("pointerdown", (e) => {
  if (!rxBarOpen()) return;
  const t = e.target;
  if (t && t.closest && (t.closest("#rxBar") || t.closest(".msg"))) return;
  closeReactionBar();
}, true);
// The reactor list is dismissed the same way, except that pressing a pill keeps
// it alive for the hold that may re-open it on that (or another) pill.
document.addEventListener("pointerdown", (e) => {
  if (!rxWhoOpen()) return;
  const t = e.target;
  if (t && t.closest && t.closest("#rxWhoPop")) return;
  closeReactionWho();
}, true);
// The emoji picker is dismissed the same way (a click inside it is ignored).
document.addEventListener("pointerdown", (e) => {
  if (!rxPickOpen()) return;
  const t = e.target;
  if (t && t.closest && t.closest("#rxPick")) return;
  closeEmojiPicker();
}, true);
scrollCtnEl.addEventListener("scroll", () => {
  rxLpStop();
  if (rxBarOpen()) closeReactionBar();
  if (rxWhoOpen()) closeReactionWho();
  if (rxPickOpen()) closeEmojiPicker();
}, { passive: true });
window.addEventListener("resize", () => {
  if (rxBarOpen()) positionReactionBar();
  if (rxWhoOpen()) positionReactionWho();
  if (rxPickOpen()) positionEmojiPicker();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (rxBarOpen()) closeReactionBar();
  if (rxWhoOpen()) closeReactionWho();
  if (rxPickOpen()) closeEmojiPicker();
});

function wireSelection(wrap, bubble, m) {
  msgByWrap.set(wrap, m);
  wrap.dataset.id = m.id || "";
  wrap.dataset.from = m.from;
  wrap.dataset.uid = m.uid || "";
  wrap.dataset.flagged = m.flagged ? "1" : "0";
  const chk = el("span", "selCheck");
  wrap.appendChild(chk);
  // The admin's read-only monitor renders real chat bubbles, but none of the
  // participant actions apply there (the admin is not in the conversation): no
  // select, no tap-to-react, no reply. The monitor adds its own per-message
  // delete control (see addMonitorDeleteButtons) instead.
  if (convo.mode === "monitor") return;
  let timer = null, sx = 0, sy = 0, fired = false, moved = false;
  const isInteract = (t) => !!(t.closest && (t.closest("button") || t.closest("a")));
  const start = (x, y, t) => {
    if (isInteract(t)) return;
    sx = x; sy = y; fired = false; moved = false;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fired = true;
      if (selectionMode) { if (!selItems.has(wrap)) toggleSelect(wrap, m); }
      else beginSelection(wrap, m);
      if (navigator.vibrate) navigator.vibrate(12);
    }, 430);
  };
  const move = (x, y) => {
    if (Math.abs(x - sx) > 12 || Math.abs(y - sy) > 12) {
      moved = true;
      if (timer) { clearTimeout(timer); timer = null; }
    }
  };
  const up = () => { if (timer) { clearTimeout(timer); timer = null; } };
  wrap.addEventListener("contextmenu", (e) => {
    if (isInteract(e.target)) return;
    e.preventDefault();
    if (!selectionMode) beginSelection(wrap, m);
  });
  wrap.addEventListener("pointerdown", (e) => { if (e.isPrimary !== false) start(e.clientX, e.clientY, e.target); });
  window.addEventListener("pointermove", (e) => { if (e.isPrimary !== false) move(e.clientX, e.clientY); });
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  wrap.addEventListener("click", (e) => {
    if (isInteract(e.target)) { fired = false; return; }
    // A quick tap: react to it (or toggle selection while selecting). Long
    // presses and swipes never reach here with fired/moved clear.
    if (selectionMode) { if (!fired) toggleSelect(wrap, m); }
    else if (!fired && !moved) openReactionBar(wrap, m);
    fired = false;
  });
}

selCloseBtn.addEventListener("click", endSelection);
actCopyBtn.addEventListener("click", () => {
  const msgs = selectedMsgs();
  if (!msgs.length) return;
  const text = msgs.map((m) => {
    if (m.t === "chat") return m.text || "";
    if (m.t === "img") return m.caption || "[Photo]";
    if (m.t === "voice") return "[Voice message]";
    return "";
  }).join("\n");
  if (!text) { toast("Nothing to copy"); return; }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast("Copied")).catch(() => { copyFallback(text); });
  } else { copyFallback(text); }
  endSelection();
});
actReplyBtn.addEventListener("click", () => {
  const msgs = selectedMsgs();
  if (msgs.length) setReplyTo(msgs[msgs.length - 1]);
  endSelection();
});
actEditBtn.addEventListener("click", () => {
  const msgs = selectedMsgs();
  const m = msgs.length === 1 ? msgs[0] : null;
  if (m && isMine(m) && (m.t === "chat" || m.t === "img")) {
    endSelection();
    startEdit(m);
  } else {
    toast("You can only edit your own messages");
  }
});
actDelBtn.addEventListener("click", () => {
  const dm = convo.mode === "dm";
  const msgs = selectedMsgs().filter((m) => (dm ? isMine(m) : canDeleteMsg(m)));
  if (!msgs.length) { toast(dm ? "You can only unsend your own messages" : "You can only delete your own messages"); return; }
  pendingDelIds = msgs.map((x) => x.id).filter(Boolean);
  const single = msgs.length === 1;
  const isOwn = single && isMine(msgs[0]);
  const anyOther = msgs.some((x) => !isMine(x));
  delSilentBtn.classList.toggle("hide", !isAdmin() || !anyOther || dm);
  delDesc.textContent = dm
    ? (single ? "This message will be unsent for both of you." : msgs.length + " messages will be unsent for both of you.")
    : single
      ? (isOwn ? "This message will be deleted for everyone in the chat."
        : isAdmin() ? "Delete this message for everyone. With a label, a note is left; without a trace it vanishes."
          : "Delete this message for everyone. A note naming you will be left.")
      : msgs.length + " messages will be deleted for everyone.";
  delModal.classList.remove("hide");
});
actVerBtn.addEventListener("click", () => {
  const users = distinctSelUsers();
  if (!users.length || !socket || socket.readyState !== 1) return;
  const target = users[0];
  const ver = verifiedSet.has(target);
  endSelection();
  (ver ? socket.rpc.unverifyUser : socket.rpc.verifyUser)(JSON.stringify({ name: target }))
    .then((r) => {
      if (r === "ok" || r === "already") {
        if (ver) verifiedSet.delete(target); else verifiedSet.add(target);
        refreshVerifiedUI();
      }
    }).catch(() => {});
});
actFlagBtn.addEventListener("click", () => {
  const msgs = selectedMsgs();
  for (const x of msgs) if (x.id) {
    const ns = flagMsgDom(x.id);
    if (socket && socket.readyState === 1) socket.send(JSON.stringify({ t: "flag", id: x.id, ts: x.ts || null, from: x.from || null, to: ns }));
  }
  endSelection();
  toast("Message(s) flagged for review");
});
actInfoBtn.addEventListener("click", () => {
  const users = distinctSelUsers();
  if (users.length) showUserInfo(users[0]);
  endSelection();
});
actBanBtn.addEventListener("click", () => {
  const users = distinctSelUsers();
  if (!users.length || !socket || socket.readyState !== 1) return;
  for (const name of users) {
    if (bannedNames.has(name)) socket.rpc.unbanUser(JSON.stringify({ name })).catch(() => {});
    else socket.rpc.banUser(JSON.stringify({ name })).catch(() => {});
  }
  endSelection();
});

// ---------- 18+ age gate ----------
const ageKey = "tgAdult_" + (window.generatorName || "chat");
const ageModal = document.getElementById("ageModal");
const ageYesBtn = document.getElementById("ageYesBtn");
const ageNoBtn = document.getElementById("ageNoBtn");

const gateOverlay = document.getElementById("gateOverlay");
function interactionReady() { return ageApproved && tacAgreed && savedNickApplied; }
function updateGate() {
  const ready = interactionReady();
  gateOverlay.classList.toggle("hide", ready);
  msgInput.disabled = !ready;
  if (ready) maybeFirstMsgGuide();
}

// ---------- first message guide ----------
const firstMsgGuideKey = "tgFirstMsg_" + (window.generatorName || "chat");
let firstMsgGuided = lsGet(firstMsgGuideKey) === "1";
let firstMsgPrefilled = false;
const firstMsgGuide = document.createElement("div");
firstMsgGuide.id = "firstMsgGuide";
firstMsgGuide.textContent = "send your first message";
document.getElementById("composeBar").appendChild(firstMsgGuide);
function positionFirstMsgGuide() {
  const sr = sendBtn.getBoundingClientRect();
  const cr = composeBar.getBoundingClientRect();
  firstMsgGuide.style.right = Math.max(10, cr.right - sr.right) + "px";
  firstMsgGuide.style.bottom = (cr.bottom - sr.top + 8) + "px";
  const br = firstMsgGuide.getBoundingClientRect();
  firstMsgGuide.style.setProperty("--arrow-x", Math.max(14, Math.min(br.width - 14, sr.left + sr.width / 2 - br.left)) + "px");
}
function dismissFirstMsgGuide() {
  firstMsgGuide.classList.remove("show");
  firstMsgGuided = true;
  lsSet(firstMsgGuideKey, "1");
}
function maybeFirstMsgGuide() {
  if (firstMsgGuided || !interactionReady() || firstMsgGuide.classList.contains("show")) return;
  if (!firstMsgPrefilled) {
    firstMsgPrefilled = true;
    if (!msgInput.textContent.trim()) {
      msgInput.textContent = "hey guys";
      updateSendBtn();
    }
  }
  if (sendBtn.classList.contains("hide")) return;
  firstMsgGuide.classList.add("show");
  positionFirstMsgGuide();
}
firstMsgGuide.addEventListener("click", dismissFirstMsgGuide);
sendBtn.addEventListener("click", () => {
  if (firstMsgGuide.classList.contains("show")) dismissFirstMsgGuide();
});
msgInput.addEventListener("input", () => {
  if (firstMsgGuide.classList.contains("show") && msgInput.textContent.trim() !== "hey guys") dismissFirstMsgGuide();
});
window.addEventListener("resize", () => { if (firstMsgGuide.classList.contains("show")) positionFirstMsgGuide(); });

function showNextOnboarding() {
  if (!tacAgreed) { tacModal.classList.remove("hide"); return; }
  if (!ageApproved) { ageModal.classList.remove("hide"); return; }
  if (!savedNick && !savedNickApplied && !vpnBlocked) { forceNick(); return; }
}
const agePreApprove = lsGet(ageKey) === "1" && lsGet(ageKey + "_blocked") !== "1";
const ageBlocked = lsGet(ageKey + "_blocked") === "1";
let ageApproved = agePreApprove;
if (ageBlocked) {
  ageYesBtn.classList.add("hide");
  ageModal.querySelector(".cardTitle").textContent = "18+ only";
  ageModal.querySelector(".cardDesc").textContent = "You must be 18 or older to use this chat. Sorry!";
  ageNoBtn.textContent = "OK";
  ageModal.classList.remove("hide");
} else {
  updateGate();
  connect();
  (async () => { await ensureKvNick(); showNextOnboarding(); })();
}
ageYesBtn.addEventListener("click", () => {
  ageApproved = true;
  lsSet(ageKey, "1");
  lsSet(ageKey + "_blocked", "");
  ageModal.classList.add("hide");
  updateGate();
  showNextOnboarding();
});
ageNoBtn.addEventListener("click", () => {
  lsSet(ageKey + "_blocked", "1");
  ageYesBtn.classList.add("hide");
  ageModal.querySelector(".cardTitle").textContent = "18+ only";
  ageModal.querySelector(".cardDesc").textContent = "You must be 18 or older to use this chat. Sorry!";
  ageNoBtn.textContent = "OK";
});

function onChatAreaClick(e) {
  const m = e.target && e.target.closest ? e.target.closest(".mention") : null;
  if (m && m.dataset.mention) {
    e.stopImmediatePropagation();
    insertMentionIntoInput(m.dataset.mention);
  }
}
messagesEl.addEventListener("click", onChatAreaClick);
dmMessagesEl.addEventListener("click", onChatAreaClick);

// Last thing in the module: nothing above is in a temporal dead zone any more,
// so the first layout/list pass is safe to run (and it decides which layout the
// page starts in - phone-style or the desktop two-column one). It lives down
// here rather than next to its own definition for exactly that reason.
applyLayoutMode();

