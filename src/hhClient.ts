import axios from "axios";
import { devError, devLog, devWarn } from "./devLogger";
import { AppSettings, HHVacancy } from "./types";

interface HHListResponse {
  items: HHVacancy[];
}

const hhApi = axios.create({
  baseURL: "https://api.hh.ru",
  timeout: 15000,
  headers: {
    "User-Agent": "search-hh-front-notification/1.0"
  }
});

export async function fetchVacanciesByQueries(settings: AppSettings): Promise<HHVacancy[]> {
  const unique = new Map<string, HHVacancy>();

  devLog(`[fetchVacanciesByQueries`, settings);

  for (const query of settings.searchQueries) {
    for (let page = 0; page < settings.hh.pages; page += 1) {
      const params = {
        text: query,
        area: settings.hh.area,
        per_page: settings.hh.perPage,
        page,
        only_with_salary: settings.hh.onlyWithSalary,
        order_by: "publication_time"
      };
      const startedAt = Date.now();


      devLog(`[HH API] -> GET /vacancies`, params);

      let response;
      try {
        response = await hhApi.get<HHListResponse>("/vacancies", { params });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown request error";
        const durationMs = Date.now() - startedAt;
        devWarn(`[HH API] <- ERROR GET /vacancies (${durationMs}ms): ${message}`, params);
        devError(`[HH API] <- ERROR GET /vacancies (${durationMs}ms): ${message}`, params);
        throw error;
      }

      const durationMs = Date.now() - startedAt;
      const itemsCount = response.data.items?.length ?? 0;
      devLog(
        `[HH API] <- ${response.status} GET /vacancies (${durationMs}ms), items=${itemsCount}`
      );

      for (const vacancy of response.data.items ?? []) {
        unique.set(vacancy.id, vacancy);
      }
    }
  }

  return Array.from(unique.values()).sort((a, b) => {
    const left = new Date(a.published_at ?? 0).getTime();
    const right = new Date(b.published_at ?? 0).getTime();
    return right - left;
  });
}

export async function fetchVacancyDetailsByUrl(
  detailedInformationUrl: string
): Promise<Record<string, unknown> | null> {
  const startedAt = Date.now();
  const normalizedUrl = new URL(detailedInformationUrl, "https://api.hh.ru").toString();
  try {
    devLog(`[HH API] -> GET vacancy details`, { url: normalizedUrl });

    const response = await hhApi.get<Record<string, unknown>>(normalizedUrl);
    const durationMs = Date.now() - startedAt;
    devLog(`[HH API] <- ${response.status} GET vacancy details (${durationMs}ms)`, {
      url: normalizedUrl
    });

    return response.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown request error";
    const durationMs = Date.now() - startedAt;
    devWarn(
      `[HH API] <- ERROR GET vacancy details (${durationMs}ms): ${message}`,
      normalizedUrl
    );
    return null;
  }
}

