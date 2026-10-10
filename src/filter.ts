import { HHVacancy } from "./types";
import { extractDescription, extractKeySkills, VacancyDetails } from "./vacancyText";

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Keyword must begin a word: "vue" matches "vue3" and "vue.js", but "ios" does not match "axios".
function containsKeyword(text: string, keyword: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(keyword)}`, "u").test(text);
}

export function matchesKeywords(
  vacancy: HHVacancy,
  requiredKeywords: string[],
  excludedKeywords: string[],
  detailedVacancy: VacancyDetails | null = null
): boolean {
  const titleAndSkills = normalize([vacancy.name, ...extractKeySkills(detailedVacancy)].join(" "));
  // A vacancy from the RSS feed has no description, but HH found it by these queries,
  // so their words do occur somewhere in its text.
  const fullText = normalize(
    [titleAndSkills, extractDescription(detailedVacancy), ...(vacancy.matchedQueries ?? [])].join(" ")
  );
  const required = requiredKeywords.map(normalize).filter(Boolean);
  const excluded = excludedKeywords.map(normalize).filter(Boolean);

  // Excluded keywords are checked only against title and skills: a passing mention
  // in the description ("интеграция с 1С") should not drop the vacancy.
  const hasRequired =
    required.length === 0 || required.some((keyword) => containsKeyword(fullText, keyword));
  const hasExcluded = excluded.some((keyword) => containsKeyword(titleAndSkills, keyword));
  return hasRequired && !hasExcluded;
}
