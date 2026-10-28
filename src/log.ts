// One line per event on stdout: `event key=value`, a person as their tag,
// every string JSON-quoted so a name can't forge a field.
export function log(event: string, fields: Record<string, unknown> = {}): void {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === "number" || typeof v === "boolean" ? v : JSON.stringify(v)}`);
  console.log([event, ...parts].join(" "));
}
