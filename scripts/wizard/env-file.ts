/**
 * Reads and writes the dotenv file the wizard records its values in.
 * Values are always written double-quoted, so spaces and `<…>` survive.
 */
export type EnvValues = Record<string, string>;

export function parseEnvFile(text: string): EnvValues {
  const values: EnvValues = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const [, name, raw] = match;
    values[name] = raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2
      ? raw.slice(1, -1).replace(/\\(["\\n])/g, (_, c: string) => (c === "n" ? "\n" : c))
      : raw;
  }
  return values;
}

export function serializeEnvFile(values: EnvValues, header: string): string {
  const lines = header.split("\n").map((line) => `# ${line}`);
  for (const [name, value] of Object.entries(values)) {
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    lines.push(`${name}="${escaped}"`);
  }
  return `${lines.join("\n")}\n`;
}
