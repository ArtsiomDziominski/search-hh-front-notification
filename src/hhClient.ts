import axios from "axios";
import { isDevelopment } from "./constants";
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

  console.log(`[fetchVacanciesByQueries`, settings);

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


      if (isDevelopment) console.log(`[HH API] -> GET /vacancies`, params);

      let response;
      try {
        response = await hhApi.get<HHListResponse>("/vacancies", { params });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown request error";
        const durationMs = Date.now() - startedAt;
        console.log(`[HH API] <- ERROR GET /vacancies (${durationMs}ms): ${message}`, params);

        if (isDevelopment) {
          console.error(`[HH API] <- ERROR GET /vacancies (${durationMs}ms): ${message}`, params);
        }
        throw error;
      }

      if (isDevelopment) {
        const durationMs = Date.now() - startedAt;
        const itemsCount = response.data.items?.length ?? 0;
        console.log(
          `[HH API] <- ${response.status} GET /vacancies (${durationMs}ms), items=${itemsCount}`
        );
      }

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
    if (isDevelopment) {
      console.log(`[HH API] -> GET vacancy details`, { url: normalizedUrl });
    }

    const response = await hhApi.get<Record<string, unknown>>(normalizedUrl);
    if (isDevelopment) {
      const durationMs = Date.now() - startedAt;
      console.log(`[HH API] <- ${response.status} GET vacancy details (${durationMs}ms)`, {
        url: normalizedUrl
      });
    }

    return response.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown request error";
    const durationMs = Date.now() - startedAt;
    console.warn(
      `[HH API] <- ERROR GET vacancy details (${durationMs}ms): ${message}`,
      normalizedUrl
    );
    return null;
  }
}

