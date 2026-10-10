import { HHVacancy } from "./types";
import { htmlToText } from "./vacancyText";

// Labels HH puts into the <description> of a feed item, one "<p>label: value</p>" per line.
const employerLabel = "Вакансия компании";
const areaLabel = "Регион";
const salaryLabel = "Предполагаемый уровень месячного дохода";
const salaryNotSpecified = "не указан";

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function readTag(item: string, tag: string): string {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(item);
  if (!match) {
    return "";
  }

  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(match[1]);
  return cdata ? cdata[1] : decodeXmlEntities(match[1]).trim();
}

function readDescriptionFields(descriptionHtml: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const paragraph of descriptionHtml.matchAll(/<p>([\s\S]*?)<\/p>/g)) {
    const text = htmlToText(paragraph[1]);
    const separatorIndex = text.indexOf(":");
    if (separatorIndex > 0) {
      fields.set(text.slice(0, separatorIndex).trim(), text.slice(separatorIndex + 1).trim());
    }
  }
  return fields;
}

/**
 * Parses the RSS feed of an HH vacancy search (https://hh.ru/search/vacancy/rss).
 * The feed carries only the title, link, date, employer, region and salary line.
 */
export function parseVacancyFeed(xml: string): HHVacancy[] {
  const vacancies: HHVacancy[] = [];

  for (const itemMatch of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const item = itemMatch[1];
    const link = readTag(item, "link");
    const id = /\/vacancy\/(\d+)/.exec(link)?.[1];
    const name = readTag(item, "title");
    if (!id || !name) {
      continue;
    }

    const fields = readDescriptionFields(readTag(item, "description"));
    const employerName = fields.get(employerLabel);
    const areaName = fields.get(areaLabel);
    const salaryText = fields.get(salaryLabel);

    vacancies.push({
      id,
      name,
      alternate_url: link,
      employer: employerName ? { name: employerName } : undefined,
      area: areaName ? { name: areaName } : undefined,
      salaryText: salaryText && salaryText !== salaryNotSpecified ? salaryText : undefined,
      published_at: readTag(item, "pubDate") || undefined
    });
  }

  return vacancies;
}
