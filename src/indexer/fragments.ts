export function splitName(name: string): string[] {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  const parts = spaced
    .split(/[^a-zA-Z0-9]+/)
    .map((s) => s.toLowerCase())
    .filter((s) => s.length > 1);
  return [...new Set(parts)];
}
