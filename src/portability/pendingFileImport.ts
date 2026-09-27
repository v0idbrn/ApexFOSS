import { detectImportKind } from './fileImport';

export type PendingFileImport = {
  kind: 'routine' | 'backup';
  text: string;
};

let pending: PendingFileImport | null = null;

export function setPendingFileImport(next: PendingFileImport): void {
  pending = next;
}

export function takePendingFileImport(): PendingFileImport | null {
  const p = pending;
  pending = null;
  return p;
}

export function peekPendingFileImport(): PendingFileImport | null {
  return pending;
}

/** Local VIEW-intent file URLs (content://, file://): read + detect, never import. */
export async function ingestIncomingUrl(url: string): Promise<boolean> {
  if (!url.startsWith('content://') && !url.startsWith('file://')) return false;
  try {
    const { File } = require('expo-file-system') as typeof import('expo-file-system');
    const text = await new File(url).text();
    const kind = detectImportKind(text);
    if (!kind) return false;
    setPendingFileImport({ kind, text });
    return true;
  } catch {
    return false;
  }
}
