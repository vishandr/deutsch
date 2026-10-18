"use strict";
/* ---------- storage ---------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let serverDecks = LS.get("serverDecks", {});   // id -> deck (cached copy from GitHub)
let importedDecks = LS.get("importedDecks", {}); // id -> deck (imported from file)
let progress = LS.get("progress", {});           // deckId -> {cardKey: box 0..5}
let settings = LS.get("settings", { dir: "de", incl: false, weak: false, hideRu: false, hideRuD: false });
let cur = null, mode = "list", sec = "all", hideWho = "none";

function allDecks() { return Object.assign({}, serverDecks, importedDecks); }
function saveSettings() { LS.set("settings", settings); }
/* ---------- speech (built-in synthesizer) ---------- */
const TTS = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
const SPK = `<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 4V5L7 9H3z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
let deVoice = null;
function pickVoice() {
  // prefer de-DE, then downloaded "Premium/Enhanced" voices, then on-device ones
  const score = v => (/^de[-_]DE/i.test(v.lang) ? 4 : 0) + (/premium|enhanced|erweitert/i.test(v.name) ? 2 : 0) + (v.localService ? 1 : 0);
  deVoice = speechSynthesis.getVoices().filter(v => /^de([-_]|$)/i.test(v.lang)).sort((a, b) => score(b) - score(a))[0] || null;
}
if (TTS) { pickVoice(); speechSynthesis.addEventListener?.("voiceschanged", pickVoice); }
function say(text) {
  if (!TTS || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "de-DE"; u.rate = 0.9; if (deVoice) u.voice = deVoice;
  speechSynthesis.speak(u);
}
function sayBtn(text, cls) { return TTS && text ? `<button class="say${cls ? " " + cls : ""}" data-say="${esc(text)}" aria-label="Озвучить">${SPK}</button>` : ""; }
// capture phase: a speaker tap must not also flip the card / reveal the row
document.addEventListener("click", e => {
  const b = e.target.closest("[data-say]"); if (!b) return;
  e.stopPropagation(); e.preventDefault(); say(b.dataset.say);
}, true);

function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); }

/* ---------- deck helpers ---------- */
function deHtml(w, pl) {
  const m = String(w).match(/^(der|die|das)\s(.*)$/);
  let h = m ? `<span class="${pl === "Pl." ? "die" : m[1]}">${m[1]}</span> ${esc(m[2])}` : esc(w);
  if (pl) h += ` <small>${esc(pl)}</small>`;
  return h;
}
function cardsOf(d, includePhrases) {
  const out = [];
  if (d.type === "dialog") {
    (d.lines || []).forEach((l, i) => out.push({ k: "l" + i, q: esc(l.de), a: esc(l.ru), t: l.de, sp: (d.speakers || {})[l.s] || l.s }));
  } else {
    (d.sections || []).forEach(s => {
      if (sec !== "all" && s.title !== sec) return;
      (s.words || []).forEach(w => out.push({ k: "w:" + w.de, q: deHtml(w.de, w.pl), a: esc(w.ru), t: w.de, n: w.note }));
      if (includePhrases) (s.phrases || []).forEach(p => out.push({ k: "p:" + p.de, q: esc(p.de), a: esc(p.ru), t: p.de }));
    });
  }
  return out;
}
function allKeys(d) {
  if (d.type === "dialog") return (d.lines || []).map((_, i) => "l" + i);
  const k = []; (d.sections || []).forEach(s => (s.words || []).forEach(w => k.push("w:" + w.de))); return k;
}
function stats(d) {
  const p = progress[d.id] || {}, keys = allKeys(d);
  const known = keys.filter(k => (p[k] || 0) >= 2).length;
  return { known, total: keys.length };
}
function validDeck(d) { return d && typeof d === "object" && d.id && d.title && (Array.isArray(d.sections) || Array.isArray(d.lines)); }

/* ---------- loading ---------- */
async function refreshFromServer(silent) {
  try {
    const r = await fetch("decks/index.json", { cache: "no-store" });
    if (!r.ok) throw 0;
    const idx = await r.json();
    const fresh = {};
    for (const f of idx.decks || []) {
      try { const d = await (await fetch("decks/" + f, { cache: "no-store" })).json(); if (validDeck(d)) fresh[d.id] = d; } catch (e) {}
    }
    if (Object.keys(fresh).length) { serverDecks = fresh; LS.set("serverDecks", serverDecks); }
    if (!silent) toast("Колоды обновлены: " + Object.keys(fresh).length);
    $("#status").textContent = "Обновлено " + new Date().toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    LS.set("lastSync", $("#status").textContent);
    renderHome();
  } catch (e) {
    if (!silent) toast("Нет связи. Работаю с сохранёнными колодами.");
  }
}

/* ---------- home ---------- */
function renderHome() {
  const decks = Object.values(allDecks());
  const box = $("#deckList");
  if (!decks.length) { box.innerHTML = `<p class="empty">Колод пока нет. Нажмите «Обновить с сервера» или импортируйте файл.</p>`; return; }
  box.innerHTML = "";
  decks.forEach(d => {
    const s = stats(d), pct = s.total ? Math.round(s.known / s.total * 100) : 0;
    const b = document.createElement("button");
    b.className = "deckItem";
    b.innerHTML = `<div class="row1"><b>${esc(d.title)}</b><span class="kind">${d.type === "dialog" ? "диалог" : "слова"}${importedDecks[d.id] ? " · импорт" : ""}</span></div>
      <p>${esc(d.subtitle || "")}</p><div class="pbar"><span style="width:${pct}%"></span></div>
      <div class="ptxt">Выучено ${s.known} из ${s.total}</div>`;
    b.onclick = () => openDeck(d.id);
    box.appendChild(b);
  });
}
function showHome() {
  cur = null;
  $("#home").hidden = false; $("#deck").hidden = true; $("#back").hidden = true;
  $("#title").textContent = "Deutsch"; $("#subtitle").textContent = "Мои колоды";
  renderHome(); scrollTo(0, 0);
}

/* ---------- deck ---------- */
function openDeck(id) {
  cur = allDecks()[id]; if (!cur) return;
  sec = "all"; hideWho = "none";
  $("#home").hidden = true; $("#deck").hidden = false; $("#back").hidden = false;
  $("#title").textContent = cur.title; $("#subtitle").textContent = cur.subtitle || "";
  $("#delDeck").hidden = !importedDecks[id];
  const tabs = cur.type === "dialog" ? [["dialog", "Диалог"], ["cards", "Карточки"]] : [["list", "Список"], ["cards", "Карточки"]];
  $("#tabs").innerHTML = tabs.map(([m, l]) => `<button data-m="${m}">${l}</button>`).join("");
  $("#tabs").querySelectorAll("button").forEach(b => b.onclick = () => setMode(b.dataset.m));
  setMode(tabs[0][0]);
  scrollTo(0, 0);
}
function setMode(m) {
  mode = m;
  $("#tabs").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.m === m));
  $("#listView").hidden = m !== "list"; $("#dialogView").hidden = m !== "dialog"; $("#cardView").hidden = m !== "cards";
  if (m === "list") renderList();
  if (m === "dialog") renderDialog();
  if (m === "cards") resetDeck();
}

function renderChips() {
  const c = $("#chips"); c.innerHTML = "";
  [["all", "Всё"], ...(cur.sections || []).map(s => [s.title, s.title])].forEach(([id, l]) => {
    const b = document.createElement("button"); b.className = "chip"; b.textContent = l; b.setAttribute("aria-pressed", sec === id);
    b.onclick = () => { sec = id; renderList(); }; c.appendChild(b);
  });
}
function renderList() {
  renderChips();
  const body = $("#listBody");
  body.className = settings.hideRu ? "hideRu" : "";
  let h = "";
  (cur.sections || []).filter(s => sec === "all" || s.title === sec).forEach(s => {
    h += `<div class="sec"><div class="tag"><h2>${esc(s.title)}</h2><span>${esc(s.ru || "")}</span></div><div class="list">`;
    (s.words || []).forEach(w => h += `<div class="row"><div class="de">${deHtml(w.de, w.pl)}${sayBtn(w.de)}</div><div class="ru">${esc(w.ru)}</div>${w.note ? `<div class="note">${esc(w.note)}</div>` : ""}</div>`);
    h += "</div>";
    if ((s.phrases || []).length) {
      h += `<h3>Фразы</h3><div class="list phr">`;
      s.phrases.forEach(p => h += `<div class="row"><div class="de">${esc(p.de)}${sayBtn(p.de)}</div><div class="ru">${esc(p.ru)}</div></div>`);
      h += "</div>";
    }
    if (s.tip) h += `<div class="tip">${esc(s.tip)}</div>`;
    h += "</div>";
  });
  body.innerHTML = h;
  body.querySelectorAll(".row").forEach(r => r.onclick = () => { if (settings.hideRu) r.classList.toggle("open"); });
}

function renderDialog() {
  const sp = cur.speakers || {}, keys = Object.keys(sp);
  const hw = $("#hideWho"); hw.innerHTML = "";
  [["none", "Показать всё"], ...keys.map(k => [k, "Скрыть: " + (sp[k] || k)])].forEach(([id, l]) => {
    const b = document.createElement("button"); b.className = "chip"; b.textContent = l; b.setAttribute("aria-pressed", hideWho === id);
    b.onclick = () => { hideWho = id; renderDialog(); }; hw.appendChild(b);
  });
  const right = keys[keys.length - 1];
  let h = `<div class="dlg">`;
  (cur.lines || []).forEach(l => {
    const hideDe = hideWho === l.s;
    h += `<div class="line${l.s === right ? " right" : ""}"><span class="who">${esc(sp[l.s] || l.s)}${sayBtn(l.de)}</span>
      <span class="lde${hideDe ? " blur" : ""}">${esc(l.de)}</span>
      <span class="lru${settings.hideRuD ? " blur" : ""}">${esc(l.ru)}</span></div>`;
  });
  h += `</div>`;
  if ((cur.notes || []).length) h += `<div class="notes"><h3>Заметки</h3><ul>${cur.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul></div>`;
  $("#dialogBody").innerHTML = h;
  $("#dialogBody").querySelectorAll(".line").forEach(l => l.onclick = () => l.classList.toggle("open"));
}

/* ---------- cards ---------- */
let deck = [], pos = 0, flipped = false, lastAuto = null;
function box(k) { return ((progress[cur.id] || {})[k]) || 0; }
function setBox(k, v) { (progress[cur.id] = progress[cur.id] || {})[k] = v; LS.set("progress", progress); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function resetDeck() {
  let c = cardsOf(cur, settings.incl || cur.type === "dialog");
  if (settings.weak) c = c.filter(x => box(x.k) < 2);
  deck = shuffle(c).sort((a, b) => box(a.k) - box(b.k)); // weakest first
  pos = 0; flipped = false; lastAuto = null; showCard();
}
function showCard() {
  $("#dir").textContent = settings.dir === "de" ? "DE → RU" : "RU → DE";
  $("#incl").textContent = "+ фразы: " + (settings.incl ? "да" : "нет");
  $("#incl").hidden = cur.type === "dialog";
  $("#weak").textContent = settings.weak ? "Только трудные" : "Все слова";
  $("#tts").textContent = "Озвучка: " + (settings.tts ? "авто" : "выкл");
  $("#tts").hidden = !TTS;
  $("#saySlot").innerHTML = "";
  const total = deck.length;
  $("#meterFill").style.width = (total ? pos / total * 100 : 0) + "%";
  if (!total) { $("#sp").textContent = ""; $("#front").textContent = "Всё выучено!"; $("#backTxt").hidden = true; $("#hint").textContent = "Переключите на «Все слова», чтобы повторить"; $("#hint").hidden = false; $("#count").textContent = ""; return; }
  if (pos >= total) { $("#sp").textContent = ""; $("#front").textContent = "Круг пройден"; $("#backTxt").hidden = true; $("#hint").textContent = "«Заново» — ещё раз"; $("#hint").hidden = false; $("#count").textContent = `${total} из ${total}`; return; }
  const c = deck[pos], de = settings.dir === "de";
  $("#sp").textContent = c.sp || "";
  $("#front").innerHTML = de ? c.q : c.a;
  $("#backTxt").innerHTML = (de ? c.a : c.q) + (c.n ? `<small>${esc(c.n)}</small>` : "");
  $("#backTxt").hidden = !flipped; $("#hint").hidden = flipped; $("#hint").textContent = "тап — показать ответ";
  $("#count").textContent = `${pos + 1} из ${total}`;
  // German side visible → speaker button; auto-speak once per reveal
  const deVisible = de || flipped;
  if (deVisible) $("#saySlot").innerHTML = sayBtn(c.t, "big");
  if (settings.tts && deVisible && lastAuto !== pos + ":" + c.k) { lastAuto = pos + ":" + c.k; say(c.t); }
}
$("#card").onclick = () => { if (pos < deck.length) { flipped = !flipped; showCard(); } };
$("#card").onkeydown = e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); $("#card").click(); } };
$("#know").onclick = () => { if (pos < deck.length) { const k = deck[pos].k; setBox(k, Math.min(box(k) + 1, 5)); pos++; flipped = false; showCard(); } };
$("#again").onclick = () => { if (pos < deck.length) { const c = deck.splice(pos, 1)[0]; setBox(c.k, 0); deck.push(c); flipped = false; showCard(); } };
$("#shuffle").onclick = resetDeck;
$("#dir").onclick = () => { settings.dir = settings.dir === "de" ? "ru" : "de"; saveSettings(); flipped = false; showCard(); };
$("#incl").onclick = () => { settings.incl = !settings.incl; saveSettings(); resetDeck(); };
$("#tts").onclick = () => { settings.tts = !settings.tts; saveSettings(); lastAuto = null; if (!settings.tts && TTS) speechSynthesis.cancel(); showCard(); };
$("#weak").onclick = () => { settings.weak = !settings.weak; saveSettings(); resetDeck(); };

/* reset / delete — two-tap confirm (no dialogs) */
function twoTap(btn, label, fn) {
  if (btn.dataset.arm) { delete btn.dataset.arm; btn.textContent = label; fn(); return; }
  btn.dataset.arm = 1; btn.textContent = "Точно? Нажмите ещё раз";
  setTimeout(() => { if (btn.dataset.arm) { delete btn.dataset.arm; btn.textContent = label; } }, 3000);
}
$("#resetProg").onclick = e => twoTap(e.target, "Сбросить прогресс колоды", () => { delete progress[cur.id]; LS.set("progress", progress); resetDeck(); toast("Прогресс сброшен"); });
$("#delDeck").onclick = e => twoTap(e.target, "Удалить колоду", () => { delete importedDecks[cur.id]; LS.set("importedDecks", importedDecks); showHome(); toast("Колода удалена"); });

/* ---------- import ---------- */
$("#importFile").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const list = Array.isArray(data) ? data : [data];
    let n = 0;
    list.forEach(d => { if (validDeck(d)) { importedDecks[d.id] = d; n++; } });
    if (!n) throw 0;
    LS.set("importedDecks", importedDecks); renderHome(); toast("Импортировано колод: " + n);
  } catch (err) { toast("Файл не похож на колоду. Нужен .json от Claude."); }
  e.target.value = "";
};
$("#refresh").onclick = () => refreshFromServer(false);
$("#back").onclick = () => { if (TTS) speechSynthesis.cancel(); showHome(); };
$("#hideRu").checked = settings.hideRu;
$("#hideRu").onchange = e => { settings.hideRu = e.target.checked; saveSettings(); renderList(); };
$("#hideRuD").checked = settings.hideRuD;
$("#hideRuD").onchange = e => { settings.hideRuD = e.target.checked; saveSettings(); renderDialog(); };

/* ---------- start ---------- */
$("#status").textContent = LS.get("lastSync", "");
showHome();
refreshFromServer(true);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
