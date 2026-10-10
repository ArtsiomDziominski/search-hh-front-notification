import axios from "axios";
import { devError, devLog, devWarn } from "./devLogger";
import { parseVacancyFeed } from "./hhRss";
import { AppSettings, HHVacancy } from "./types";

interface HHListResponse {
  items: HHVacancy[];
}

const userAgent = "search-hh-front-notification/1.0";

const hhApi = axios.create({
  baseURL: "https://api.hh.ru",
  timeout: 15000,
  headers: {
    "User-Agent": userAgent
  }
});

const hhSite = axios.create({
  baseURL: "https://hh.ru",
  timeout: 15000,
  headers: {
    "User-Agent": userAgent
  }
});

function sortByPublicationDate(vacancies: HHVacancy[]): HHVacancy[] {
  return vacancies.sort((a, b) => {
    const left = new Date(a.published_at ?? 0).getTime();
    const right = new Date(b.published_at ?? 0).getTime();
    return right - left;
  });
}

async function fetchVacanciesFromApi(settings: AppSettings): Promise<HHVacancy[]> {
  const unique = new Map<string, HHVacancy>();

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

  return sortByPublicationDate(Array.from(unique.values()));
}

// The feed returns the 20 most recent vacancies per query and ignores paging.
async function fetchVacanciesFromRss(settings: AppSettings): Promise<HHVacancy[]> {
  const unique = new Map<string, HHVacancy>();
  let lastError: unknown = null;
  let failedQueries = 0;

  for (const query of settings.searchQueries) {
    const params = {
      text: query,
      area: settings.hh.area,
      only_with_salary: settings.hh.onlyWithSalary ? true : undefined,
      order_by: "publication_time"
    };
    const startedAt = Date.now();

    let items: HHVacancy[];
    try {
      const response = await hhSite.get<string>("/search/vacancy/rss", {
        params,
        responseType: "text"
      });
      // A block or challenge page comes back as HTML with status 200; do not take it for an empty feed.
      if (!response.data.includes("<rss")) {
        throw new Error("the answer is not an RSS feed");
      }
      items = parseVacancyFeed(response.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown request error";
      console.error(`[HH RSS] query "${query}" failed: ${message}`);
      lastError = error;
      failedQueries += 1;
      continue;
    }

    devLog(`[HH RSS] "${query}": items=${items.length} (${Date.now() - startedAt}ms)`);
    for (const vacancy of items) {
      const known = unique.get(vacancy.id) ?? vacancy;
      known.matchedQueries = [...(known.matchedQueries ?? []), query];
      unique.set(vacancy.id, known);
    }
  }

  // A query that failed once is retried next cycle; with every query failing there is nothing to work with.
  if (failedQueries === settings.searchQueries.length) {
    throw lastError;
  }

  return sortByPublicationDate(Array.from(unique.values()));
}

export async function fetchVacanciesByQueries(settings: AppSettings): Promise<HHVacancy[]> {
  devLog(`[fetchVacanciesByQueries`, settings);

  // HH answers 403 to anonymous API requests, so the RSS feed is the default source.
  return settings.hh.source === "api"
    ? fetchVacanciesFromApi(settings)
    : fetchVacanciesFromRss(settings);
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

