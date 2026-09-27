import type { DocumentPickerAsset } from 'expo-document-picker';
import { ROUTINE_FORMAT, BACKUP_FORMAT } from './types';

export type ImportFileKind = 'routine' | 'backup';

export type PickImportFileResult =
  | { status: 'canceled' }
  | { status: 'wrong-type'; fileName: string }
  | { status: 'ok'; fileName: string; text: string };

const EXTENSION: Record<ImportFileKind, string> = {
  routine: '.apexroutine',
  backup: '.apexbackup',
};

export function hasImportExtension(fileName: string, kind: ImportFileKind): boolean {
  return fileName.toLowerCase().endsWith(EXTENSION[kind]);
}

export function detectImportKind(text: string): ImportFileKind | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const format = (raw as { format?: unknown }).format;
  if (format === BACKUP_FORMAT) return 'backup';
  if (format === ROUTINE_FORMAT) return 'routine';
  return null;
}

export async function pickImportFile(kind: ImportFileKind): Promise<PickImportFileResult> {
  const DocumentPicker = require('expo-document-picker') as typeof import('expo-document-picker');
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets || result.assets.length === 0) {
    return { status: 'canceled' };
  }
  const asset: DocumentPickerAsset = result.assets[0];
  if (!hasImportExtension(asset.name, kind)) {
    return { status: 'wrong-type', fileName: asset.name };
  }
  const { File } = require('expo-file-system') as typeof import('expo-file-system');
  const text = await new File(asset.uri).text();
  return { status: 'ok', fileName: asset.name, text };
}
