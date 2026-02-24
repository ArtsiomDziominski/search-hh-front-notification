import { HHVacancy } from "./types";

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function vacancySearchText(vacancy: HHVacancy): string {
  const parts = [
    vacancy.name,
    vacancy.snippet?.requirement ?? "",
    vacancy.snippet?.responsibility ?? "",
    vacancy.employer?.name ?? ""
  ];

  return normalize(parts.join(" "));
}

export function matchesKeywords(
  vacancy: HHVacancy,
  requiredKeywords: string[],
  excludedKeywords: string[]
): boolean {
  const text = vacancySearchText(vacancy);
  const required = requiredKeywords.map(normalize).filter(Boolean);
  const excluded = excludedKeywords.map(normalize).filter(Boolean);

  const hasRequired =
    required.length === 0 || required.some((keyword) => text.includes(keyword));
  const hasExcluded = excluded.some((keyword) => text.includes(keyword));

  return hasRequired && !hasExcluded;
}

