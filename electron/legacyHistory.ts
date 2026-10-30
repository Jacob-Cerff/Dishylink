import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
/** Read-only inventory: legacy files are not compacted, assigned or imported into a new dish. */
export function legacyHistorySummary(directory: string) {
  const files = [
    ["energy", "energy.ndjson"],
    ["energyMonthly", "energy-monthly.ndjson"],
    ["latency", "latency.ndjson"],
    ["events", "events.ndjson"],
    ["alerts", "alerts.ndjson"],
    ["thermal", "thermal.ndjson"],
    ["clients", "clients.ndjson"],
  ] as const;
  const categories = files.flatMap<{
    kind: string;
    records: number | null;
    updatedAt: number | null;
  }>(([kind, name]) => {
    const file = join(directory, name);
    if (!existsSync(file)) return [];
    try {
      return [
        {
          kind,
          records: readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).length,
          updatedAt: statSync(file).mtimeMs,
        },
      ];
    } catch {
      return [{ kind, records: null, updatedAt: null }];
    }
  });
  let pausedRules = 0;
  try {
    const record = JSON.parse(readFileSync(join(directory, "meters.json"), "utf8"));
    pausedRules = Array.isArray(record.rules) ? record.rules.length : 0;
  } catch {
    /* Missing/corrupt history remains untouched. */
  }
  return { source: "legacy-local", assigned: false, categories, pausedRules };
}
