import dotenv from "dotenv";
import { loadSettings, importSettingsFromRaw } from "./config";
import { devLog, devWarn } from "./devLogger";
import { matchesKeywords } from "./filter";
import { fetchVacanciesByQueries, fetchVacancyDetailsByUrl } from "./hhClient";
import {
  addVacancyDetailRecords,
  addSentVacancyRecords,
  getVacancyDetailsPayloadByIds,
  getVacancyIdsWithoutDetails,
  getSentVacancyIds,
  getSubscribers,
  initializeStateStore
} from "./stateStore";
import { TelegramVacancyBot } from "./telegramBot";
import { HHVacancy } from "./types";

dotenv.config();

function formatSalary(vacancy: HHVacancy): string {
  const salary = vacancy.salary;
  if (!salary) {
    return "Не указана";
  }

  const from = salary.from ?? "—";
  const to = salary.to ?? "—";
  const currency = salary.currency ?? "";
  return `${from} - ${to} ${currency}`.trim();
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sanitizeForTelegramHtml(value: string): string {
  return escapeHtml(stripHtmlTags(value));
}

function formatVacancyMessage(vacancy: HHVacancy, detailedVacancy: Record<string, unknown> | null = null): string {
  const title = sanitizeForTelegramHtml(vacancy.name);
  const company = sanitizeForTelegramHtml(vacancy.employer?.name ?? "Компания не указана");
  const area = sanitizeForTelegramHtml(vacancy.area?.name ?? "Локация не указана");
  const requirement = sanitizeForTelegramHtml(vacancy.snippet?.requirement ?? "");
  const publishedAt = sanitizeForTelegramHtml(vacancy.published_at ?? "");
  const salary = sanitizeForTelegramHtml(formatSalary(vacancy));
  const safeAlternateUrl = sanitizeForTelegramHtml(vacancy.alternate_url);
  const skills = Array.isArray(detailedVacancy?.key_skills) ? detailedVacancy.key_skills.map((skill: { name: string }) => sanitizeForTelegramHtml(skill?.name || "")).join(" ") : "";

  const detailsBlock = [
    `Название: <b>${title}</b>`,
    `Компания: ${company}`,
    `Локация: ${area}`,
    `Зарплата: <b>${salary}</b>`
  ].join("\n");

  const contentBlocks = [
    requirement ? `Требования:\n${requirement} \n` : "",
    skills ? `Cкилы: <b>${skills}</b>` : ''
  ].filter(Boolean);

  return [
    "<b>Новая вакансия:</b>",
    "",
    detailsBlock,
    ...(contentBlocks.length > 0 ? ["", ...contentBlocks] : []),
    ...(publishedAt ? ["", `Опубликовано: ${publishedAt}`] : []),
    "",
    `Подробная информация: ${safeAlternateUrl}`
  ].join("\n");
}

function extractKeySkills(details: Record<string, unknown>): string[] {
  const rawKeySkills = details.key_skills;
  if (!Array.isArray(rawKeySkills)) {
    return [];
  }

  return rawKeySkills
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const maybeName = (entry as { name?: unknown }).name;
      return typeof maybeName === "string" && maybeName.length > 0 ? maybeName : null;
    })
    .filter((skill): skill is string => skill !== null);
}

async function runPollingCycle(bot: TelegramVacancyBot): Promise<void> {
  const startedAt = Date.now();
  devLog(`[runPollingCycle] started at ${new Date(startedAt).toISOString()}`);
  const settings = await loadSettings();
  devLog(
    `[runPollingCycle] settings loaded: queries=${settings.searchQueries.length}, pages=${settings.hh.pages}, perPage=${settings.hh.perPage}`
  );
  const allVacancies = await fetchVacanciesByQueries(settings);
  devLog(`[runPollingCycle] fetched vacancies: total=${allVacancies.length}`);
  const sentIds = await getSentVacancyIds();
  const newVacancies = allVacancies.filter((vacancy) => !sentIds.has(vacancy.id));
  devLog(
    `[runPollingCycle] deduplicated vacancies: alreadySent=${sentIds.size}, new=${newVacancies.length}`
  );
  if (newVacancies.length === 0) {
    devLog("No new vacancies found.");
    return;
  }

  const vacanciesWithoutDetails = await getVacancyIdsWithoutDetails(newVacancies.map((vacancy) => vacancy.id));
  if (vacanciesWithoutDetails.length > 0) {
    const idsWithoutDetailsSet = new Set(vacanciesWithoutDetails);
    const detailRecords: Array<{
      vacancyId: string;
      detailedInformationUrl: string;
      payload: Record<string, unknown>;
      keySkills: string[];
    }> = [];

    for (const vacancy of newVacancies) {
      if (!idsWithoutDetailsSet.has(vacancy.id)) {
        continue;
      }

      const detailedInformationUrl =
        typeof vacancy.detailed_information_url === "string" && vacancy.detailed_information_url.length > 0
          ? vacancy.detailed_information_url
          : vacancy.url;
      if (!detailedInformationUrl) {
        devWarn(
          `[runPollingCycle] skip vacancy details fetch: id=${vacancy.id} has no detailed_information_url/url`
        );
        continue;
      }

      const details = await fetchVacancyDetailsByUrl(detailedInformationUrl);
      if (!details) {
        continue;
      }

      detailRecords.push({
        vacancyId: vacancy.id,
        detailedInformationUrl,
        payload: typeof details.id === "string" ? details : { ...details, id: vacancy.id },
        keySkills: extractKeySkills(details)
      });
    }

    await addVacancyDetailRecords(detailRecords);
    devLog(
      `[runPollingCycle] vacancy details stored: requested=${vacanciesWithoutDetails.length}, saved=${detailRecords.length}`
    );
  }

  const detailsPayloadByVacancyId = await getVacancyDetailsPayloadByIds(
    newVacancies.map((vacancy) => vacancy.id)
  );
  const filteredVacancies = newVacancies.filter((vacancy) =>
    matchesKeywords(
      vacancy,
      settings.requiredKeywords,
      settings.excludedKeywords,
      detailsPayloadByVacancyId.get(vacancy.id) ?? null
    )
  );
  devLog(
    `[runPollingCycle] filtered vacancies: matched=${filteredVacancies.length}, requiredKeywords=${settings.requiredKeywords.length}, excludedKeywords=${settings.excludedKeywords.length}`
  );
  if (filteredVacancies.length === 0) {
    devLog("No new vacancies matched filters.");
    return;
  }

  const subscribers = await getSubscribers();
  devLog(`[runPollingCycle] subscribers loaded: count=${subscribers.length}`);
  if (subscribers.length === 0) {
    devLog("No subscribers, skipping notifications.");
    return;
  }

  for (const [index, vacancy] of filteredVacancies.entries()) {
    devLog(
      `[runPollingCycle] sending ${index + 1}/${filteredVacancies.length}: id=${vacancy.id}, title="${vacancy.name}"`
    );
    const message = formatVacancyMessage(vacancy, detailsPayloadByVacancyId.get(vacancy.id) ?? null);
    await bot.sendToSubscribers(subscribers, message, settings.telegram.messageDelayMs);
  }

  await addSentVacancyRecords(filteredVacancies, settings.sentVacancyHistoryLimit);
  const elapsedMs = Date.now() - startedAt;
  devLog(
    `Sent ${filteredVacancies.length} new vacancies to ${subscribers.length} subscribers (cycle=${elapsedMs}ms).`
  );
}

async function main(): Promise<void> {
  devLog("Application startup: begin.");
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing. Add it to your environment.");
  }

  await initializeStateStore();
  devLog("State store initialized.");
  const startupSettings = await loadSettings();
  devLog(
    `Startup settings loaded: pollIntervalMinutes=${startupSettings.pollIntervalMinutes}, sentVacancyHistoryLimit=${startupSettings.sentVacancyHistoryLimit}`
  );

  const bot = new TelegramVacancyBot({
    token,
    getSettings: loadSettings,
    onImportSettings: async (rawJson: string) => {
      const result = await importSettingsFromRaw(rawJson);
      if (!result.ok) {
        return `JSON не корректен:\n- ${result.errors.join("\n- ")}`;
      }

      return "JSON импортирован успешно.";
    }
  });

  devLog("Starting Telegram bot...");
  void bot.start()
    .then(() => {
      devLog("Telegram bot started.");
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : "Unknown bot startup error";
      console.error(`Telegram bot startup failed: ${message}`);
    });

  let isCycleRunning = false;
  const runCycleSafely = async (): Promise<void> => {
    if (isCycleRunning) {
      devLog("Previous cycle is still running, skip current tick.");
      return;
    }

    isCycleRunning = true;
    try {
      await runPollingCycle(bot);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown cycle error";
      console.error(`Polling cycle failed: ${message}`);
    } finally {
      isCycleRunning = false;
    }
  };

  await runCycleSafely();
  const intervalMs = startupSettings.pollIntervalMinutes * 60 * 1000;
  devLog(`Polling interval configured: ${intervalMs}ms.`);
  setInterval(() => {
    void runCycleSafely();
  }, intervalMs);

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      devLog(`Received ${signal}, stopping bot...`);
      void bot.stop(signal);
      process.exit(0);
    });
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown fatal error";
  console.error(`Fatal error: ${message}`);
  process.exit(1);
});

