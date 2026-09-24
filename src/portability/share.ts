import { Alert, Share } from 'react-native';
import { Database } from '@nozbe/watermelondb';
import { buildRoutinePackage, serializeRoutinePackage } from './routinePackage';
import { createBackup, serializeBackup } from './backup';
import { buildImportDeepLink, encodeRoutineTransport } from './encoding';
import { fitsQr, encodeQr, type QrMatrix } from './qr';
import { strings } from '../constants/strings';

/** Offline share-sheet for portable routine packages. No cloud, no filesystem. */

export async function shareRoutinePackage(db: Database, routineId: string): Promise<boolean> {
  const pkg = await buildRoutinePackage(db, routineId);
  const json = serializeRoutinePackage(pkg);
  await Share.share({ message: json, title: `ApexFOSS ${pkg.routine.name}.apexroutine` });
  return true;
}

export async function shareBackup(db: Database): Promise<boolean> {
  const backup = await createBackup(db);
  const json = serializeBackup(backup);
  await Share.share({ message: json, title: 'ApexFOSS backup.apexbackup' });
  return true;
}

export function routineDeepLinkFor(db: Database, routineId: string): Promise<string | null> {
  return buildRoutinePackage(db, routineId).then((pkg) => buildImportDeepLink(pkg));
}

export function qrForRoutinePackage(pkgJson: string): QrMatrix | null {
  // QR carries the deep link URL when it fits EC-M v1–10 capacity.
  try {
    const encoded = encodeRoutineTransport(JSON.parse(pkgJson));
    const url = `apexfoss://import?d=${encoded}`;
    if (!fitsQr(url)) return null;
    return encodeQr(url);
  } catch {
    return null;
  }
}

export function reportPortabilityError(e: unknown): void {
  Alert.alert(strings.common.error, e instanceof Error ? e.message : String(e));
}
