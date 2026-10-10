export interface AppSettings {
  pollIntervalMinutes: number;
  searchQueries: string[];
  requiredKeywords: string[];
  excludedKeywords: string[];
  hh: {
    area?: string;
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
  published_at?: string;
}

