export type HHWorkFormat = "ON_SITE" | "REMOTE" | "HYBRID" | "FIELD_WORK";

export interface AppSettings {
  pollIntervalMinutes: number;
  searchQueries: string[];
  requiredKeywords: string[];
  excludedKeywords: string[];
  hh: {
    source?: "rss" | "api";
    area?: string;
    workFormat?: HHWorkFormat[];
    perPage: number;
    pages: number;
    onlyWithSalary: boolean;
  };
  telegram: {
    messageDelayMs: number;
  };
  sentVacancyHistoryLimit: number;
  ollama?: {
    enabled: boolean;
    model: string;
    profile: string;
  };
}

export interface HHVacancy {
  id: string;
  name: string;
  url?: string;
  detailed_information_url?: string;
  alternate_url: string;
  snippet?: {
    requirement?: string;
    responsibility?: string;
  };
  employer?: {
    name?: string;
  };
  area?: {
    name?: string;
    url?: string;
  };
  salary?: {
    from?: number | null;
    to?: number | null;
    currency?: string;
    gross?: boolean;
  } | null;
  // Salary as a ready-made line; the only form the RSS feed provides.
  salaryText?: string;
  // Search queries whose results contained this vacancy.
  matchedQueries?: string[];
  published_at?: string;
}

