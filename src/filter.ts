import { HHVacancy } from "./types";

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function vacancySearchText(
  vacancy: HHVacancy,
  detailedVacancy: Record<string, unknown> | null = null
): string {
  console.log(detailedVacancy);
  const keySkillsString = Array.isArray(detailedVacancy?.key_skills) ? detailedVacancy?.key_skills?.map((skill: { name: string }) => skill?.name || '').join(" ") : "";
  const parts = [
    vacancy.name,
    keySkillsString
  ];

  return normalize(parts.join(" "));
}

export function matchesKeywords(
  vacancy: HHVacancy,
  requiredKeywords: string[],
  excludedKeywords: string[],
  detailedVacancy: Record<string, unknown> | null = null
): boolean {
  const text = vacancySearchText(vacancy, detailedVacancy);
  const required = requiredKeywords.map(normalize).filter(Boolean);
  const excluded = excludedKeywords.map(normalize).filter(Boolean);

  const hasRequired =
    required.length === 0 || required.some((keyword) => text.includes(keyword));
  const hasExcluded = excluded.some((keyword) => text.includes(keyword));
  return hasRequired && !hasExcluded;
}

