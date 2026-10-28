/** Stage 0 opt-in diagnostics: schemas only, never scalar values or request data. */
export interface CapabilityReport {
  source: "telemetry" | "service-detail";
  status: number;
  schema: unknown;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function safeName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value) &&
    !/^[a-f0-9]{16,}$/i.test(value)
  );
}
function type(value: unknown): string {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}
function telemetrySchema(value: unknown): unknown {
  const data = record(record(value)?.data);
  const legends = record(data?.columnNamesByDeviceType);
  const rows = Array.isArray(data?.values) ? data.values.filter(Array.isArray) : [];
  return {
    devices: ["u", "r"].flatMap((kind) => {
      const legend = legends?.[kind];
      if (!Array.isArray(legend)) return [];
      const matching = rows.filter((row) => row[0] === kind);
      return [
        {
          kind: kind === "u" ? "dish" : "router",
          rows: matching.length,
          columns: legend.slice(0, 512).flatMap((name, index) =>
            safeName(name)
              ? [
                  {
                    name,
                    types: [...new Set(matching.map((row) => type(row[index])))].sort(),
                    ...(name === "ActiveAlerts"
                      ? alertSchema(matching.map((row) => row[index]))
                      : {}),
                  },
                ]
              : [],
          ),
        },
      ];
    }),
  };
}
function serviceSchema(value: unknown) {
  const fields = new Map<string, Set<string>>();
  let visited = 0;
  function visit(value: unknown, path: string, depth: number): void {
    if (++visited > 10_000 || depth > 10) return;
    if (path) {
      if (!fields.has(path)) fields.set(path, new Set());
      fields.get(path)!.add(type(value));
    }
    if (Array.isArray(value)) {
      for (const child of value.slice(0, 100)) visit(child, `${path}[]`, depth + 1);
    } else {
      const object = record(value);
      if (object)
        for (const [key, child] of Object.entries(object).slice(0, 512)) {
          if (safeName(key)) visit(child, path ? `${path}.${key}` : key, depth + 1);
        }
    }
  }
  visit(value, "", 0);
  return {
    fields: [...fields].map(([path, types]) => ({ path, types: [...types].sort() })),
    truncated: visited > 10_000,
  };
}

function alertSchema(values: unknown[]) {
  const arrays = values.filter(Array.isArray);
  const items = arrays.flat().slice(0, 512);
  return {
    nonEmptyRows: arrays.filter((array) => array.length > 0).length,
    itemTypes: [...new Set(items.map(type))].sort(),
    itemFields: serviceSchema(items).fields,
  };
}

/** Observes only existing successful reads; makes no additional network calls. */
export function auditCloudReads(
  fetcher: typeof fetch,
  report: (value: CapabilityReport) => void,
): typeof fetch {
  return (async (input, init) => {
    const response = await fetcher(input, init);
    try {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      if (url.origin !== "https://starlink.com" || !response.ok) return response;
      const source =
        method === "POST" && url.pathname === "/api/device-data/cache/v1/telemetry"
          ? "telemetry"
          : method === "GET" &&
              /^\/api\/webagg\/v2\/accounts\/service-line\/[^/]+$/.test(url.pathname)
            ? "service-detail"
            : null;
      if (source) {
        const value: unknown = await response.clone().json();
        report({
          source,
          status: response.status,
          schema: source === "telemetry" ? telemetrySchema(value) : serviceSchema(value),
        });
      }
    } catch {
      // Diagnostics cannot fail a read or log exceptions containing request data.
    }
    return response;
  }) as typeof fetch;
}
