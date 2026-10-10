import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { HHVacancy } from "./types";

const dataDir = path.resolve(process.cwd(), "data");
const subscribersPath = path.resolve(dataDir, "subscribers.json");
const sentVacanciesDbPath = path.resolve(dataDir, "app.db");
let sentVacanciesDb: Database.Database | null = null;

export interface VacancyDetailRecord {
  vacancyId: string;
  detailedInformationUrl: string;
  payload: Record<string, unknown>;
  keySkills: string[];
}

async function ensureFile(filePath: string, fallbackValue: string): Promise<void> {
  try {
    await readFile(filePath, "utf-8");
  } catch {
    await writeFile(filePath, fallbackValue, "utf-8");
  }
}

async function readJsonArray<T>(filePath: string): Promise<T[]> {
  const raw = await readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid state format in ${filePath}. Expected array.`);
  }
  return parsed as T[];
}

function getSentVacanciesDb(): Database.Database {
  if (sentVacanciesDb === null) {
    sentVacanciesDb = new Database(sentVacanciesDbPath);
  }

  return sentVacanciesDb;
}

function initializeSentVacanciesTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sent_vacancies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      detailed_information_url TEXT,
      alternate_url TEXT NOT NULL,
      published_at TEXT,
      payload_json TEXT,
      sent_at INTEGER NOT NULL,
      sent_at_iso TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sent_vacancies_sent_at
      ON sent_vacancies(sent_at);
  `);

  const tableInfo = db
    .prepare("PRAGMA table_info(sent_vacancies)")
    .all() as Array<{ name: string }>;
  const hasSentAtIso = tableInfo.some((column) => column.name === "sent_at_iso");
  if (!hasSentAtIso) {
    db.exec("ALTER TABLE sent_vacancies ADD COLUMN sent_at_iso TEXT;");
  }
  const hasDetailedInformationUrl = tableInfo.some(
    (column) => column.name === "detailed_information_url"
  );
  if (!hasDetailedInformationUrl) {
    db.exec("ALTER TABLE sent_vacancies ADD COLUMN detailed_information_url TEXT;");
  }
  const hasUrl = tableInfo.some((column) => column.name === "url");
  if (hasUrl) {
    db.exec(`
      BEGIN;
      CREATE TABLE sent_vacancies_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        detailed_information_url TEXT,
        alternate_url TEXT NOT NULL,
        published_at TEXT,
        payload_json TEXT,
        sent_at INTEGER NOT NULL,
        sent_at_iso TEXT
      );
      INSERT INTO sent_vacancies_new (
        id,
        name,
        detailed_information_url,
        alternate_url,
        published_at,
        payload_json,
        sent_at,
        sent_at_iso
      )
      SELECT
        id,
        name,
        COALESCE(detailed_information_url, url),
        alternate_url,
        published_at,
        payload_json,
        sent_at,
        sent_at_iso
      FROM sent_vacancies;
      DROP TABLE sent_vacancies;
      ALTER TABLE sent_vacancies_new RENAME TO sent_vacancies;
      COMMIT;
    `);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sent_vacancies_sent_at
      ON sent_vacancies(sent_at);
  `);
}

function initializeVacancyDetailsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vacancy_details (
      vacancy_id TEXT PRIMARY KEY,
      detailed_information_url TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      key_skills TEXT NOT NULL DEFAULT '[]',
      inserted_at INTEGER NOT NULL,
      inserted_at_iso TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_vacancy_details_inserted_at
      ON vacancy_details(inserted_at);
  `);

  const tableInfo = db
    .prepare("PRAGMA table_info(vacancy_details)")
    .all() as Array<{ name: string }>;
  const hasInsertedAt = tableInfo.some((column) => column.name === "inserted_at");
  if (!hasInsertedAt) {
    db.exec("ALTER TABLE vacancy_details ADD COLUMN inserted_at INTEGER;");
  }

  const hasInsertedAtIso = tableInfo.some((column) => column.name === "inserted_at_iso");
  if (!hasInsertedAtIso) {
    db.exec("ALTER TABLE vacancy_details ADD COLUMN inserted_at_iso TEXT;");
  }
  const hasKeySkills = tableInfo.some((column) => column.name === "key_skills");
  if (!hasKeySkills) {
    db.exec("ALTER TABLE vacancy_details ADD COLUMN key_skills TEXT NOT NULL DEFAULT '[]';");
  }

  db.exec(`
    UPDATE vacancy_details
    SET inserted_at = COALESCE(inserted_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
  `);
  db.exec(`
    UPDATE vacancy_details
    SET inserted_at_iso = COALESCE(
      inserted_at_iso,
      strftime('%Y-%m-%dT%H:%M:%fZ', inserted_at / 1000.0, 'unixepoch')
    );
  `);
  db.exec(`
    UPDATE vacancy_details
    SET key_skills = COALESCE(key_skills, '[]');
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_vacancy_details_inserted_at
      ON vacancy_details(inserted_at);
  `);
}

function initializeVacancyRelevanceTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vacancy_relevance (
      vacancy_id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      relevant INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      checked_at INTEGER NOT NULL,
      checked_at_iso TEXT
    );
  `);
}

export async function initializeStateStore(): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await ensureFile(subscribersPath, "[]\n");
  const db = getSentVacanciesDb();
  initializeSentVacanciesTable(db);
  initializeVacancyDetailsTable(db);
  initializeVacancyRelevanceTable(db);
}

export async function getSubscribers(): Promise<number[]> {
  const values = await readJsonArray<number>(subscribersPath);
  return values.filter((id) => Number.isInteger(id));
}

export async function addSubscriber(chatId: number): Promise<boolean> {
  const subscribers = await getSubscribers();
  if (subscribers.includes(chatId)) {
    return false;
  }

  subscribers.push(chatId);
  await writeFile(subscribersPath, `${JSON.stringify(subscribers, null, 2)}\n`, "utf-8");
  return true;
}

export async function removeSubscriber(chatId: number): Promise<boolean> {
  const subscribers = await getSubscribers();
  const nextSubscribers = subscribers.filter((id) => id !== chatId);
  if (nextSubscribers.length === subscribers.length) {
    return false;
  }

  await writeFile(subscribersPath, `${JSON.stringify(nextSubscribers, null, 2)}\n`, "utf-8");
  return true;
}

function isStoredHHVacancy(value: unknown): value is HHVacancy {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as { id?: unknown; name?: unknown; alternate_url?: unknown };
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.alternate_url === "string"
  );
}

function toStoredVacancy(
  row: {
    id: string;
    name: string;
    detailed_information_url: string | null;
    alternate_url: string;
    published_at: string | null;
    payload_json: string | null;
  }
): HHVacancy {
  if (row.payload_json) {
    try {
      const parsed = JSON.parse(row.payload_json) as unknown;
      if (isStoredHHVacancy(parsed)) {
        return parsed;
      }
    } catch {
      // Fallback to required fields if payload is malformed.
    }
  }

  return {
    id: row.id,
    name: row.name,
    detailed_information_url: row.detailed_information_url ?? undefined,
    alternate_url: row.alternate_url,
    published_at: row.published_at ?? undefined
  };
}

export async function getSentVacancyRecords(): Promise<HHVacancy[]> {
  const db = getSentVacanciesDb();
  const rows = db
    .prepare(
      `
      SELECT id, name, detailed_information_url, alternate_url, published_at, payload_json
      FROM sent_vacancies
      ORDER BY sent_at ASC, id ASC
      `
    )
    .all() as Array<{
    id: string;
    name: string;
    detailed_information_url: string | null;
    alternate_url: string;
    published_at: string | null;
    payload_json: string | null;
  }>;

  return rows.map((row) => toStoredVacancy(row));
}

export async function getSentVacancyIds(): Promise<Set<string>> {
  const db = getSentVacanciesDb();
  const rows = db.prepare("SELECT id FROM sent_vacancies").all() as Array<{ id: string }>;
  return new Set(rows.map((record) => record.id));
}

export async function addSentVacancyRecords(records: HHVacancy[], limit: number): Promise<void> {
  const db = getSentVacanciesDb();
  const normalizedLimit = Math.max(100, limit);
  const upsert = db.prepare(
    `
    INSERT INTO sent_vacancies (id, name, detailed_information_url, alternate_url, published_at, payload_json, sent_at, sent_at_iso)
    VALUES (@id, @name, @detailed_information_url, @alternate_url, @published_at, @payload_json, @sent_at, @sent_at_iso)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      detailed_information_url = excluded.detailed_information_url,
      alternate_url = excluded.alternate_url,
      published_at = excluded.published_at,
      payload_json = excluded.payload_json,
      sent_at = COALESCE(sent_vacancies.sent_at, excluded.sent_at),
      sent_at_iso = COALESCE(sent_vacancies.sent_at_iso, excluded.sent_at_iso)
    `
  );

  const upsertAll = db.transaction((items: HHVacancy[]) => {
    for (const record of items) {
      const sentAt = Date.now();
      const detailedInformationUrl =
        typeof record.url === "string" && record.url.length > 0
          ? record.url
          : record.detailed_information_url;
      const { url: _rawUrl, ...recordWithoutUrl } = record;
      upsert.run({
        id: record.id,
        name: record.name,
        detailed_information_url: detailedInformationUrl ?? null,
        alternate_url: record.alternate_url,
        published_at: record.published_at ?? null,
        payload_json: JSON.stringify({
          ...recordWithoutUrl,
          detailed_information_url: detailedInformationUrl ?? record.detailed_information_url
        }),
        sent_at: sentAt,
        sent_at_iso: new Date(sentAt).toISOString()
      });
    }
  });

  upsertAll(records);

  const countRow = db.prepare("SELECT COUNT(*) as count FROM sent_vacancies").get() as { count: number };
  const overflow = countRow.count - normalizedLimit;
  if (overflow > 0) {
    db.prepare(
      `
      DELETE FROM sent_vacancies
      WHERE id IN (
        SELECT id
        FROM sent_vacancies
        ORDER BY sent_at ASC, id ASC
        LIMIT ?
      )
      `
    ).run(overflow);
  }
}

export async function getVacancyIdsWithoutDetails(vacancyIds: string[]): Promise<string[]> {
  if (vacancyIds.length === 0) {
    return [];
  }

  const db = getSentVacanciesDb();
  const placeholders = vacancyIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `
      SELECT vacancy_id
      FROM vacancy_details
      WHERE vacancy_id IN (${placeholders})
      `
    )
    .all(...vacancyIds) as Array<{ vacancy_id: string }>;

  const existingIds = new Set(rows.map((row) => row.vacancy_id));
  return vacancyIds.filter((id) => !existingIds.has(id));
}

export async function getVacancyKeySkillsByIds(vacancyIds: string[]): Promise<Map<string, string[]>> {
  if (vacancyIds.length === 0) {
    return new Map<string, string[]>();
  }

  const db = getSentVacanciesDb();
  const placeholders = vacancyIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `
      SELECT vacancy_id, key_skills
      FROM vacancy_details
      WHERE vacancy_id IN (${placeholders})
      `
    )
    .all(...vacancyIds) as Array<{ vacancy_id: string; key_skills: string }>;

  const keySkillsByVacancyId = new Map<string, string[]>();
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.key_skills) as unknown;
      if (!Array.isArray(parsed)) {
        keySkillsByVacancyId.set(row.vacancy_id, []);
        continue;
      }

      keySkillsByVacancyId.set(
        row.vacancy_id,
        parsed.filter((skill): skill is string => typeof skill === "string" && skill.length > 0)
      );
    } catch {
      keySkillsByVacancyId.set(row.vacancy_id, []);
    }
  }

  return keySkillsByVacancyId;
}

export async function getVacancyDetailsPayloadByIds(
  vacancyIds: string[]
): Promise<Map<string, Record<string, unknown>>> {
  if (vacancyIds.length === 0) {
    return new Map<string, Record<string, unknown>>();
  }

  const db = getSentVacanciesDb();
  const placeholders = vacancyIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `
      SELECT vacancy_id, payload_json
      FROM vacancy_details
      WHERE vacancy_id IN (${placeholders})
      `
    )
    .all(...vacancyIds) as Array<{ vacancy_id: string; payload_json: string }>;

  const payloadByVacancyId = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.payload_json) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        continue;
      }
      payloadByVacancyId.set(row.vacancy_id, parsed as Record<string, unknown>);
    } catch {
      // Skip malformed payloads and continue with available records.
    }
  }

  return payloadByVacancyId;
}

export async function addVacancyDetailRecords(records: VacancyDetailRecord[]): Promise<void> {
  if (records.length === 0) {
    return;
  }

  const db = getSentVacanciesDb();
  const upsert = db.prepare(
    `
    INSERT INTO vacancy_details (
      vacancy_id,
      detailed_information_url,
      payload_json,
      key_skills,
      inserted_at,
      inserted_at_iso
    )
    VALUES (
      @vacancy_id,
      @detailed_information_url,
      @payload_json,
      @key_skills,
      @inserted_at,
      @inserted_at_iso
    )
    ON CONFLICT(vacancy_id) DO UPDATE SET
      detailed_information_url = excluded.detailed_information_url,
      payload_json = excluded.payload_json,
      key_skills = excluded.key_skills,
      inserted_at = COALESCE(vacancy_details.inserted_at, excluded.inserted_at),
      inserted_at_iso = COALESCE(vacancy_details.inserted_at_iso, excluded.inserted_at_iso)
    `
  );

  const upsertAll = db.transaction((items: VacancyDetailRecord[]) => {
    for (const record of items) {
      const insertedAt = Date.now();
      upsert.run({
        vacancy_id: record.vacancyId,
        detailed_information_url: record.detailedInformationUrl,
        payload_json: JSON.stringify(record.payload),
        key_skills: JSON.stringify(record.keySkills),
        inserted_at: insertedAt,
        inserted_at_iso: new Date(insertedAt).toISOString()
      });
    }
  });

  upsertAll(records);
}

export async function getVacancyRelevanceByIds(
  vacancyIds: string[],
  fingerprint: string
): Promise<Map<string, boolean>> {
  if (vacancyIds.length === 0) {
    return new Map<string, boolean>();
  }

  const db = getSentVacanciesDb();
  const placeholders = vacancyIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `
      SELECT vacancy_id, relevant
      FROM vacancy_relevance
      WHERE fingerprint = ? AND vacancy_id IN (${placeholders})
      `
    )
    .all(fingerprint, ...vacancyIds) as Array<{ vacancy_id: string; relevant: number }>;

  return new Map(rows.map((row) => [row.vacancy_id, row.relevant === 1]));
}

export async function saveVacancyRelevance(
  vacancyId: string,
  fingerprint: string,
  relevant: boolean,
  reason: string
): Promise<void> {
  const db = getSentVacanciesDb();
  const checkedAt = Date.now();
  db.prepare(
    `
    INSERT INTO vacancy_relevance (vacancy_id, fingerprint, relevant, reason, checked_at, checked_at_iso)
    VALUES (@vacancy_id, @fingerprint, @relevant, @reason, @checked_at, @checked_at_iso)
    ON CONFLICT(vacancy_id) DO UPDATE SET
      fingerprint = excluded.fingerprint,
      relevant = excluded.relevant,
      reason = excluded.reason,
      checked_at = excluded.checked_at,
      checked_at_iso = excluded.checked_at_iso
    `
  ).run({
    vacancy_id: vacancyId,
    fingerprint,
    relevant: relevant ? 1 : 0,
    reason,
    checked_at: checkedAt,
    checked_at_iso: new Date(checkedAt).toISOString()
  });
}

export async function clearSentVacancyRecords(): Promise<number> {
  const db = getSentVacanciesDb();
  const clearAll = db.transaction(() => {
    const sentResult = db.prepare("DELETE FROM sent_vacancies").run();
    const detailsResult = db.prepare("DELETE FROM vacancy_details").run();
    db.prepare("DELETE FROM vacancy_relevance").run();
    return sentResult.changes + detailsResult.changes;
  });

  return clearAll();
}

