export type LockMode = 'pid' | 'name' | 'pid+name';

export interface ProcessSelection {
  pid: number;
  name: string;
  mode: LockMode;
}

export interface ProcessListEntry {
  pid: number;
  name: string;
}

export interface ProcessListData {
  processes?: ProcessListEntry[];
}

function findMatchByNameWithPidTieBreak(
  processes: ProcessListEntry[],
  name: string,
  pid?: number
): ProcessListEntry | null {
  const byName = processes.filter((p) => p && p.name === name);
  if (byName.length === 0) return null;
  if (byName.length === 1) return byName[0];
  if (pid) {
    const byPid = byName.find((p) => p.pid === pid);
    if (byPid) return byPid;
  }
  return null;
}

export function resolveSelectionPids(
  selections: ProcessSelection[],
  processList: ProcessListData | null | undefined
): number[] {
  if (!processList || !Array.isArray(processList.processes)) {
    return [];
  }

  const pids: number[] = [];
  for (const sel of selections) {
    switch (sel.mode) {
      case 'pid': {
        pids.push(sel.pid);
        break;
      }
      case 'name': {
        const match = findMatchByNameWithPidTieBreak(processList.processes, sel.name, sel.pid);
        if (match) {
          pids.push(match.pid);
        }
        break;
      }
      case 'pid+name': {
        const match = processList.processes.find((p) => p && p.pid === sel.pid && p.name === sel.name);
        if (match) {
          pids.push(match.pid);
        }
        break;
      }
    }
  }

  return [...new Set(pids)].sort((a, b) => a - b);
}

export function validateNameLock(
  selection: ProcessSelection,
  processList: ProcessListData | null | undefined
): { valid: boolean; message?: string } {
  if (selection.mode !== 'name') {
    return { valid: true };
  }
  if (!processList || !Array.isArray(processList.processes)) {
    return { valid: false, message: 'No process list available' };
  }
  const matches = processList.processes.filter((p) => p && p.name === selection.name);
  if (matches.length === 0) {
    return { valid: false, message: `Name "${selection.name}" not found` };
  }
  if (matches.length === 1) {
    return { valid: true };
  }
  if (selection.pid && matches.some((p) => p.pid === selection.pid)) {
    return { valid: true };
  }
  return { valid: false, message: `Name "${selection.name}" matches ${matches.length} processes` };
}

export function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
