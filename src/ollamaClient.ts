import { createHash } from "node:crypto";
import axios from "axios";
import { AppSettings, HHVacancy } from "./types";
import {
  extractDescription,
  extractKeySkills,
  extractName,
  extractNames,
  htmlToText,
  VacancyDetails
} from "./vacancyText";

export type OllamaSettings = NonNullable<AppSettings["ollama"]>;

export interface RelevanceVerdict {
  relevant: boolean;
  reason: string;
}

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
}

const defaultOllamaBaseUrl = "http://127.0.0.1:11434";
const defaultRequestTimeoutMs = 120000;
const maxDescriptionLength = 3000;

const systemPrompt = [
  "Ты отбираешь вакансии для соискателя. Тебе дан профиль соискателя и вакансия с hh.ru. Заполни JSON по шагам:",
  "wanted_role — какую роль ищет соискатель (из профиля);",
  "wanted_stack — какой основной стек ищет соискатель (из профиля);",
  "role — основная роль вакансии по её названию и обязанностям (например: frontend-разработчик, backend-разработчик, fullstack-разработчик, тимлид, менеджер);",
  "main_stack — технологии вакансии, на которых предстоит работать большую часть времени; технологии из разделов «будет плюсом» и единичные упоминания сюда не входят;",
  "role_fits — true, только если role совпадает с wanted_role;",
  "stack_fits — true, только если main_stack содержит технологии из wanted_stack;",
  "excluded — true, если вакансия относится к тому, что в профиле названо неподходящим;",
  "reason — одно короткое предложение на русском с итогом."
].join("\n");

// A small model answers several narrow questions more reliably than one "is it relevant?",
// so the verdict is derived from the three flags in code. Field order matters: the model
// writes down what is wanted and what the vacancy offers before comparing them.
const answerSchema = {
  type: "object",
  properties: {
    wanted_role: { type: "string" },
    wanted_stack: { type: "string" },
    role: { type: "string" },
    main_stack: { type: "string" },
    role_fits: { type: "boolean" },
    stack_fits: { type: "boolean" },
    excluded: { type: "boolean" },
    reason: { type: "string" }
  },
  required: [
    "wanted_role",
    "wanted_stack",
    "role",
    "main_stack",
    "role_fits",
    "stack_fits",
    "excluded",
    "reason"
  ]
};

// Verdicts are cached per vacancy; a new model or profile must invalidate them.
export function relevanceFingerprint(ollama: OllamaSettings): string {
  return createHash("sha256").update(`${ollama.model}\n${ollama.profile}`).digest("hex").slice(0, 16);
}

function describeVacancy(vacancy: HHVacancy, details: VacancyDetails | null): string {
  const snippet = [vacancy.snippet?.requirement, vacancy.snippet?.responsibility]
    .filter((part): part is string => Boolean(part))
    .map(htmlToText)
    .join(" ");
  const description = (extractDescription(details) || snippet).slice(0, maxDescriptionLength);
  const salary = vacancy.salary
    ? `${vacancy.salary.from ?? "—"} - ${vacancy.salary.to ?? "—"} ${vacancy.salary.currency ?? ""}`.trim()
    : vacancy.salaryText ?? "";

  const fields: Array<[string, string]> = [
    ["Название", vacancy.name],
    ["Компания", vacancy.employer?.name ?? ""],
    ["Локация", vacancy.area?.name ?? ""],
    ["Профессиональная роль", extractNames(details, "professional_roles").join(", ")],
    ["Опыт", extractName(details, "experience")],
    ["Занятость", extractName(details, "employment")],
    ["Формат работы", extractNames(details, "work_format").join(", ")],
    ["Зарплата", salary],
    ["Ключевые навыки", extractKeySkills(details).join(", ")],
    ["Описание", description],
    ["Найдена поиском HH по запросам", (vacancy.matchedQueries ?? []).join(", ")]
  ];

  return fields
    .filter(([, value]) => value.length > 0)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

function parseVerdict(content: string): RelevanceVerdict | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const { role_fits: roleFits, stack_fits: stackFits, excluded } = parsed;
    if (
      typeof roleFits !== "boolean" ||
      typeof stackFits !== "boolean" ||
      typeof excluded !== "boolean"
    ) {
      return null;
    }

    return {
      relevant: roleFits && stackFits && !excluded,
      reason: [
        `роль: ${String(parsed.role ?? "?")} (${roleFits ? "подходит" : "не подходит"})`,
        `стек: ${String(parsed.main_stack ?? "?")} (${stackFits ? "подходит" : "не подходит"})`,
        `в исключениях: ${excluded ? "да" : "нет"}`,
        String(parsed.reason ?? "")
      ].join("; ")
    };
  } catch {
    return null;
  }
}

function describeRequestError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const ollamaError = (error.response?.data as { error?: unknown } | undefined)?.error;
    if (typeof ollamaError === "string") {
      return ollamaError;
    }
    return error.message || error.code || "Unknown request error";
  }

  return error instanceof Error ? error.message : "Unknown request error";
}

/**
 * Asks the model whether the vacancy fits the profile.
 * Returns null when the model answered with something unparseable;
 * throws when Ollama itself is unreachable or rejected the request.
 */
export async function checkVacancyRelevance(
  vacancy: HHVacancy,
  details: VacancyDetails | null,
  ollama: OllamaSettings
): Promise<RelevanceVerdict | null> {
  const baseUrl = process.env.OLLAMA_BASE_URL || defaultOllamaBaseUrl;
  const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS) || defaultRequestTimeoutMs;

  let response;
  try {
    response = await axios.post<OllamaChatResponse>(
      new URL("/api/chat", baseUrl).toString(),
      {
        model: ollama.model,
        stream: false,
        format: answerSchema,
        options: { temperature: 0, num_ctx: 4096 },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Профиль соискателя:\n${ollama.profile}\n\nВакансия:\n${describeVacancy(vacancy, details)}`
          }
        ]
      },
      { timeout: timeoutMs }
    );
  } catch (error) {
    throw new Error(
      `Ollama request failed (${baseUrl}, model ${ollama.model}): ${describeRequestError(error)}`
    );
  }

  return parseVerdict(response.data.message?.content ?? "");
}
