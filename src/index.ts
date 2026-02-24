import dotenv from "dotenv";
import { loadSettings, importSettingsFromRaw } from "./config";
import { matchesKeywords } from "./filter";
import { fetchVacanciesByQueries, fetchVacancyDetailsByUrl } from "./hhClient";
import {
  addVacancyDetailRecords,
  addSentVacancyRecords,
  getVacancyKeySkillsByIds,
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

function formatVacancyMessage(vacancy: HHVacancy, keySkills: string[] = []): string {
  const company = vacancy.employer?.name ?? "Компания не указана";
  const area = vacancy.area?.name ?? "Локация не указана";
  const requirement = vacancy.snippet?.requirement ?? "";
  const responsibility = vacancy.snippet?.responsibility ?? "";
  const publishedAt = vacancy.published_at ?? "";

  const detailsBlock = [
    `Название: <b>${vacancy.name}</b>`,
    `Компания: ${company}`,
    `Локация: ${area}`,
    `Зарплата: <b>${formatSalary(vacancy)}</b>`
  ].join("\n");

  const contentBlocks = [
    requirement ? `Требования:\n${requirement}` : "",
    responsibility ? `Задачи:\n${responsibility}` : "",
    keySkills.length > 0 ? `Ключевые навыки:\n<b>${keySkills.join(", ")}</b>` : ""
  ].filter(Boolean);

  return [
    "<b>Новая вакансия:</b>",
    "",
    detailsBlock,
    ...(contentBlocks.length > 0 ? ["", ...contentBlocks] : []),
    ...(publishedAt ? ["", `Опубликовано: ${publishedAt}`] : []),
    "",
    `Подробная информация: ${vacancy.alternate_url}`
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
  console.log(`[runPollingCycle] started at ${new Date(startedAt).toISOString()}`);
  const settings = await loadSettings();
  console.log(
    `[runPollingCycle] settings loaded: queries=${settings.searchQueries.length}, pages=${settings.hh.pages}, perPage=${settings.hh.perPage}`
  );
  const allVacancies = await fetchVacanciesByQueries(settings);
  console.log(`[runPollingCycle] fetched vacancies: total=${allVacancies.length}`);
  const filteredVacancies = allVacancies.filter((vacancy) =>
    matchesKeywords(vacancy, settings.requiredKeywords, settings.excludedKeywords)
  );
  console.log(
    `[runPollingCycle] filtered vacancies: matched=${filteredVacancies.length}, requiredKeywords=${settings.requiredKeywords.length}, excludedKeywords=${settings.excludedKeywords.length}`
  );

  const sentIds = await getSentVacancyIds();
  const newVacancies = filteredVacancies.filter((vacancy) => !sentIds.has(vacancy.id));
  console.log(
    `[runPollingCycle] deduplicated vacancies: alreadySent=${sentIds.size}, new=${newVacancies.length}`
  );
  if (newVacancies.length === 0) {
    console.log("No new vacancies found.");
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
        console.warn(
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
    console.log(
      `[runPollingCycle] vacancy details stored: requested=${vacanciesWithoutDetails.length}, saved=${detailRecords.length}`
    );
  }

  const subscribers = await getSubscribers();
  console.log(`[runPollingCycle] subscribers loaded: count=${subscribers.length}`);
  if (subscribers.length === 0) {
    console.log("No subscribers, skipping notifications.");
    return;
  }

  const keySkillsByVacancyId = await getVacancyKeySkillsByIds(newVacancies.map((vacancy) => vacancy.id));

  for (const [index, vacancy] of newVacancies.entries()) {
    console.log(
      `[runPollingCycle] sending ${index + 1}/${newVacancies.length}: id=${vacancy.id}, title="${vacancy.name}"`
    );
    const message = formatVacancyMessage(vacancy, keySkillsByVacancyId.get(vacancy.id) ?? []);
    await bot.sendToSubscribers(subscribers, message, settings.telegram.messageDelayMs);
  }

  await addSentVacancyRecords(newVacancies, settings.sentVacancyHistoryLimit);
  const elapsedMs = Date.now() - startedAt;
  console.log(
    `Sent ${newVacancies.length} new vacancies to ${subscribers.length} subscribers (cycle=${elapsedMs}ms).`
  );
}

async function main(): Promise<void> {
  console.log("Application startup: begin.");
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing. Add it to your environment.");
  }

  await initializeStateStore();
  console.log("State store initialized.");
  const startupSettings = await loadSettings();
  console.log(
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

  console.log("Starting Telegram bot...");
  void bot.start()
    .then(() => {
      console.log("Telegram bot started.");
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : "Unknown bot startup error";
      console.error(`Telegram bot startup failed: ${message}`);
    });

  let isCycleRunning = false;
  const runCycleSafely = async (): Promise<void> => {
    if (isCycleRunning) {
      console.log("Previous cycle is still running, skip current tick.");
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
  console.log(`Polling interval configured: ${intervalMs}ms.`);
  setInterval(() => {
    void runCycleSafely();
  }, intervalMs);

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      console.log(`Received ${signal}, stopping bot...`);
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

