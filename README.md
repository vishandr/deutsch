# Deutsch — тренажёр слов

Офлайн-приложение (PWA) для iPhone: колоды слов и диалогов, карточки, прогресс.

## Структура
- `index.html`, `app.css`, `app.js` — само приложение
- `sw.js` — офлайн-режим (кэширует приложение и колоды)
- `decks/index.json` — список колод, которые приложение подгружает
- `decks/*.json` — колоды

## Добавить новую колоду
1. Положить файл `decks/<имя>.json`.
2. Дописать имя файла в `decks/index.json`.
3. В приложении нажать «Обновить с сервера» (нужен интернет).

Если меняются `app.js`/`app.css`/`index.html`, поднять `VERSION` в `sw.js`.

## Формат колоды «слова»
{"id":"a1-thema","title":"…","subtitle":"…","type":"vocab",
 "sections":[{"title":"Einkaufen","ru":"Покупки",
   "words":[{"de":"der Laden","pl":"¨-","ru":"магазин","note":"мн.ч. die Läden"}],
   "phrases":[{"de":"Ich brauche nichts.","ru":"Мне ничего не нужно."}],
   "tip":"…"}]}

## Формат колоды «диалог»
{"id":"a1-dialog","title":"…","type":"dialog","speakers":{"V":"Verkäuferin","K":"Kunde"},
 "lines":[{"s":"V","de":"…","ru":"…"}],"notes":["…"]}
