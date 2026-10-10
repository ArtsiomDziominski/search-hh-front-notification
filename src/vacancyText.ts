export type VacancyDetails = Record<string, unknown>;

export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function nameOf(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const maybeName = (value as { name?: unknown }).name;
  return typeof maybeName === "string" && maybeName.length > 0 ? maybeName : null;
}

export function extractName(details: VacancyDetails | null, field: string): string {
  return nameOf(details?.[field]) ?? "";
}

export function extractNames(details: VacancyDetails | null, field: string): string[] {
  const rawItems = details?.[field];
  if (!Array.isArray(rawItems)) {
    return [];
  }

  return rawItems.map(nameOf).filter((name): name is string => name !== null);
}

export function extractKeySkills(details: VacancyDetails | null): string[] {
  return extractNames(details, "key_skills");
}

export function extractDescription(details: VacancyDetails | null): string {
  const rawDescription = details?.description;
  return typeof rawDescription === "string" ? htmlToText(rawDescription) : "";
}
