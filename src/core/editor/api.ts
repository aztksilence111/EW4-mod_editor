export interface SkillView { id: string; name: string; description: string }
export interface CommanderRow { id: string; name: string; displayName: string; country: string; originalSkills: SkillView[]; effectiveSkills: SkillView[]; skillBinding: boolean; [field: string]: any }
export interface Overview {
  id: string; revision: number; baseline: string; fingerprint: string; commanderSourceHash: string; commanders: CommanderRow[]; skills: SkillView[];
  scenarios: { id: string; name: string; modified: boolean }[]; files: string[]; canUndo: boolean; canRedo: boolean
  sources: { id: string; name: string; version: string; packageHash: string }[];
  overrides: { path: string; hash: string; baselineHash: string | null; source: string | null; edited: boolean }[]
}
export interface Rule {
  domain: string; field: string; operation: string; value: number; rounding: string;
  filter: { country?: string; search?: string; ids?: number[]; cells?: number[]; mapId?: number; armyType?: number; commander?: number };
  targetCountry?: string; center?: number; skillId?: string; skillSlot?: number; skillLevel?: number
  deployment?: { cell: number; armyType?: number; armyGrade?: number; commander?: number; strengthNow?: number; strengthMax?: number }
}
export interface Preview {
  token: string; taskId: string; revision: number; count: number; affectedScenarios: number;
  changes: { file: string; object: string; field: string; before: unknown; after: unknown }[]
  slotMigrations?: { file: string; ruleIndex: number; oldToNew: (number | null)[] }[]
}
export interface ModPreview extends Preview {
  conflicts: { path: string; currentHash: string; incomingHash: string; baselineHash: string | null }[];
  package: { id: string; name: string; version: string; warnings: string[] }
}
export interface ScenarioView {
  id: string; bytes: string; mapId: number; mapWidth: number; revision: number; extensions: string[];
  factions: { index: number; id: string; variant: string }[]; jurisdictions: number[] | null; effectiveJurisdictions: number[]
  reverseReferences: {
    valid: boolean; conflicts: { code: string; subject: string; detail: string }[]
    byCell: { cell: number; sites: number[]; armies: number[]; events: number[]; markets: number[]; taverns: number[] }[]
    events: { eventId: number; slots: number[]; cells: number[]; armySlots: number[]; siteSlots: number[] }[]
    jurisdictionCenters: { center: number; locals: number[] }[]
  }
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch('/editor-api/' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-EW4-Editor': '1' }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || response.statusText);
  }
  return response.json();
}
export function fromBase64(value: string): ArrayBuffer {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0)).buffer;
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function exportMod(body: unknown, name: string) {
  const response = await fetch('/editor-api/export', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-EW4-Editor': '1' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error((await response.json()).error);
  download(await response.blob(), name + '.ew4mod');
}
