export function exportToCsv<T extends object>(data: T[], filename: string, columns?: { key: string; label: string }[]) {
  if (!data.length) return;
  if (columns) {
    const header = columns.map((c) => c.label).join(",");
    const rows = data.map((row) =>
      columns.map((c) => {
        const val = getNestedValue(row, c.key);
        const str = val && typeof val === "object"
          ? String((val as Record<string, unknown>).name || (val as Record<string, unknown>).code || "")
          : String(val ?? "");
        return `"${str.replace(/"/g, '""')}"`;
      }).join(",")
    );
    download([header, ...rows].join("\n"), filename);
  } else {
    const keys = Object.keys(data[0]).filter((k) => k !== "id" && k !== "created_at" && k !== "updated_at" && k !== "is_deleted");
    const header = keys.join(",");
    const rows = data.map((row) => keys.map((k) => {
      const val = (row as Record<string, unknown>)[k];
      if (val === null || val === undefined) return `""`;
      if (typeof val === "object") return `"${String((val as Record<string, unknown>).name || (val as Record<string, unknown>).code || "").replace(/"/g, '""')}"`;
      return `"${String(val).replace(/"/g, '""')}"`;
    }).join(","));
    download([header, ...rows].join("\n"), filename);
  }
}

function getNestedValue(obj: unknown, path: string): unknown {
  return path.split(".").reduce((o, k) => {
    if (o === null || o === undefined) return undefined;
    if (typeof o === "object") return (o as Record<string, unknown>)[k];
    return undefined;
  }, obj);
}

function download(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadTemplate(columns: string[], filename: string) {
  const csv = columns.join(",");
  download(csv, `${filename}_template`);
}

export function parseCsv(file: File): Promise<Record<string, string>[]> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split("\n").filter((l) => l.trim());
      if (lines.length < 2) return resolve([]);
      const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
      const rows = lines.slice(1).map((line) => {
        const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
        return Object.fromEntries(headers.map((h, i) => [h, values[i] || ""]));
      });
      resolve(rows);
    };
    reader.readAsText(file);
  });
}
