import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = "https://yvqndfyiwkegxkeolvoh.supabase.co";
const SUPABASE_ANON = "sb_publishable_AVPKoEterodpUPjlLCn3RA_d6q3ZJNn";
const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.apiBase) || "/api";
const MAX_TEXT = 500;
let supabase = null;
let chan = null;
let myChannelReady = false;
let myName = null;
let typingClearTimer = null;
let lastTypingSent = 0;
function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function lsSet(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }
const savedNick = lsGet("tgNick_chat");
const savedAdminPass = lsGet("tgAdminPass_chat");
let savedNickApplied = false;
const clearedKey = "tgCleared_chat";
let clearedAt = Number(lsGet(clearedKey)) || 0;
const lastSeenKey = "tgLastSeen_chat";
let lastSeenAt = Number(lsGet(lastSeenKey)) || 0;
function markSeen() { lsSet(lastSeenKey, String(Date.now())); }
setInterval(() => { if (document.visibilityState !== "hidden") markSeen(); }, 5000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") markSeen(); });
window.addEventListener("pagehide", () => markSeen());
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});

const messagesEl = document.getElementById("messagesEl");
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

function applyIcon(url) {
  avatar.style.backgroundImage = url ? "url('" + url + "')" : "";
  avatar.style.backgroundSize = url ? "cover" : "";
  avatar.style.backgroundPosition = url ? "center" : "";
  avatar.style.color = url ? "transparent" : "";
}
const field = document.getElementById("field");
const recBar = document.getElementById("recBar");
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
const bannedOkBtn = document.getElementById("bannedOkBtn");
const tacModal = document.getElementById("tacModal");
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

document.querySelector(".sep").textContent = fmtDatePill(new Date());

function fmtDatePill(d) {
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

const scrollCtnEl = document.getElementById("scrollCtn");
const scrollDownBtn = document.getElementById("scrollDownBtn");
function updateScrollBtn() {
  scrollDownBtn.classList.toggle("hide", scrollCtnEl.scrollHeight - scrollCtnEl.scrollTop - scrollCtnEl.clientHeight < 60);
}
scrollCtnEl.addEventListener("scroll", () => {
  updateScrollBtn();
  if (scrollCtnEl.scrollHeight - scrollCtnEl.scrollTop - scrollCtnEl.clientHeight < 60) markSeen();
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
function showUnreadChip(count) {
  document.getElementById("unreadChipLabel").textContent = count ? count + " unread" : "Unread messages";
  unreadChipBtn.classList.remove("hide");
}
unreadChipBtn.addEventListener("click", () => {
  unreadChipBtn.classList.add("hide");
  const b = messagesEl.querySelector(".unreadBanner");
  if (b) b.scrollIntoView({ block: "center", behavior: "smooth" });
  else scrollCtnEl.scrollTop = 0;
});

const CHECK_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 13.7 L5.4 17.1 L12.6 9.9"/><path d="M5.2 13.7 L8.6 17.1 L15.8 9.9" opacity="0.75"/></svg>';
const PLAY_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.3"/><rect x="13.5" y="5" width="4" height="14" rx="1.3"/></svg>';
const DEL_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12M10 11v6M14 11v6"/></svg>';
const DELNOTE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm5.4 14.6L7.4 6.6A8 8 0 0 1 17.4 16.6zM12 20a8 8 0 0 1-5.4-13.6l10 10A8 8 0 0 1 12 20z"/></svg>';
const REPLY_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19l-7-7 7-7M2 12h13a7 7 0 0 1 7 7v1"/></svg>';
const EDIT_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M13.5 6.5l3 3"/></svg>';
const DL_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>';
const FLAG_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 21V3.5"/><path d="M5.5 3.5h11l-2.2 4.2L16.5 12H5.5"/></svg>';
const COPY_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
const BAN_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>';
const INFO_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v.01"/><path d="M12 11.5V16"/></svg>';
const UNBAN_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5.5-5.5"/></svg>';
const SAVE_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ADMIN_BADGE_SVG = '<svg viewBox="0 0 24 24" width="14" height="14"><defs><linearGradient id="agGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f5c542"/><stop offset="0.55" stop-color="#e0a51d"/><stop offset="1" stop-color="#c4891a"/></linearGradient></defs><circle cx="12" cy="12" r="10" fill="url(#agGrad)" stroke="#a8770e" stroke-width="1.2"/><path d="M7.5 12.5l3 3 6-6" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
const VERIFIED_BADGE_SVG = '<svg viewBox="0 0 24 24" width="14" height="14"><defs><linearGradient id="avGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4ea1f3"/><stop offset="1" stop-color="#2567d9"/></linearGradient></defs><circle cx="12" cy="12" r="10" fill="url(#avGrad)"/><path d="M7.5 12.5l3 3 6-6" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';

const NAME_COLORS = ["#e17076", "#faa774", "#a695e7", "#7bc862", "#6ec9cb", "#65aadd", "#ee7aae", "#f5c542"];

function nameColor(name) {
  name = String(name || "");
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h * 33) ^ name.charCodeAt(i)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function linkifyHtml(text) {
  const esc = String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return esc.replace(/(https?:\/\/[^\s<]+)/g, (m) => {
    const url = m.replace(/[.,;:!?)]+$/, "");
    if (!url) return m;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}

async function addLinkPreview(bubble, text) {
  const m = String(text || "").match(/(https?:\/\/[^\s<]+)/);
  if (!m) return;
  const url = m[0].replace(/[.,;:!?)]+$/, "");
  let host = url;
  try { host = new URL(url).host; } catch (e) {}
  const card = el("div", "linkPreview");
  const img = el("div", "lpImg");
  const body = el("div", "lpBody");
  body.appendChild(el("div", "lpTitle", host || url));
  card.appendChild(img);
  card.appendChild(body);
  bubble.appendChild(card);
  card.addEventListener("click", (e) => { e.stopPropagation(); window.open(url, "_blank", "noopener"); });
  try {
    const r = await fetch(API_BASE + "?action=preview&url=" + encodeURIComponent(url)).then(r => r.json()).catch(() => null);
    const title = r && r.title;
    if (title) {
      body.innerHTML = "";
      body.appendChild(el("div", "lpTitle", String(title).slice(0, 160)));
      if (r.desc) body.appendChild(el("div", "lpDesc", String(r.desc).slice(0, 200)));
      body.appendChild(el("div", "lpHost", r.host || host));
      if (r.img) img.style.backgroundImage = "url('" + String(r.img).replace(/'/g, "") + "')";
    }
  } catch (e) {}
}

function tsrowEl(m, mine) {
  const ts = el("span", "tsrow");
  if (m.edited) {
    ts.appendChild(el("span", "editedMark", "edited"));
  }
  const time = el("span");
  time.textContent = new Date(m.ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  ts.appendChild(time);
  if (mine) {
    const check = el("span");
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
const verifiedSet = new Set();
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
  for (const s of document.querySelectorAll(".senderName")) applyVerifiedToSender(s);
  ensureOnlineClickable();
  if (!onlineModal.classList.contains("hide")) renderOnlineList();
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

let pendingDelIds = [];
const uploadPlaceholders = [];
const bannedNames = new Set();

function isAdmin() { return myName === "admin"; }

function showBannedModal() {
  bannedModal.classList.remove("hide");
}
bannedOkBtn.addEventListener("click", () => bannedModal.classList.add("hide"));

tacAgreeBtn.addEventListener("click", () => {
  tacAgreed = true;
  lsSet(tacKey, "1");
  tacModal.classList.add("hide");
  updateGate();
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
  soundItem.textContent = "Sounds: " + (soundOn ? "On" : "Off");
}
updateSoundItem();
soundItem.addEventListener("click", () => {
  menuPop.classList.add("hide");
  soundOn = !soundOn;
  lsSet(soundKey, soundOn ? "on" : "off");
  updateSoundItem();
  if (soundOn) {
    ensureAudio();
    playNotify();
  }
});

const notifyItem = document.getElementById("notifyItem");
const notifyKey = "tgNotify_" + (window.generatorName || "chat");
let notifyOn = lsGet(notifyKey) === "on";
let notifyGranted = null;
function updateNotifyItem() {
  notifyItem.textContent = "Notifications: " + (notifyOn ? "On" : "Off");
}
function ensureNotifyPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  if (notifyGranted !== null) return notifyGranted;
  try {
    notifyGranted = Notification.requestPermission ? Notification.requestPermission() : Promise.resolve(Notification.permission);
  } catch (e) { return false; }
  return notifyGranted.then((p) => p === "granted").catch(() => false);
}
notifyItem.addEventListener("click", async () => {
  menuPop.classList.add("hide");
  if (!("Notification" in window)) { toast("Your browser doesn't support notifications"); return; }
  if (Notification.permission === "denied") {
    toast("Notifications are blocked — enable them in your browser settings");
    return;
  }
  const ok = await ensureNotifyPermission();
  if (!ok) { toast("Please allow notifications to use this"); return; }
  notifyOn = !notifyOn;
  lsSet(notifyKey, notifyOn ? "on" : "off");
  updateNotifyItem();
  if (notifyOn) {
    new Notification("Chat Room", { body: "You'll get notifications when this tab isn't focused." });
  }
});
updateNotifyItem();

function showMessageNotification(m) {
  if (!notifyOn || !document.hidden) return;
  if (m.t !== "chat" && m.t !== "img" && m.t !== "voice") return;
  if (!m.from || m.from === myName) return;
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
const langItem = document.getElementById("langItem");
const langGrid = document.getElementById("langGrid");
const langCloseBtn = document.getElementById("langCloseBtn");
const translateKey = "tgTrans_";
const langKey = "tgLang_";
let translateOn = lsGet(translateKey) === "on";
let translateLang = lsGet(langKey) || "en";
let translatePromiseCache = new Map();

const LANG_LIST = [
  ["en", "English"], ["es", "Spanish"], ["fr", "French"], ["de", "German"],
  ["pt", "Portuguese"], ["it", "Italian"], ["ru", "Russian"], ["uk", "Ukrainian"],
  ["pl", "Polish"], ["nl", "Dutch"], ["tr", "Turkish"], ["ar", "Arabic"],
  ["hi", "Hindi"], ["bn", "Bengali"], ["ur", "Urdu"], ["zh", "Chinese"],
  ["ja", "Japanese"], ["ko", "Korean"], ["vi", "Vietnamese"], ["th", "Thai"],
  ["id", "Indonesian"], ["ms", "Malay"], ["fil", "Filipino"], ["sw", "Swahili"]
];

function langName(code) {
  const f = LANG_LIST.find((x) => x[0] === code);
  return f ? f[1] : code;
}
function updateTranslateItems() {
  translateItem.textContent = "Translate: " + (translateOn ? "On" : "Off");
  langItem.textContent = "Translate to: " + langName(translateLang);
}
function renderLangGrid() {
  langGrid.textContent = "";
  for (const [code, name] of LANG_LIST) {
    const b = document.createElement("button");
    b.textContent = name;
    if (code === translateLang) b.classList.add("active");
    b.addEventListener("click", () => {
      translateLang = code;
      lsSet(langKey, code);
      renderLangGrid();
      updateTranslateItems();
      langModal.classList.add("hide");
      retranslateAll();
    });
    langGrid.appendChild(b);
  }
}
translateItem.addEventListener("click", () => {
  menuPop.classList.add("hide");
  translateOn = !translateOn;
  lsSet(translateKey, translateOn ? "on" : "off");
  updateTranslateItems();
  if (translateOn) retranslateAll();
  else restoreAllOriginal();
});
langItem.addEventListener("click", () => {
  menuPop.classList.add("hide");
  renderLangGrid();
  langModal.classList.remove("hide");
});
langCloseBtn.addEventListener("click", () => langModal.classList.add("hide"));

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

async function doTranslate(text, lang) {
  if (!text || !text.trim()) return text;
  const key = lang + "|" + text;
  if (translatePromiseCache.has(key)) return translatePromiseCache.get(key);
  const p = fetch("https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=" + encodeURIComponent(lang) + "&dt=t&q=" + encodeURIComponent(text))
    .then((r) => r.json())
    .then((j) => {
      if (!Array.isArray(j) || !Array.isArray(j[0])) return text;
      let out = "";
      for (const seg of j[0]) { if (seg && typeof seg[0] === "string") out += seg[0]; }
      return out || text;
    })
    .catch(() => text);
  translatePromiseCache.set(key, p);
  return p;
}

function applyTranslateToBubble(textEl, origText) {
  if (!textEl || !origText || origText.trim() === "") return;
  if (textEl.dataset.tOrig !== undefined) return; // already handled
  textEl.dataset.tOrig = origText;
  const tog = document.createElement("span");
  tog.className = "transTog";
  tog.textContent = "…";
  textEl.after(tog);
  doTranslate(origText, translateLang).then((t) => {
    if (!t || t === origText) { tog.remove(); return; }
    textEl.dataset.tTrans = t;
    textEl.textContent = t;
    textEl.classList.add("translated");
    tog.textContent = "Show original";
  });
  tog.addEventListener("click", () => {
    if (tog.textContent === "Show original") {
      textEl.textContent = textEl.dataset.tOrig;
      tog.textContent = "Show translated";
    } else {
      textEl.textContent = textEl.dataset.tTrans;
      tog.textContent = "Show original";
    }
  });
}
// Consecutive text messages from the same sender are translated together (joined with a
// sentinel) so the translator sees full context instead of one isolated sentence, which
// gives far better results; the result is then split back across the same bubbles. This
// also saves API calls (1 request for a whole run instead of 1 per message).
const TRANS_SEP = "\n\n\u2e3a\u2758\u2e3b\n\n";
function transSep() { return TRANS_SEP.replace(/[\u2e3a\u2758\u2e3b]/g, () => "\u2e3a" + Math.floor(Math.random() * 9) + "\u2e3b"); }
function setTransResult(el, tog, trans, orig) {
  if (!trans || trans === orig) { if (tog) tog.remove(); return; }
  el.dataset.tOrig = orig;
  el.dataset.tTrans = trans;
  el.textContent = trans;
  el.classList.add("translated");
  if (tog) tog.textContent = "Show original";
}
function makeTog(el) {
  const tog = document.createElement("span");
  tog.className = "transTog";
  tog.textContent = "…";
  el.after(tog);
  tog.addEventListener("click", () => {
    if (tog.textContent === "Show original") {
      el.textContent = el.dataset.tOrig;
      tog.textContent = "Show translated";
    } else {
      el.textContent = el.dataset.tTrans;
      tog.textContent = "Show original";
    }
  });
  return tog;
}
async function translateRun(run) {
  const texts = run.map((x) => x.el.dataset.tOrig !== undefined ? x.el.dataset.tOrig : x.el.textContent);
  if (!texts.some((t) => t && t.trim())) return;
  const togs = run.map((x) => makeTog(x.el));
  let parts = null;
  try {
    const sep = transSep();
    const translated = await doTranslate(texts.join(sep), translateLang);
    const p = String(translated).split(sep);
    if (p.length === run.length) parts = p.map((s) => s.trim());
  } catch (e) {}
  if (!parts) {
    for (let i = 0; i < run.length; i++) {
      const t = await doTranslate(texts[i], translateLang);
      setTransResult(run[i].el, togs[i], t, texts[i]);
    }
    return;
  }
  run.forEach((x, i) => setTransResult(x.el, togs[i], parts[i], texts[i]));
}
function translateMsgRun(wrap) {
  if (!translateOn || !wrap) return;
  const siblings = [...wrap.parentElement.children];
  const from = wrap.dataset.from;
  let start = siblings.indexOf(wrap);
  while (start > 0) {
    const p = siblings[start - 1];
    if (p.classList.contains("msg") && !p.classList.contains("out") && p.dataset.from === from && p.querySelector(".btext")) start--;
    else break;
  }
  let end = siblings.indexOf(wrap);
  while (end < siblings.length - 1) {
    const n = siblings[end + 1];
    if (n.classList.contains("msg") && !n.classList.contains("out") && n.dataset.from === from && n.querySelector(".btext")) end++;
    else break;
  }
  const run = [];
  for (let k = start; k <= end; k++) {
    const w = siblings[k];
    const el = w.querySelector(".btext");
    const tog = el.parentElement.querySelector(".transTog");
    if (tog) tog.remove();
    el.classList.remove("translated");
    const orig = el.dataset.tOrig !== undefined ? el.dataset.tOrig : el.textContent;
    delete el.dataset.tOrig;
    delete el.dataset.tTrans;
    el.textContent = orig;
    run.push({ el, wrap: w });
  }
  translateRun(run);
}
function translateVisible() {
  const containers = [...document.querySelectorAll(".btext")].filter((el) => !el.closest(".msg.out"));
  const runs = [];
  let cur = [];
  for (const el of containers) {
    const wrap = el.closest(".msg");
    const from = wrap ? wrap.dataset.from : "__none__";
    const prev = cur.length ? cur[0].wrap.dataset.from : "__start__";
    if (cur.length && from !== prev) { runs.push(cur); cur = []; }
    cur.push({ el, wrap });
  }
  if (cur.length) runs.push(cur);
  for (const run of runs) translateRun(run);
  for (const cap of document.querySelectorAll(".imgBubble .caption")) {
    if (cap.closest(".msg.out")) continue;
    if (cap.dataset.tOrig !== undefined) continue;
    const orig = cap.dataset.tOrig !== undefined ? cap.dataset.tOrig : cap.textContent;
    if (!orig || !orig.trim()) continue;
    applyTranslateToBubble(cap, orig);
  }
}
function retranslateAll() {
  for (const b of document.querySelectorAll(".btext, .imgBubble .caption")) {
    if (b.closest(".msg.out")) continue;
    const tog = b.parentElement.querySelector(".transTog");
    if (tog) tog.remove();
    b.classList.remove("translated");
    const orig = b.dataset.tOrig !== undefined ? b.dataset.tOrig : b.textContent;
    delete b.dataset.tOrig;
    delete b.dataset.tTrans;
    b.textContent = orig;
  }
  if (translateOn) translateVisible();
}
function restoreAllOriginal() {
  for (const b of document.querySelectorAll(".btext, .imgBubble .caption")) {
    if (b.dataset.tOrig !== undefined) {
      b.textContent = b.dataset.tOrig;
      b.classList.remove("translated");
      const tog = b.parentElement.querySelector(".transTog");
      if (tog) tog.remove();
      delete b.dataset.tOrig;
      delete b.dataset.tTrans;
    }
  }
}
updateTranslateItems();

function presenceList() {
  const ps = (chan && chan.presenceState()) || {};
  const seen = {};
  for (const k in ps) {
    for (const p of ps[k] || []) {
      const name = p && p.name;
      if (!name) continue;
      if (!seen[name]) seen[name] = { name, count: 0, loc: null };
      seen[name].count++;
      if (p.loc && !seen[name].loc) seen[name].loc = p.loc;
    }
  }
  const arr = Object.values(seen);
  arr.sort((a, b) => {
    if (a.name === "admin") return -1;
    if (b.name === "admin") return 1;
    return a.name.localeCompare(b.name);
  });
  return arr;
}
function refreshOnlineCount() {
  const n = (chan && Object.keys(chan.presenceState()).length) || 0;
  onlineCount = n;
  showOnlineStatus();
  if (!onlineModal.classList.contains("hide")) renderOnlineList();
}

async function renderOnlineList() {
  try {
    const list = presenceList();
    if (!list || !list.length) {
      onlineTitle.textContent = "0 online";
      onlineBody.textContent = "No one is online";
      return;
    }
    onlineTitle.textContent = (list.length === 1 ? "1 online" : list.length + " online");
    onlineBody.textContent = "";
    for (const u of list) {
      const name = u.name;
      const row = el("div", "onlineUser");
      const av = el("div", "olAvatar", (name.charAt(0) || "?").toUpperCase());
      if (name === "admin") av.classList.add("adminAvatar");
      row.appendChild(av);
      const left = el("div", "olMain");
      const top = el("div", "olTop");
      top.appendChild(el("span", "olName", u.count > 1 && name !== "admin" ? name + " (" + u.count + ")" : name));
      if (name === "admin") top.appendChild(el("span", "olTag", "ADMIN"));
      else if (verifiedSet.has(name)) top.appendChild(verifiedBadgeEl());
      left.appendChild(top);
      if (isAdmin() && u.loc) left.appendChild(el("div", "olNet", u.loc));
      row.appendChild(left);
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
  if (!isAdmin() && !verifiedSet.has(myName)) return;
  onlineClickable = true;
  onlineSub.classList.add("adminOn");
  onlineSub.addEventListener("click", openOnlineList);
}

async function showUserInfo(name) {
  if (!isAdmin()) return;
  onlineTitle.textContent = "Info · " + name;
  onlineBody.textContent = "Loading…";
  onlineModal.classList.remove("hide");
  clearInterval(onlineTimer);
  try {
    const u = presenceList().find((x) => x.name === name);
    onlineBody.textContent = "";
    if (!u) { onlineBody.appendChild(el("div", "olLegend", "Not connected · use the Online panel for the full list")); return; }
    const row = el("div", "onlineUser");
    row.appendChild(el("div", "olAvatar", (name.charAt(0) || "?").toUpperCase()));
    const left = el("div", "olMain");
    left.appendChild(el("div", "olName", name));
    if (u.loc) left.appendChild(el("div", "olNet", u.loc));
    row.appendChild(left);
    onlineBody.appendChild(row);
  } catch (e) {
    onlineBody.textContent = "couldn't load info";
  }
}

/* ---------- reply / mention ---------- */
let replyToMsg = null;
let pendingImgBlob = null;
let editingMsg = null;

function replySnippetParts(r) {
  if (r.t === "img") return { label: "Photo", thumb: r.url || null };
  if (r.t === "voice") return { label: "Voice message", thumb: null };
  return { label: String(r.text || "") || "Message", thumb: null };
}

function replyQuoteEl(r, accent) {
  const q = el("div", "replyQuote");
  q.style.borderLeftColor = accent;
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
  cancelEdit();
  replyToMsg = {
    id: String(m.id || ""),
    from: String(m.from || ""),
    t: m.t || "chat",
    text: m.t === "chat" ? String(m.text || "") : "",
    url: m.url || "",
    dur: m.dur || 0,
    size: m.size || 0,
  };
  replyNameEl.textContent = "Reply to " + replyToMsg.from;
  if (replyToMsg.from === "admin") replyNameEl.appendChild(adminBadgeEl());
  const p = replySnippetParts(replyToMsg);
  replySnippetEl.textContent = p.label;
  replyBar.classList.remove("hide");
  msgInput.focus();
}

function clearReply() {
  replyToMsg = null;
  replyBar.classList.add("hide");
}

/* ---------- edit message ---------- */
function startEdit(m) {
  clearReply();
  editingMsg = m;
  editSnippet.textContent = m.t === "img" ? (m.caption || "Photo") : (m.text || "");
  editBar.classList.remove("hide");
  msgInput.value = m.t === "img" ? (m.caption || "") : (m.text || "");
  sendBtn.innerHTML = SAVE_SVG;
  updateSendBtn();
  msgInput.focus();
}

function cancelEdit() {
  editingMsg = null;
  editBar.classList.add("hide");
  msgInput.value = "";
  sendBtn.innerHTML = SEND_BTN_HTML;
  updateSendBtn();
}

function addEditBtn(bubble, m) {
  if (m.from !== myName) return;
  if (m.t === "img" && !m.caption) return;
  const btn = el("button", "editBtn");
  btn.title = "Edit message";
  btn.innerHTML = EDIT_SVG;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    startEdit(m);
  });
  bubble.classList.add("with-edit");
  bubble.appendChild(btn);
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
  const btn = el("button", "replyBtn");
  btn.title = "Reply";
  btn.innerHTML = REPLY_SVG;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    setReplyTo(m);
  });
  bubble.classList.add("with-reply");
  bubble.appendChild(btn);
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
    if (opts.replyTo) bubble.appendChild(replyQuoteEl(opts.replyTo, "#2678b6"));
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

function addDelBtn(wrap, bubble, m) {
  wrap.dataset.id = m.id || "";
  wrap.dataset.from = m.from;
  wrap.dataset.flagged = m.flagged ? "1" : "0";
  if (m.from !== myName && !isAdmin()) return;
  const btn = el("button", "delBtn");
  btn.title = isAdmin() && m.from !== myName ? "Delete message (admin)" : "Delete message";
  btn.innerHTML = DEL_SVG;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    pendingDelIds = [m.id];
    delSilentBtn.classList.toggle("hide", !isAdmin() || m.from === myName);
    delDesc.textContent = m.from === myName
      ? "This message will be deleted for everyone in the chat."
      : "Delete this message for everyone. With a label, a note is left; without a trace it vanishes.";
    delModal.classList.remove("hide");
  });
  bubble.classList.add("with-del");
  bubble.appendChild(btn);
}

function addModBtns(wrap, bubble, m) {
  if (!isAdmin() || !m || !m.from || m.from === myName) return;
  if (bubble.querySelector(".flagBtn")) return;
  const flag = el("button", "flagBtn");
  flag.title = "Flag message";
  flag.innerHTML = FLAG_SVG;
  flag.addEventListener("click", (e) => {
    e.stopPropagation();
    api("flag", { id: String(m.id).replace(/^sb-/, ""), password: savedAdminPass });
  });
  bubble.classList.add("with-flag");
  bubble.appendChild(flag);
  const info = el("button", "infoBtn");
  info.title = "Network info for " + m.from;
  info.innerHTML = INFO_SVG;
  info.addEventListener("click", (e) => {
    e.stopPropagation();
    showUserInfo(m.from);
  });
  bubble.classList.add("with-info");
  bubble.appendChild(info);
  const verified = verifiedSet.has(m.from);
  const vbtn = el("button", "verBtn");
  vbtn.title = verified ? "Remove verification badge from " + m.from : "Give verification badge to " + m.from;
  vbtn.innerHTML = verified ? VERIFIED_BADGE_SVG : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" opacity="0.16"/><path d="M8 12.5l3 3 5.5-5.5"/></svg>';
  vbtn.addEventListener("click", (e) => {
    e.stopPropagation();
    apiVerify(m.from, !verified).then((r) => {
      if (r && r.ok) {
        if (verified) verifiedSet.delete(m.from); else verifiedSet.add(m.from);
        refreshVerifiedUI();
      }
    });
  });
  bubble.classList.add("with-ver");
  bubble.appendChild(vbtn);
  if (bannedNames.has(m.from)) {
    const unban = el("button", "unbanBtn");
    unban.title = "Unban " + m.from;
    unban.innerHTML = UNBAN_SVG;
    unban.addEventListener("click", (e) => {
      e.stopPropagation();
      apiBan(m.from, false);
    });
    bubble.classList.add("with-ban");
    bubble.appendChild(unban);
    return;
  }
  const ban = el("button", "banBtn");
  ban.title = "Ban " + m.from + " (permanent)";
  ban.innerHTML = BAN_SVG;
  ban.addEventListener("click", (e) => {
    e.stopPropagation();
    apiBan(m.from, true);
  });
  bubble.classList.add("with-ban");
  bubble.appendChild(ban);
}

function refreshBanUI(name) {
  const banned = bannedNames.has(name);
  const admin = isAdmin();
  for (const wrap of [...messagesEl.children]) {
    if (!wrap.classList.contains("msg") || wrap.dataset.from !== name) continue;
    const bubble = wrap.querySelector(".bubble");
    if (!bubble) continue;
    const ban = bubble.querySelector(".banBtn");
    const unban = bubble.querySelector(".unbanBtn");
    if (ban) ban.remove();
    if (unban) unban.remove();
    const sn = bubble.querySelector(".senderName");
    const chip = bubble.querySelector(".bannedChip");
    if (banned) {
      if (sn && !chip) sn.appendChild(el("span", "bannedChip", "banned"));
      if (admin) {
        const ub = el("button", "unbanBtn");
        ub.title = "Unban " + name;
        ub.innerHTML = UNBAN_SVG;
        ub.addEventListener("click", (e) => {
          e.stopPropagation();
          apiBan(name, false);
        });
        bubble.appendChild(ub);
      }
    } else {
      if (chip) chip.remove();
      if (admin) {
        const b = el("button", "banBtn");
        b.title = "Ban " + name + " (permanent)";
        b.innerHTML = BAN_SVG;
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          apiBan(name, true);
        });
        bubble.appendChild(b);
      }
    }
  }
}

function addAdminActionButtons() {
  titleEditBtn.classList.remove("hide");
  iconBtn.classList.remove("hide");
  ensureOnlineClickable();
  for (const wrap of [...messagesEl.children]) {
    if (!wrap.classList.contains("msg")) continue;
    const bubble = wrap.querySelector(".bubble");
    if (!bubble) continue;
    const m = { id: wrap.dataset.id || "", from: wrap.dataset.from || "", flagged: wrap.dataset.flagged === "1" };
    if (!wrap.querySelector(".delBtn")) addDelBtn(wrap, bubble, m);
    addModBtns(wrap, bubble, m);
    if (m.flagged) bubble.classList.add("flagged");
  }
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

function addVoiceBubble(m) {
  const mine = m.from === myName;
  const grouped = lastMessageFrom() === m.from;
  const wrap = el("div", "msg " + (mine ? "out" : "in") + (grouped ? " grouped" : ""));
  const bubble = el("div", "bubble voiceBubble");
  if (m.from === "admin") bubble.classList.add("adminMsg");
  wrap.dataset.ts = m.ts || "";
  const sn = senderNameEl(m, mine, grouped);
  if (sn) bubble.appendChild(sn);
  if (m.replyTo) bubble.appendChild(replyQuoteEl(m.replyTo, mine ? "#2678b6" : nameColor(m.replyTo.from)));
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
  wrap.appendChild(bubble);
  messagesEl.appendChild(wrap);
  wireSelection(wrap, bubble, m);
  addDelBtn(wrap, bubble, m);
  wireReply(wrap, bubble, m);
  addModBtns(wrap, bubble, m);
  if (m.flagged) bubble.classList.add("flagged");
  wirePlayback(play, wave, m.url, m.dur, dot);
}

function addImgBubble(m) {
  const mine = m.from === myName;
  const grouped = lastMessageFrom() === m.from;
  const wrap = el("div", "msg " + (mine ? "out" : "in") + (grouped ? " grouped" : ""));
  const bubble = el("div", "bubble imgBubble");
  if (m.from === "admin") bubble.classList.add("adminMsg");
  wrap.dataset.ts = m.ts || "";
  const sn = senderNameEl(m, mine, grouped);
  if (sn) bubble.appendChild(sn);
  if (m.replyTo) bubble.appendChild(replyQuoteEl(m.replyTo, mine ? "#2678b6" : nameColor(m.replyTo.from)));
  const img = document.createElement("img");
  img.src = m.url;
  img.alt = "Image";
  img.loading = "lazy";
  bubble.appendChild(img);
  if (m.caption) {
    const cap = el("div", "caption");
    cap.innerHTML = linkifyHtml(m.caption);
    bubble.appendChild(cap);
    if (translateOn && m.from && m.from !== myName) applyTranslateToBubble(cap, m.caption);
    if (cap.querySelector("a")) addLinkPreview(bubble, m.caption);
  }
  const ts = tsrowEl(m, mine);
  if (m.caption) ts.classList.add("tsrow-flat");
  bubble.appendChild(ts);
  const dl = el("button", "dlBtn");
  dl.title = "Download image";
  dl.innerHTML = DL_SVG;
  dl.addEventListener("click", (e) => {
    e.stopPropagation();
    downloadImage(m.url, m.id || "image");
  });
  bubble.appendChild(dl);
  wrap.appendChild(bubble);
  messagesEl.appendChild(wrap);
  wireSelection(wrap, bubble, m);
  addDelBtn(wrap, bubble, m);
  addEditBtn(bubble, m);
  wireReply(wrap, bubble, m);
  addModBtns(wrap, bubble, m);
  if (m.flagged) bubble.classList.add("flagged");
}

function addTextBubble(m) {
  const mine = m.from === myName;
  const grouped = lastMessageFrom() === m.from;
  const wrap = el("div", "msg " + (mine ? "out" : "in") + (grouped ? " grouped" : ""));
  const bubble = el("div", "bubble");
  if (m.from === "admin") bubble.classList.add("adminMsg");
  wrap.dataset.ts = m.ts || "";
  wrap.dataset.from = m.from;
  const sn = senderNameEl(m, mine, grouped);
  if (sn) bubble.appendChild(sn);
  if (m.replyTo) bubble.appendChild(replyQuoteEl(m.replyTo, mine ? "#2678b6" : nameColor(m.replyTo.from)));
  const text = el("div", "btext");
  text.innerHTML = linkifyHtml(m.text);
  bubble.appendChild(text);
  addLinkPreview(bubble, m.text);
  bubble.appendChild(tsrowEl(m, mine));
  wrap.appendChild(bubble);
  messagesEl.appendChild(wrap);
  wireSelection(wrap, bubble, m);
  if (translateOn && m.from && m.from !== myName && m.t === "chat") translateMsgRun(wrap);
  addDelBtn(wrap, bubble, m);
  addEditBtn(bubble, m);
  wireReply(wrap, bubble, m);
  addModBtns(wrap, bubble, m);
  if (m.flagged) bubble.classList.add("flagged");
}

function addDateSep() {
  const s = el("div", "sep");
  s.textContent = fmtDatePill(new Date());
  messagesEl.appendChild(s);
}

function buildDelNote(m) {
  const wrap = el("div", "delnote");
  wrap.dataset.id = m.id || "";
  const ic = el("span", "dnIcon");
  ic.innerHTML = DELNOTE_SVG;
  wrap.appendChild(ic);
  wrap.appendChild(el("span", "dnText", "This message was deleted by admin"));
  return wrap;
}

function addMessageDom(m) {
  if (m.t === "system") {
    const wrap = el("div", "sys");
    wrap.appendChild(el("span", null, m.text));
    messagesEl.appendChild(wrap);
    return;
  }
  if (m.t === "delnote") { messagesEl.appendChild(buildDelNote(m)); return; }
  if (m.t === "voice") { addVoiceBubble(m); return; }
  if (m.t === "img") { addImgBubble(m); return; }
  addTextBubble(m);
}

function showOnlineStatus() {
  onlineSub.textContent = onlineCount === 1 ? "online" : onlineCount + " online";
}

const UNREAD_CHEV = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';

function addNewMsgsBanner() {
  if (!lastSeenAt) return 0;
  let count = 0;
  let firstNew = null;
  for (const n of messagesEl.children) {
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
  messagesEl.insertBefore(banner, firstNew);
  return count;
}

function scrollToNewBanner() {
  const b = messagesEl.querySelector(".unreadBanner");
  if (!b) return;
  b.scrollIntoView({ block: "center", behavior: "smooth" });
}

function handleMessage(m) {
  if (m.t === "clear") {
    clearedAt = Date.now();
    lsSet(clearedKey, String(clearedAt));
    messagesEl.innerHTML = "";
    addDateSep();
    scrollBottom();
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
  } else if (m.t === "title") {
    chatTitle.textContent = m.title;
    avatarLetter.textContent = (m.title.trim().charAt(0) || "C").toUpperCase();
  } else if (m.t === "icon") {
    applyIcon(m.url);
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

const SB_H = { apikey: SUPABASE_ANON, Authorization: "Bearer " + SUPABASE_ANON, "Content-Type": "application/json", Prefer: "return=minimal" };
async function api(action, payload = {}) {
  const body = JSON.stringify(Object.assign({ action }, payload));
  const attempt = async (base) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const r = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: ctrl.signal });
      const ct = (r.headers.get("content-type") || "");
      let data = {};
      if (ct.includes("json")) { try { data = await r.json(); } catch (e) { data = {}; } }
      if (!r.ok && !data.error) data.error = "http_" + r.status;
      return { ok: true, data };
    } catch (e) {
      return { ok: false };
    } finally { clearTimeout(timer); }
  };
  let a = await attempt(API_BASE);
  if (!a.ok && API_BASE !== "/api/app") a = await attempt("/api/app");
  return a.ok ? a.data : { error: "network" };
}
async function fetchHistory() {
  try {
    let h = await fetch(SUPABASE_URL + "/rest/v1/messages?select=id,ts,sender,type,text,url,dur,size,reply_to,flagged&order=ts.asc", { headers: SB_H }).then(r => r.json());
    if (!Array.isArray(h)) h = await fetch(SUPABASE_URL + "/rest/v1/messages?select=id,ts,sender,type,text,url,dur,size,reply_to&order=ts.asc", { headers: SB_H }).then(r => r.json());
    return Array.isArray(h) ? h : [];
  } catch (e) { return []; }
}
async function uploadToStorage(bucket, blob) {
  try {
    const ext = blob.type.includes("webm") ? "webm" : blob.type.includes("jpeg") ? "jpg" : blob.type.includes("png") ? "png" : "blob";
    const name = Date.now() + "-" + Math.random().toString(36).slice(2, 9) + "." + ext;
    const { error } = await supabase.storage.from(bucket).upload(name, blob, { contentType: blob.type || "application/octet-stream" });
    if (error) return null;
    const { data } = supabase.storage.from(bucket).getPublicUrl(name);
    return data.publicUrl;
  } catch (e) { return null; }
}
function apiBan(name, set) { return api("ban", { name, set, password: savedAdminPass }); }
function apiVerify(name, set) { return api("verify", { name, set, password: savedAdminPass }); }
function sbDeleteDom(id) {
  for (const n of [...messagesEl.children]) {
    if (n.dataset && n.dataset.id === id) {
      n.remove();
      return true;
    }
  }
  return false;
}
function flagMsgDom(id) {
  for (const n of [...messagesEl.children]) {
    if (n.dataset && n.dataset.id === id) {
      const bubble = n.querySelector(".bubble");
      const newState = bubble ? !bubble.classList.contains("flagged") : true;
      if (bubble) bubble.classList.toggle("flagged", newState);
      return newState;
    }
  }
  return null;
}
function findWrapById(id) {
  for (const n of [...messagesEl.children]) {
    if (n.dataset && String(n.dataset.id) === String(id)) return n;
  }
  return null;
}
function findMsgById(id) {
  for (const [w, mm] of msgByWrap) if (mm && String(mm.id) === String(id)) return mm;
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
    }
  }
  return m;
}
function sbRowToMsg(row) {
  const base = { id: "sb-" + row.id, from: row.sender, ts: row.ts, flagged: !!row.flagged };
  if (row.reply_to) base.replyTo = { id: String(row.reply_to) };
  if (row.type === "chat") return Object.assign(base, { t: "chat", text: row.text || "" });
  if (row.type === "img") return Object.assign(base, { t: "img", url: row.url || "", caption: row.text || undefined });
  if (row.type === "voice") return Object.assign(base, { t: "voice", url: row.url || "", dur: row.dur || 0, size: row.size || 0 });
  return null;
}

function sendChat() {
  if (!interactionReady()) { tacModal.classList.remove("hide"); return; }
  const text = msgInput.value.trim().slice(0, MAX_TEXT);
  if (!myName) return;
  if (editingMsg) {
    if (!text && editingMsg.t !== "img") { cancelEdit(); return; }
    api("edit", { id: String(editingMsg.id).replace(/^sb-/, ""), sender: myName, text });
    cancelEdit();
    msgInput.focus();
    return;
  }
  if (!text) return;
  const ts = Date.now();
  addUploadPlaceholder("text", { text, replyTo: replyToMsg });
  api("post", { sender: myName, type: "chat", text, reply_to: replyToMsg ? String(replyToMsg.id || "") : null, ts }).then((r) => {
    if (r && r.error) {
      const ph = uploadPlaceholders.find((p) => !p.done);
      removeUploadPlaceholder(ph);
      if (r.error === "banned") showBannedModal();
      else toast("Couldn't send: " + r.error);
    }
  });
  clearReply();
  msgInput.value = "";
  updateSendBtn();
  msgInput.focus();
}

function sendTyping() {
  const now = Date.now();
  if (now - lastTypingSent > 1500 && chan && myName) {
    lastTypingSent = now;
    chan.send({ type: "broadcast", event: "typing", payload: { from: myName } });
  }
}

function updateSendBtn() {
  const has = msgInput.value.trim().length > 0;
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
  const showSend = recording || msgInput.value.trim().length > 0;
  sendBtn.classList.toggle("hide", !showSend);
  micBtn.classList.toggle("hide", showSend);
}

async function startRecording() {
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
  if (!blob || !blob.size || !myName) return;
  const dur = Math.round(recElapsed * 10) / 10;
  const ph = addUploadPlaceholder("voice");
  try {
    const url = await uploadToStorage("voice", blob);
    if (!url) { removeUploadPlaceholder(ph); toast("Upload failed"); return; }
    const vts = Date.now();
    api("post", { sender: myName, type: "voice", url, dur, size: blob.size, reply_to: replyToMsg ? String(replyToMsg.id || "") : null, ts: vts }).then((r) => {
      if (r && r.error) {
        removeUploadPlaceholder(ph);
        if (r.error === "banned") showBannedModal();
        else toast("Couldn't send: " + r.error);
      }
    });
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

let myLocPromise = null;
function getMyIPLocation() {
  if (!myLocPromise) {
    myLocPromise = fetch("https://ipwho.is/")
      .then((r) => r.json())
      .then((d) => {
        if (!d || d.success === false) return "";
        return [d.city, d.region, d.country].filter(Boolean).join(", ");
      })
      .catch(() => "");
  }
  return myLocPromise;
}

let historyLoaded = false;
let historyInProgress = false;
const pendingInserts = [];
const chatLoader = document.getElementById("chatLoader");
function hideChatLoader() { if (chatLoader) chatLoader.classList.add("hide"); }
setTimeout(() => { if (!historyLoaded) hideChatLoader(); }, 15000);

function scrollToLatest() {
  const b = messagesEl.querySelector(".unreadBanner");
  if (b) {
    b.scrollIntoView({ block: "start", behavior: "auto" });
  } else {
    scrollCtnEl.scrollTop = scrollCtnEl.scrollHeight;
  }
  updateScrollBtn();
}
window.addEventListener("load", () => setTimeout(scrollToLatest, 400));
let reconnectFails = 0;
let dbReady = null;
async function probeDbReady() {
  if (dbReady !== null) return dbReady;
  try {
    const r = await fetch(SUPABASE_URL + "/rest/v1/bans?select=name&limit=1", { headers: SB_H });
    dbReady = r.status === 200;
  } catch (e) { dbReady = false; }
  return dbReady;
}

function track(payload) {
  if (!chan || !myName) return;
  chan.track(Object.assign({ name: myName }, payload));
}

function addSystemLine(text) {
  if (!historyLoaded) return;
  const wrap = el("div", "sys");
  wrap.appendChild(el("span", null, text));
  messagesEl.appendChild(wrap);
  scrollBottom();
}

function applyEditInPlace(wrap, m) {
  const bubble = wrap.querySelector(".bubble");
  if (!bubble) return;
  if (bubble.classList.contains("imgBubble")) {
    let cap = bubble.querySelector(".caption");
    if (m.text) {
      if (cap) cap.textContent = m.text;
      else {
        cap = el("div", "caption", m.text);
        bubble.insertBefore(cap, bubble.querySelector(".tsrow"));
      }
    } else if (cap) cap.remove();
  } else {
    const bt = bubble.querySelector(".btext");
    if (bt) bt.textContent = m.text;
  }
  const ts = bubble.querySelector(".tsrow");
  if (ts && !ts.querySelector(".editedMark")) {
    ts.insertBefore(el("span", "editedMark", "edited"), ts.firstChild);
  }
}

function onMsgRow(row) {
  try {
    const mm = enrichReply(sbRowToMsg(row));
    if (!mm) return;
    if (!historyLoaded) { pendingInserts.push(mm); return; }
    if (findWrapById(mm.id)) return;
    addMessageDom(mm);
    if (mm.from && mm.from !== myName) playNotify();
    showMessageNotification(mm);
    if (mm.from === myName && uploadPlaceholders.length) removeUploadPlaceholder(uploadPlaceholders[0]);
    scrollBottom();
  } catch (e) { console.error("onMsgRow", row && row.id, e); }
}

function handleRowUpdate(oldRow, row) {
  if (!historyLoaded) return;
  const id = "sb-" + (row.id != null ? row.id : (oldRow && oldRow.id));
  const wrap = findWrapById(id);
  if (!wrap) return;
  if (row.type === "delnote") {
    wrap.replaceWith(buildDelNote({ id }));
    scrollBottom();
    return;
  }
  const oldFlagged = !!(oldRow && oldRow.flagged);
  const newFlagged = !!row.flagged;
  if (oldFlagged !== newFlagged) {
    const bubble = wrap.querySelector(".bubble");
    if (bubble) bubble.classList.toggle("flagged", newFlagged);
    return;
  }
  const mm = sbRowToMsg(row);
  if (!mm) return;
  applyEditInPlace(wrap, mm);
  scrollBottom();
}

function handleRowDelete(oldRow) {
  if (!historyLoaded) return;
  const id = "sb-" + (oldRow && oldRow.id);
  const wrap = findWrapById(id);
  if (wrap) wrap.remove();
}

async function loadState() {
  const st = await api("state");
  if (!st || st.error) return;
  bannedNames.clear();
  for (const n of st.banned || []) bannedNames.add(n);
  verifiedSet.clear();
  for (const n of st.verified || []) verifiedSet.add(n);
  refreshVerifiedUI();
  if (st.title) {
    chatTitle.textContent = st.title;
    avatarLetter.textContent = (st.title.trim().charAt(0) || "C").toUpperCase();
  }
  if (st.icon) applyIcon(st.icon);
  if (bannedNames.has(myName)) showBannedModal();
}

async function loadHistory() {
  if (historyInProgress) return;
  historyInProgress = true;
  try {
    const rows = await fetchHistory();
    for (const row of rows) {
      try {
        if (clearedAt && row.ts <= clearedAt) continue;
        const mm = enrichReply(sbRowToMsg(row));
        if (mm) addMessageDom(mm);
      } catch (e) { console.error("render-sb-row", row && row.id, e); }
    }
    historyLoaded = true;
    hideChatLoader();
    for (const mm of pendingInserts.splice(0)) {
      if (!findWrapById(mm.id)) addMessageDom(mm);
    }
    if (translateOn) retranslateAll();
    const unreadCount = addNewMsgsBanner();
    if (unreadCount) showUnreadChip(unreadCount);
    scrollToLatest();
    setTimeout(scrollToLatest, 300);
    setTimeout(scrollToLatest, 1000);
    setTimeout(scrollToLatest, 2500);
    msgInput.focus();
  } finally {
    historyInProgress = false;
  }
}

function connect() {
  if (chan) { try { supabase.removeChannel(chan); } catch (e) {} chan = null; }
  myChannelReady = false;
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON);
  } catch (e) { return; }
  chan = supabase.channel("chat-room", { config: { presence: { key: Math.random().toString(36).slice(2) } } });

  const onSettingsRow = (row) => {
    const key = row && row.key;
    if (key === "title") handleMessage({ t: "title", title: row.value });
    else if (key === "icon") handleMessage({ t: "icon", url: row.value });
  };

  chan.on("presence", { event: "sync" }, () => refreshOnlineCount());
  chan.on("presence", { event: "join" }, ({ newPresences }) => {
    for (const p of newPresences || []) {
      if (p && p.name && p.name !== myName) addSystemLine(p.name + " joined");
    }
  });
  chan.on("presence", { event: "leave" }, ({ leftPresences }) => {
    for (const p of leftPresences || []) {
      if (p && p.name && p.name !== myName) addSystemLine(p.name + " left");
    }
  });
  chan.on("broadcast", { event: "typing" }, (payload) => {
    const from = payload.payload && payload.payload.from;
    if (!from || from === myName) return;
    onlineSub.textContent = from + " is typing…";
    clearTimeout(typingClearTimer);
    typingClearTimer = setTimeout(showOnlineStatus, 2500);
  });

  const subStatus = async (status) => {
    if (status === "SUBSCRIBED") {
      myChannelReady = true;
      reconnectFails = 0;
      await loadHistory();
      await Promise.race([loadState(), new Promise((r) => setTimeout(r, 6000))]);
      if (savedNick && !savedNickApplied) {
        if (savedNick === "admin") {
          const r = await api("login", { password: savedAdminPass });
          if (r && r.ok) { myName = "admin"; savedNickApplied = true; }
        } else if (!bannedNames.has(savedNick)) {
          myName = savedNick;
          savedNickApplied = true;
        }
      }
      if (!savedNickApplied) forceNick();
      if (isAdmin()) addAdminActionButtons();
      if (myName) track({ loc: await getMyIPLocation() });
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      clearTimeout(typingClearTimer);
      onlineSub.textContent = "offline";
      reconnectFails++;
      if (reconnectFails > 12) return;
      setTimeout(connect, Math.min(4000 * reconnectFails, 20000));
    }
  };
  probeDbReady().then((ready) => {
    if (ready) {
      chan.on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => onMsgRow(payload.new));
      chan.on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) => handleRowUpdate(payload.old, payload.new));
      chan.on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, (payload) => handleRowDelete(payload.old));
      chan.on("postgres_changes", { event: "INSERT", schema: "public", table: "bans" }, (payload) => {
        const name = payload.new && payload.new.name;
        if (!name) return;
        handleMessage({ t: "ban", name });
        addSystemLine(name + " was banned");
      });
      chan.on("postgres_changes", { event: "DELETE", schema: "public", table: "bans" }, (payload) => {
        const name = payload.old && payload.old.name;
        if (name) handleMessage({ t: "unban", name });
      });
      chan.on("postgres_changes", { event: "INSERT", schema: "public", table: "verified" }, (payload) => {
        const name = payload.new && payload.new.name;
        if (name) handleMessage({ t: "verified", name });
      });
      chan.on("postgres_changes", { event: "DELETE", schema: "public", table: "verified" }, (payload) => {
        const name = payload.old && payload.old.name;
        if (name) handleMessage({ t: "unverified", name });
      });
      chan.on("postgres_changes", { event: "INSERT", schema: "public", table: "settings" }, (payload) => onSettingsRow(payload.new));
      chan.on("postgres_changes", { event: "UPDATE", schema: "public", table: "settings" }, (payload) => onSettingsRow(payload.new));
    } else {
      console.warn("Chat Room: Supabase setup (SETUP.sql) not detected — live updates disabled until it is run. History and posting still work.");
    }
    chan.subscribe(subStatus);
  });
}

sendBtn.addEventListener("click", () => { if (recording) sendVoice(); else sendChat(); });
msgInput.addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
msgInput.addEventListener("input", () => { updateSendBtn(); sendTyping(); });
micBtn.addEventListener("click", startRecording);
recCancelBtn.addEventListener("click", () => { stopRecording(); });

async function openImageForSend(file) {
  if (!file) return;
  let blob;
  try {
    blob = await resizeImage(file);
  } catch (e) {
    toast("Couldn't read that image.");
    return;
  }
  pendingImgBlob = blob;
  capImg.src = URL.createObjectURL(blob);
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
document.addEventListener("paste", async (e) => {
  if (!e.clipboardData) return;
  if (!captionModal.classList.contains("hide") || !nickModal.classList.contains("hide")) return;
  let imageItem = null;
  for (const item of e.clipboardData.items) {
    if (item.type && item.type.startsWith("image/")) { imageItem = item; break; }
  }
  if (imageItem) {
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (file) openImageForSend(file);
    return;
  }
  for (const item of e.clipboardData.items) {
    if (item.type !== "text/uri-list" && item.type !== "text/plain") continue;
    const text = await new Promise((res) => { try { item.getAsString(res); } catch (err) { res(""); } });
    const url = (text || "").trim().split(/\s+/)[0] || "";
    if (/^https?:\/\/.+\.(gif|webp)(\?|$)/i.test(url) || /(tenor\.com|giphy\.com|media[0-9]*\.giphy|cataas\.com)/i.test(url)) {
      if (!url) continue;
      e.preventDefault();
      sendGif(url);
      return;
    }
  }
});
capCancelBtn.addEventListener("click", () => {
  if (pendingImgBlob) { URL.revokeObjectURL(capImg.src); pendingImgBlob = null; }
  capImg.src = "";
  captionModal.classList.add("hide");
});
capInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); capSendBtn.click(); }
});
capSendBtn.addEventListener("click", async () => {
  const blob = pendingImgBlob;
  if (!blob) return;
  if (!myName) {
    toast("Not connected yet — try again in a moment");
    return;
  }
  const caption = capInput.value.trim().slice(0, 300);
  pendingImgBlob = null;
  URL.revokeObjectURL(capImg.src);
  capImg.src = "";
  captionModal.classList.add("hide");
  const ph = addUploadPlaceholder("img");
  try {
    const url = await Promise.race([
      uploadToStorage("images", blob),
      new Promise((_, reject) => setTimeout(() => reject(new Error("upload timeout")), 30000))
    ]);
    if (!url) { removeUploadPlaceholder(ph); toast("Upload failed"); return; }
    api("post", { sender: myName, type: "img", url, text: caption || null, reply_to: replyToMsg ? String(replyToMsg.id || "") : null, ts: Date.now() }).then((r) => {
      if (r && r.error) {
        removeUploadPlaceholder(ph);
        if (r.error === "banned") showBannedModal();
        else toast("Couldn't send: " + r.error);
      }
    });
    clearReply();
  } catch (e) {
    removeUploadPlaceholder(ph);
    toast("Upload failed. Check your connection and try again.");
  }
});

emojiBtn.addEventListener("click", () => {
  const emojis = ["😀", "😂", "😍", "👍", "🔥", "🎉", "❤️", "😎", "🤔", "😅"];
  msgInput.value += emojis[Math.floor(Math.random() * emojis.length)];
  msgInput.focus();
  updateSendBtn();
});

function sendGif(url) {
  if (!url) return;
  if (!myName) { toast("Not connected yet — try again in a moment"); return; }
  const u = String(url).trim().slice(0, 500);
  api("post", { sender: myName, type: "img", url: u, text: null, reply_to: replyToMsg ? String(replyToMsg.id || "") : null, ts: Date.now() }).then((r) => {
    if (r && r.error === "banned") showBannedModal();
    else if (r && r.error) toast("Couldn't send: " + r.error);
  });
  if (replyToMsg) { clearReply(); }
  updateSendBtn();
}

menuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  translatePop.classList.add("hide");
  menuPop.classList.toggle("hide");
});
document.addEventListener("click", () => { menuPop.classList.add("hide"); translatePop.classList.add("hide"); });

nickItem.addEventListener("click", () => {
  menuPop.classList.add("hide");
  nickModal.classList.remove("force");
  nickModal.querySelector(".cardTitle").textContent = "Your nickname";
  nickInput.value = myName || "";
  nickPassInput.classList.add("hide");
  nickPassInput.value = "";
  nickModal.classList.remove("hide");
  nickInput.focus();
});
nickCancelBtn.addEventListener("click", () => nickModal.classList.add("hide"));

/* ---------- add to home screen ---------- */
const installItem = document.getElementById("installItem");
const installModal = document.getElementById("installModal");
const installBody = document.getElementById("installBody");
const installBtn = document.getElementById("installBtn");
const installCancelBtn = document.getElementById("installCancelBtn");
const installBannerBtn = document.getElementById("installBannerBtn");
const installBannerCloseBtn = document.getElementById("installBannerCloseBtn");

let deferredPrompt = null;
let installBannerDismissed = false;
function hideInstallBanner() { installBannerBtn.classList.add("hide"); }
function maybeShowInstallBanner() {
  if (!deferredPrompt || installBannerDismissed) return;
  if (window.matchMedia("(display-mode: standalone)").matches) return;
  installBannerBtn.classList.remove("hide");
}
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; maybeShowInstallBanner(); });
window.addEventListener("appinstalled", () => { deferredPrompt = null; hideInstallBanner(); });
installBannerBtn.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  const p = deferredPrompt;
  deferredPrompt = null;
  hideInstallBanner();
  p.prompt();
  try { await p.userChoice; } catch (e) {}
});
installBannerCloseBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  installBannerDismissed = true;
  hideInstallBanner();
});
window.addEventListener("load", () => setTimeout(maybeShowInstallBanner, 2500));
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
  nickModal.querySelector(".cardTitle").textContent = "Choose your name to join";
  nickInput.value = "";
  nickPassInput.classList.add("hide");
  nickPassInput.value = "";
  nickModal.classList.remove("hide");
  nickInput.focus();
}
nickInput.addEventListener("input", () => {
  nickPassInput.classList.toggle("hide", !/^admin$/i.test(nickInput.value.trim()));
});
nickOkBtn.addEventListener("click", async () => {
  let name = nickInput.value.trim().slice(0, 20);
  if (!name) {
    if (nickModal.classList.contains("force")) toast("Enter a name to join the chat");
    return;
  }
  const wantsAdmin = /^admin$/i.test(name);
  if (wantsAdmin) {
    name = "admin";
    if (!nickPassInput.value) {
      nickPassInput.classList.remove("hide");
      nickPassInput.focus();
      toast("Enter the admin password");
      return;
    }
  }
  for (let i = 0; i < 50 && !myChannelReady; i++) await new Promise((r) => setTimeout(r, 200));
  if (!myChannelReady) return;
  if (wantsAdmin) {
    const r = await api("login", { password: nickPassInput.value });
    if (!r || r.error === "too_many_attempts") { toast("Too many attempts. Try again later."); return; }
    if (!r.ok) {
      toast("Wrong admin password");
      nickPassInput.value = "";
      nickPassInput.focus();
      return;
    }
    myName = "admin";
    savedNickApplied = true;
    lsSet("tgNick_chat", "admin");
    lsSet("tgAdminPass_chat", nickPassInput.value);
    toast("Admin mode: golden badge enabled");
    nickModal.classList.remove("force");
    nickModal.classList.add("hide");
    addAdminActionButtons();
  } else {
    if (bannedNames.has(name)) {
      showBannedModal();
      toast("That name is banned in this chat");
      return;
    }
    myName = name;
    savedNickApplied = true;
    lsSet("tgNick_chat", name);
    nickModal.classList.remove("force");
    nickModal.classList.add("hide");
  }
  if (myName) track({ loc: await getMyIPLocation() });
});
nickInput.addEventListener("keydown", (e) => { if (e.key === "Enter") nickOkBtn.click(); });
nickPassInput.addEventListener("keydown", (e) => { if (e.key === "Enter") nickOkBtn.click(); });

titleEditBtn.addEventListener("click", () => {
  titleInput.value = chatTitle.textContent;
  titleModal.classList.remove("hide");
  titleInput.focus();
});
titleCancelBtn.addEventListener("click", () => titleModal.classList.add("hide"));
titleOkBtn.addEventListener("click", async () => {
  const v = titleInput.value.trim().slice(0, 60);
  if (!v) { toast("Enter a title"); return; }
  titleModal.classList.add("hide");
  const r = await api("setTitle", { value: v, password: savedAdminPass });
  if (!r || r.error) toast("Couldn't change title");
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
    const url = await uploadToStorage("icons", blob);
    if (!url) { toast("Upload failed"); return; }
    const r = await api("setIcon", { value: url, password: savedAdminPass });
    if (r && r.ok) toast("Group icon updated");
    else toast("Couldn't set icon");
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
  const r = await api("setIcon", { value: "", password: savedAdminPass });
  if (r && r.ok) toast("Group icon removed");
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
    const r = await api("clear", { password: savedAdminPass });
    if (r && r.ok) {
      clearedAt = Date.now();
      lsSet(clearedKey, String(clearedAt));
      toast("Chat history cleared for everyone");
    } else toast("Clear failed");
  } else {
    clearedAt = Date.now();
    lsSet(clearedKey, String(clearedAt));
    messagesEl.innerHTML = "";
    addDateSep();
    toast("Chat cleared (your view)");
  }
});

delCancelBtn.addEventListener("click", () => {
  delModal.classList.add("hide");
  pendingDelIds = [];
});
const delSilentBtn = document.getElementById("delSilentBtn");
delSilentBtn.addEventListener("click", () => {
  delModal.classList.add("hide");
  const ids = pendingDelIds;
  pendingDelIds = [];
  if (!ids.length) return;
  for (const id of ids) {
    if (!id) continue;
    sbDeleteDom(id);
    api("delete", { id: String(id).replace(/^sb-/, ""), sender: myName, trace: false, password: isAdmin() ? savedAdminPass : "" });
  }
});
delOkBtn.addEventListener("click", () => {
  delModal.classList.add("hide");
  const ids = pendingDelIds;
  pendingDelIds = [];
  if (!ids.length) return;
  for (const id of ids) {
    if (!id) continue;
    sbDeleteDom(id);
    api("delete", { id: String(id).replace(/^sb-/, ""), sender: myName, trace: true, password: isAdmin() ? savedAdminPass : "" });
  }
});

// ---------- multi-select toolbar (long-press a message, tools in header) ----------
const appEl = document.getElementById("app");
const selBar = document.getElementById("selBar");
const selCount = document.getElementById("selCount");
const selReplyBtn = document.getElementById("selReplyBtn");
const selCopyBtn = document.getElementById("selCopyBtn");
const selVerBtn = document.getElementById("selVerBtn");
const selFlagBtn = document.getElementById("selFlagBtn");
const selInfoBtn = document.getElementById("selInfoBtn");
const selBanBtn = document.getElementById("selBanBtn");
const selDelBtn = document.getElementById("selDelBtn");
const selCloseBtn = document.getElementById("selCloseBtn");
selReplyBtn.innerHTML = REPLY_SVG;
selCopyBtn.innerHTML = COPY_SVG;
selDelBtn.innerHTML = DEL_SVG;
selFlagBtn.innerHTML = FLAG_SVG;
selInfoBtn.innerHTML = INFO_SVG;
selBanBtn.innerHTML = BAN_SVG;
selVerBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" opacity="0.16"/><path d="M8 12.5l3 3 5.5-5.5"/></svg>';

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
  selVerBtn.classList.toggle("hide", !admin);
  selFlagBtn.classList.toggle("hide", !admin);
  selInfoBtn.classList.toggle("hide", !admin);
  selBanBtn.classList.toggle("hide", !admin);
  const ver = target && verifiedSet.has(target);
  selVerBtn.title = ver ? "Remove verification badge" : "Give verification badge to " + (target || "user");
  selVerBtn.innerHTML = ver
    ? VERIFIED_BADGE_SVG
    : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" opacity="0.16"/><path d="M8 12.5l3 3 5.5-5.5"/></svg>';
  const banned = target && bannedNames.has(target);
  selBanBtn.title = banned ? "Unban " + target : "Ban " + target + " (permanent)";
  selBanBtn.innerHTML = banned ? UNBAN_SVG : BAN_SVG;
}

function beginSelection(wrap, m) {
  selectionMode = true;
  appEl.classList.add("selMode");
  selItems.set(wrap, m);
  wrap.classList.add("selected");
  updateSelBar();
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
  appEl.classList.remove("selMode");
  for (const w of selItems.keys()) w.classList.remove("selected");
  selItems.clear();
  updateSelBar();
}

function wireSelection(wrap, bubble, m) {
  msgByWrap.set(wrap, m);
  let timer = null, sx = 0, sy = 0, fired = false;
  const isInteract = (t) => !!(t.closest && (t.closest("button") || t.closest("a")));
  const start = (x, y, t) => {
    if (isInteract(t)) return;
    sx = x; sy = y; fired = false;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fired = true;
      if (selectionMode) toggleSelect(wrap, m); else beginSelection(wrap, m);
      if (navigator.vibrate) navigator.vibrate(12);
    }, 430);
  };
  const move = (x, y) => {
    if (timer && (Math.abs(x - sx) > 12 || Math.abs(y - sy) > 12)) { clearTimeout(timer); timer = null; }
  };
  const up = () => { if (timer) { clearTimeout(timer); timer = null; } };
  bubble.addEventListener("pointerdown", (e) => { if (e.isPrimary !== false) start(e.clientX, e.clientY, e.target); });
  window.addEventListener("pointermove", (e) => { if (e.isPrimary !== false) move(e.clientX, e.clientY); });
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  bubble.addEventListener("contextmenu", (e) => {
    if (isInteract(e.target)) return;
    e.preventDefault();
    if (selectionMode) toggleSelect(wrap, m); else beginSelection(wrap, m);
  });
  bubble.addEventListener("click", (e) => {
    if (selectionMode && !fired && !isInteract(e.target)) toggleSelect(wrap, m);
    fired = false;
  });
}

selCloseBtn.addEventListener("click", endSelection);
selCopyBtn.addEventListener("click", () => {
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
selReplyBtn.addEventListener("click", () => {
  const msgs = selectedMsgs();
  if (msgs.length) setReplyTo(msgs[msgs.length - 1]);
  endSelection();
});
selDelBtn.addEventListener("click", () => {
  const msgs = selectedMsgs();
  if (!msgs.length) return;
  pendingDelIds = msgs.map((x) => x.id).filter(Boolean);
  const single = msgs.length === 1;
  const isOwn = single && msgs[0].from === myName;
  const anyOther = msgs.some((x) => x.from !== myName);
  delSilentBtn.classList.toggle("hide", !isAdmin() || !anyOther);
  delDesc.textContent = single
    ? (isOwn ? "This message will be deleted for everyone in the chat." : "Delete this message for everyone. With a label, a note is left; without a trace it vanishes.")
    : msgs.length + " messages will be deleted for everyone.";
  delModal.classList.remove("hide");
});
selVerBtn.addEventListener("click", () => {
  const users = distinctSelUsers();
  if (!users.length) return;
  const target = users[0];
  const ver = verifiedSet.has(target);
  apiVerify(target, !ver).then((r) => {
    if (r && r.ok) {
      if (ver) verifiedSet.delete(target); else verifiedSet.add(target);
      refreshVerifiedUI();
      updateSelBar();
    }
  });
});
selFlagBtn.addEventListener("click", () => {
  const msgs = selectedMsgs();
  for (const x of msgs) if (x.id) {
    api("flag", { id: String(x.id).replace(/^sb-/, ""), password: savedAdminPass });
  }
  endSelection();
  toast("Message(s) flagged for review");
});
selInfoBtn.addEventListener("click", () => {
  const users = distinctSelUsers();
  if (users.length) showUserInfo(users[0]);
  endSelection();
});
selBanBtn.addEventListener("click", () => {
  const users = distinctSelUsers();
  if (!users.length) return;
  for (const name of users) {
    apiBan(name, !bannedNames.has(name));
  }
  endSelection();
});

// ---------- 18+ age gate ----------
const ageKey = "tgAdult_" + (window.generatorName || "chat");
const ageModal = document.getElementById("ageModal");
const ageYesBtn = document.getElementById("ageYesBtn");
const ageNoBtn = document.getElementById("ageNoBtn");

const gateOverlay = document.getElementById("gateOverlay");
function interactionReady() { return ageApproved && tacAgreed; }
function updateGate() {
  const ready = interactionReady();
  gateOverlay.classList.toggle("hide", ready);
  msgInput.disabled = !ready;
}

function startApp() {
  updateGate();
  connect();
  if (!savedNick) forceNick();
  if (!tacAgreed) tacModal.classList.remove("hide");
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
} else if (!agePreApprove) {
  ageModal.classList.remove("hide");
}
updateGate();
ageYesBtn.addEventListener("click", () => {
  ageApproved = true;
  lsSet(ageKey, "1");
  lsSet(ageKey + "_blocked", "");
  ageModal.classList.add("hide");
  startApp();
});
ageNoBtn.addEventListener("click", () => {
  lsSet(ageKey + "_blocked", "1");
  ageYesBtn.classList.add("hide");
  ageModal.querySelector(".cardTitle").textContent = "18+ only";
  ageModal.querySelector(".cardDesc").textContent = "You must be 18 or older to use this chat. Sorry!";
  ageNoBtn.textContent = "OK";
});

const touchActions = window.matchMedia("(hover: none)").matches;
if (touchActions) {
  messagesEl.addEventListener("click", (e) => {
    if (selectionMode) return;
    const bubble = e.target && e.target.closest ? e.target.closest(".bubble") : null;
    if (!bubble) {
      for (const w of messagesEl.querySelectorAll(".msg.actions-on")) w.classList.remove("actions-on");
      return;
    }
    const wrap = bubble.closest(".msg");
    if (e.target.closest("button") || e.target.closest(".replyQuote")) return;
    const wasOn = wrap.classList.contains("actions-on");
    for (const w of messagesEl.querySelectorAll(".msg.actions-on")) w.classList.remove("actions-on");
    if (!wasOn) wrap.classList.add("actions-on");
  });
}

if (agePreApprove) startApp();

window.__demoVerified = () => {
  verifiedSet.add("Demo_User");
  const m = {
    t: "chat", from: "Demo_User", text: "Hi! I'm a verified user — this blue badge shows I've been verified by an admin.", ts: Date.now()
  };
  addTextBubble(m);
  const s = document.querySelector('#messagesEl .msg:last-child .senderName');
  s && s.scrollIntoView({ behavior: "smooth", block: "center" });
  return "demo added";
};