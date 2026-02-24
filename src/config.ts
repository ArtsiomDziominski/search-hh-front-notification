import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import Ajv, { ErrorObject, ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { AppSettings } from "./types";

const settingsPath = path.resolve(process.cwd(), "config/settings.json");
const schemaPath = path.resolve(process.cwd(), "config/settings.schema.json");

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

let validateSettings: ValidateFunction | null = null;

async function getValidator(): Promise<ValidateFunction> {
  if (validateSettings) {
    return validateSettings;
  }

  const schemaRaw = await readFile(schemaPath, "utf-8");
  const schema = JSON.parse(schemaRaw);
  validateSettings = ajv.compile(schema);
  return validateSettings;
}

function formatValidationErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors || errors.length === 0) {
    return ["Unknown validation error"];
  }

  return errors.map((error) => {
    const field = error.instancePath ? error.instancePath : "/";
    return `${field}: ${error.message ?? "invalid value"}`;
  });
}

export async function loadSettings(): Promise<AppSettings> {
  const raw = await readFile(settingsPath, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  const validator = await getValidator();

  if (!validator(parsed)) {
    const errors = formatValidationErrors(validator.errors);
    throw new Error(`Settings JSON is invalid:\n${errors.join("\n")}`);
  }

  return parsed as AppSettings;
}

export async function importSettingsFromRaw(raw: string): Promise<{
  ok: true;
  settings: AppSettings;
} | {
  ok: false;
  errors: string[];
}> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error";
    return { ok: false, errors: [`JSON parse error: ${message}`] };
  }

  const validator = await getValidator();
  if (!validator(parsed)) {
    return { ok: false, errors: formatValidationErrors(validator.errors) };
  }

  const settings = parsed as AppSettings;
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");

  return { ok: true, settings };
}

