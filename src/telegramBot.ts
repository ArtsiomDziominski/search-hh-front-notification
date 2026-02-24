import axios from "axios";
import { Input, Markup, Telegraf } from "telegraf";
import {
  addSubscriber,
  clearSentVacancyRecords,
  removeSubscriber
} from "./stateStore";
import { AppSettings } from "./types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface TelegramBotOptions {
  token: string;
  getSettings: () => Promise<AppSettings>;
  onImportSettings: (rawJson: string) => Promise<string>;
}

export class TelegramVacancyBot {
  private readonly bot: Telegraf;
  private readonly getSettings: () => Promise<AppSettings>;
  private readonly onImportSettings: (rawJson: string) => Promise<string>;
  private readonly importWaitChats = new Set<number>();
  private readonly clearDbConfirmPrefix = "clear_db_confirm:";
  private readonly clearDbCancelPrefix = "clear_db_cancel:";

  constructor(options: TelegramBotOptions) {
    this.bot = new Telegraf(options.token);
    this.getSettings = options.getSettings;
    this.onImportSettings = options.onImportSettings;
    this.registerHandlers();
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  private getHelpMessage(): string {
    return [
      "Доступные команды:",
      "/start - подписаться на уведомления о новых вакансиях",
      "/stop - отписаться от уведомлений",
      "/help - показать список команд",
      "/settings - показать текущие настройки в читаемом виде",
      "/filters - показать все фильтры поиска",
      "/queries - показать поисковые фразы",
      "/keywords - показать ключевые слова фильтрации",
      "/import - начать импорт настроек и ждать JSON-файл/текст (только для админа)",
      "/export - выгрузить текущие настройки в JSON-файл (только для админа)",
      "/clear_db - очистить историю отправленных вакансий в БД (только для админа)"
    ].join("\n");
  }

  private formatSettingsForUser(settings: AppSettings): string {
    const adminChatIds = this.getAdminChatIdsFromEnv();
    const area = settings.hh.area ?? "";
    const isAllHhSearch = !settings.hh.area;
    const hhSearchScope = isAllHhSearch
      ? "все регионы HH"
      : `регион ${this.escapeHtml(area)}`;

    const lines = [
      "<b>Текущие настройки бота:</b>",
      `Интервал проверки: <b>${settings.pollIntervalMinutes} мин</b>`,
      `Поисковых фраз: <b>${settings.searchQueries.length}</b>`,
      `Ключевых слов (включить): <b>${settings.requiredKeywords.length}</b>`,
      `Ключевых слов (исключить): <b>${settings.excludedKeywords.length}</b>`,
      `Поиск по всем HH: <b>${isAllHhSearch ? "да" : "нет"}</b>`,
      `Область поиска HH: <b>${hhSearchScope}</b>`,
      `Результатов на страницу: <b>${settings.hh.perPage}</b>`,
      `Страниц за цикл: <b>${settings.hh.pages}</b>`,
      `Только с зарплатой: <b>${settings.hh.onlyWithSalary ? "да" : "нет"}</b>`,
      `Пауза между сообщениями: <b>${settings.telegram.messageDelayMs} мс</b>`,
      `Лимит истории отправленных вакансий: <b>${settings.sentVacancyHistoryLimit}</b>`,
      `Админов для импорта: <b>${adminChatIds.length}</b>`
    ];

    return lines.join("\n");
  }

  private formatQueriesForUser(settings: AppSettings): string {
    const items = settings.searchQueries.map(
      (query, index) => `${index + 1}. ${this.escapeHtml(query)}`
    );
    return ["Поисковые фразы:", ...items].join("\n");
  }

  private formatKeywordsForUser(settings: AppSettings): string {
    const required = settings.requiredKeywords.length
      ? settings.requiredKeywords.join(", ")
      : "не заданы";
    const excluded = settings.excludedKeywords.length
      ? settings.excludedKeywords.join(", ")
      : "не заданы";

    return [
      "<b>Ключевые слова фильтрации:</b>",
      `Включить: <b>${this.escapeHtml(required)}</b>`,
      `Исключить: <b>${this.escapeHtml(excluded)}</b>`
    ].join("\n");
  }

  private formatFiltersForUser(settings: AppSettings): string {
    const area = settings.hh.area ?? "";
    const isAllHhSearch = !settings.hh.area;
    const hhSearchScope = isAllHhSearch
      ? "все регионы HH"
      : `регион ${this.escapeHtml(area)}`;

    const queries = settings.searchQueries.length
      ? settings.searchQueries.map((query, index) => `${index + 1}. ${this.escapeHtml(query)}`).join("\n")
      : "не заданы";

    const required = settings.requiredKeywords.length
      ? settings.requiredKeywords.map((keyword) => this.escapeHtml(keyword)).join(", ")
      : "не заданы";

    const excluded = settings.excludedKeywords.length
      ? settings.excludedKeywords.map((keyword) => this.escapeHtml(keyword)).join(", ")
      : "не заданы";

    return [
      "Фильтры поиска:",
      "",
      "Поисковые фразы:",
      queries,
      "",
      `Ключевые слова (включить): <b>${required}</b>`,
      `Ключевые слова (исключить): <b>${excluded}</b>`,
      "",
      `Поиск по всем HH: <b>${isAllHhSearch ? "да" : "нет"}</b>`,
      `Область поиска HH: <b>${hhSearchScope}</b>`,
      `Только с зарплатой: <b>${settings.hh.onlyWithSalary ? "да" : "нет"}</b>`,
      `Результатов на страницу: <b>${settings.hh.perPage}</b>`,
      `Страниц за цикл: <b>${settings.hh.pages}</b>`
    ].join("\n");
  }

  private registerHandlers(): void {
    this.bot.start(async (ctx) => {
      const added = await addSubscriber(ctx.chat.id);
      if (added) {
        await ctx.reply(
          `Подписка включена. Буду присылать новые вакансии HH.\n\n${this.getHelpMessage()}`,
          { parse_mode: "HTML" }
        );
        return;
      }

      await ctx.reply(`Вы уже подписаны на уведомления.\n\n${this.getHelpMessage()}`, {
        parse_mode: "HTML"
      });
    });

    this.bot.command("help", async (ctx) => {
      await ctx.reply(this.getHelpMessage(), { parse_mode: "HTML" });
    });

    this.bot.command("settings", async (ctx) => {
      const settings = await this.getSettings();
      await ctx.reply(this.formatSettingsForUser(settings), { parse_mode: "HTML" });
    });

    this.bot.command("queries", async (ctx) => {
      const settings = await this.getSettings();
      await ctx.reply(this.formatQueriesForUser(settings), { parse_mode: "HTML" });
    });

    this.bot.command("keywords", async (ctx) => {
      const settings = await this.getSettings();
      await ctx.reply(this.formatKeywordsForUser(settings), { parse_mode: "HTML" });
    });

    this.bot.command("filters", async (ctx) => {
      const settings = await this.getSettings();
      await ctx.reply(this.formatFiltersForUser(settings), { parse_mode: "HTML" });
    });

    this.bot.command("stop", async (ctx) => {
      const removed = await removeSubscriber(ctx.chat.id);
      if (removed) {
        await ctx.reply("Подписка отключена.");
        return;
      }

      await ctx.reply("Вы не были подписаны.");
    });

    this.bot.command("import", async (ctx) => {
      if (!(await this.canImport(ctx.chat.id))) {
        await ctx.reply("Команда /import доступна только администраторам.");
        return;
      }

      const messageText = "text" in ctx.message ? ctx.message.text : "";
      const payload = messageText.replace(/^\/import(?:@\w+)?\s*/i, "").trim();
      if (!payload) {
        this.importWaitChats.add(ctx.chat.id);
        await ctx.reply("Режим импорта включен. Отправьте JSON-файл или JSON-текст в этот чат.");
        return;
      }

      const result = await this.onImportSettings(payload);
      await ctx.reply(result);
      this.importWaitChats.delete(ctx.chat.id);
    });

    this.bot.command("export", async (ctx) => {
      if (!(await this.canImport(ctx.chat.id))) {
        await ctx.reply("Команда /export доступна только администраторам.");
        return;
      }

      const settings = await this.getSettings();
      const json = `${JSON.stringify(settings, null, 2)}\n`;
      await ctx.replyWithDocument(
        Input.fromBuffer(Buffer.from(json, "utf-8"), "settings.export.json"),
        {
          caption: "Текущие настройки."
        }
      );
    });

    this.bot.command("clear_db", async (ctx) => {
      const chatId = ctx.chat.id;
      if (!(await this.canImport(chatId))) {
        await ctx.reply("Команда /clear_db доступна только администраторам.");
        return;
      }

      await ctx.reply(
        "Подтвердите очистку БД отправленных вакансий:",
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "Да, удалить",
              `${this.clearDbConfirmPrefix}${chatId}`
            ),
            Markup.button.callback(
              "Нет, отмена",
              `${this.clearDbCancelPrefix}${chatId}`
            )
          ]
        ])
      );
    });

    this.bot.action(/^clear_db_confirm:(-?\d+)$/i, async (ctx) => {
      const requesterChatId = Number(ctx.match[1]);
      if (ctx.chat?.id !== requesterChatId) {
        await ctx.answerCbQuery("Эта кнопка не для этого чата.");
        return;
      }

      if (!(await this.canImport(requesterChatId))) {
        await ctx.answerCbQuery("Недостаточно прав.");
        await ctx.editMessageText("Команда /clear_db доступна только администраторам.");
        return;
      }

      const deletedCount = await clearSentVacancyRecords();
      await ctx.answerCbQuery("БД очищена.");
      await ctx.editMessageText(
        `База отправленных вакансий очищена. Удалено записей: ${deletedCount}.`
      );
    });

    this.bot.action(/^clear_db_cancel:(-?\d+)$/i, async (ctx) => {
      const requesterChatId = Number(ctx.match[1]);
      if (ctx.chat?.id !== requesterChatId) {
        await ctx.answerCbQuery("Эта кнопка не для этого чата.");
        return;
      }

      await ctx.answerCbQuery("Очистка отменена.");
      await ctx.editMessageText("Очистка БД отменена.");
    });

    this.bot.on("document", async (ctx) => {
      const caption = ctx.message.caption ?? "";
      const isImportByCaption = /^\/import(?:@\w+)?/i.test(caption.trim());
      const isWaitingImport = this.importWaitChats.has(ctx.chat.id);
      if (!isImportByCaption && !isWaitingImport) {
        return;
      }

      if (!(await this.canImport(ctx.chat.id))) {
        await ctx.reply("Команда /import доступна только администраторам.");
        return;
      }

      try {
        const fileLink = await ctx.telegram.getFileLink(ctx.message.document.file_id);
        const response = await axios.get<string>(fileLink.toString(), { responseType: "text" });
        const result = await this.onImportSettings(response.data);
        await ctx.reply(result);
        this.importWaitChats.delete(ctx.chat.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown file download error";
        await ctx.reply(`Ошибка импорта JSON: ${message}`);
      }
    });

    this.bot.on("text", async (ctx) => {
      const text = ctx.message.text.trim();
      if (text.startsWith("/")) {
        return;
      }

      if (!this.importWaitChats.has(ctx.chat.id)) {
        return;
      }

      if (!(await this.canImport(ctx.chat.id))) {
        await ctx.reply("Команда /import доступна только администраторам.");
        this.importWaitChats.delete(ctx.chat.id);
        return;
      }

      const result = await this.onImportSettings(text);
      await ctx.reply(result);
      this.importWaitChats.delete(ctx.chat.id);
    });
  }

  private async canImport(chatId: number): Promise<boolean> {
    return this.getAdminChatIdsFromEnv().includes(chatId);
  }

  private getAdminChatIdsFromEnv(): number[] {
    const rawAdminChatIds = process.env.ADMIN_CHAT_IDS ?? "";
    return rawAdminChatIds
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value));
  }

  async start(): Promise<void> {
    await this.bot.launch();
  }

  async sendToSubscribers(subscribers: number[], message: string, delayMs: number): Promise<void> {
    for (const chatId of subscribers) {
      try {
        await this.bot.telegram.sendMessage(chatId, message, { parse_mode: "HTML" });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : "Unknown sendMessage error";
        console.error(`Failed to send message to chat ${chatId}: ${errMsg}`);
      }

      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  async stop(signal = "SIGINT"): Promise<void> {
    this.bot.stop(signal);
  }
}

