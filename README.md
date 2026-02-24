# HH Telegram Vacancy Bot

Telegram-бот для поиска вакансий на HH и отправки уведомлений подписчикам.

## Быстрый старт

1. Установите зависимости:
   - `npm install`
2. Создайте `.env` из примера:
   - скопируйте `.env.example` в `.env`
   - укажите `TELEGRAM_BOT_TOKEN`
3. Настройте параметры в `config/settings.json`.
4. Добавьте admin chat id для импорта настроек в `config/settings.json`:
   - `import.adminChatIds: [123456789]`
5. Запустите бота:
   - dev: `npm run dev`
   - prod: `npm run build` и `npm start`

## Команды бота

- `/start` — подписка на уведомления.
- `/stop` — отписка от уведомлений.
- `/settings` — текущие настройки в читаемом виде (без показа admin id).
- `/filters` — все фильтры поиска одним сообщением.
- `/queries` — список поисковых фраз.
- `/keywords` — текущие ключевые слова включения/исключения.
- `/import` — бот включает режим ожидания и ждет JSON-файл или JSON-текст (только admin chat id).
- `/export` — выгрузка текущих настроек в JSON-файл (только admin chat id).

## Настройки

Все настройки лежат в `config/settings.json` и валидируются по `config/settings.schema.json`:

- `pollIntervalMinutes` — интервал опроса HH.
- `searchQueries` — массив поисковых запросов (синонимы вакансии).
- `requiredKeywords` — ключевые слова для включения вакансий.
- `excludedKeywords` — ключевые слова для исключения вакансий.
- `hh` — параметры HH API.
- `telegram.messageDelayMs` — пауза между отправками.
- `import.adminChatIds` — chat id, которым разрешен `/import`.
