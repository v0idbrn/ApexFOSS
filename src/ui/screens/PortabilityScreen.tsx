import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { database } from '../../data';
import { strings } from '../../constants/strings';
import { useNav } from '../navigation';
import { AppHeader, Button, Card, Screen, SectionHeader, TextField } from '../components';
import { shareRoutinePackage, shareBackup, reportPortabilityError } from '../../portability/share';
import {
  parseRoutinePackage,
  buildRoutinePackage,
  serializeRoutinePackage,
} from '../../portability/routinePackage';
import { previewRoutineImport, importRoutinePackage } from '../../portability/importRoutine';
import { createBackup, restoreBackup, parseBackup, backupSummary } from '../../portability/backup';
import { buildImportDeepLink, decodeRoutineTransport } from '../../portability/encoding';
import { fitsQr, encodeQr } from '../../portability/qr';
import { takePendingDeepLink } from '../../portability/pendingDeepLink';
import { QrGrid } from '../QrGrid';
import { makeDbActions } from '../../data/actions';

export function PortabilityScreen() {
  const { pop, push } = useNav();
  const [routineId, setRoutineId] = useState<string | null>(null);
  const [routineName, setRoutineName] = useState('');
  const [importText, setImportText] = useState('');
  const [backupText, setBackupText] = useState('');
  const [qrMatrix, setQrMatrix] = useState<ReturnType<typeof encodeQr> | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    makeDbActions(database)
      .listRoutinesWithCounts()
      .then((rows) => {
        if (rows.length > 0) {
          setRoutineId(rows[0].id);
          setRoutineName(rows[0].name);
        }
      })
      .catch(() => {});
    const pending = takePendingDeepLink();
    if (pending) {
      try {
        const pkg = decodeRoutineTransport(pending);
        setImportText(serializeRoutinePackage(pkg));
      } catch {
        Alert.alert(strings.portability.importFailed, strings.portability.invalidPayload);
      }
    }
  }, []);

  const onExport = useCallback(async () => {
    if (!routineId) return;
    setBusy(true);
    try {
      await shareRoutinePackage(database, routineId);
      setStatus(strings.portability.exportRoutine);
    } catch (e) {
      reportPortabilityError(e);
    } finally {
      setBusy(false);
    }
  }, [routineId]);

  const onShowQr = useCallback(async () => {
    if (!routineId) return;
    setBusy(true);
    setQrError(null);
    setQrMatrix(null);
    try {
      const pkg = await buildRoutinePackage(database, routineId);
      const url = buildImportDeepLink(pkg);
      if (!url) {
        setQrError(strings.portability.qrUnavailable);
        return;
      }
      if (!fitsQr(url)) {
        setQrError(strings.portability.qrUnavailable);
        return;
      }
      setQrMatrix(encodeQr(url));
    } catch (e) {
      setQrError(e instanceof Error ? e.message : strings.portability.invalidPayload);
    } finally {
      setBusy(false);
    }
  }, [routineId]);

  const onImportPreview = useCallback(async () => {
    const text = importText.trim();
    if (!text) {
      Alert.alert(strings.portability.importRoutine, strings.portability.emptyPaste);
      return;
    }
    setBusy(true);
    try {
      let json = text;
      if (text.startsWith('apexfoss://')) {
        const m = /[?&]d=([A-Za-z0-9_-]+)/.exec(text);
        if (!m) throw new Error(strings.portability.invalidPayload);
        json = serializeRoutinePackage(decodeRoutineTransport(m[1]));
      }
      parseRoutinePackage(json);
      const preview = await previewRoutineImport(database, json);
      Alert.alert(
        `${strings.portability.importPreviewTitle}: ${preview.routineName}`,
        `${strings.portability.blockCount}: ${preview.blockCount}\n` +
          `${strings.portability.stepCount}: ${preview.stepCount}\n` +
          `${strings.portability.matchedExercises}: ${preview.matchedExercises}\n` +
          `${strings.portability.newExercises}: ${preview.newExercises}`,
        [
          { text: strings.common.cancel, style: 'cancel' },
          {
            text: strings.portability.importConfirm,
            onPress: () => {
              void (async () => {
                try {
                  await importRoutinePackage(database, json);
                  setStatus(strings.portability.importDone);
                  setImportText('');
                } catch (e) {
                  Alert.alert(strings.portability.importFailed, e instanceof Error ? e.message : String(e));
                }
              })();
            },
          },
        ],
      );
    } catch (e) {
      Alert.alert(strings.portability.importFailed, e instanceof Error ? e.message : strings.portability.invalidPayload);
    } finally {
      setBusy(false);
    }
  }, [importText]);

  const onCreateBackup = useCallback(async () => {
    setBusy(true);
    try {
      await shareBackup(database);
      setStatus(strings.portability.createBackup);
    } catch (e) {
      reportPortabilityError(e);
    } finally {
      setBusy(false);
    }
  }, []);

  const onRestore = useCallback(async () => {
    const text = backupText.trim();
    if (!text) {
      Alert.alert(strings.portability.restoreBackup, strings.portability.emptyPaste);
      return;
    }
    setBusy(true);
    try {
      const backup = parseBackup(text);
      const summary = backupSummary(backup);
      Alert.alert(
        strings.portability.restoreConfirmTitle,
        `${strings.portability.restoreConfirmBody}\n\n` +
          `${strings.portability.blockCount}: ${summary.routines}\n` +
          `${strings.portability.matchedExercises}: ${summary.exercises}`,
        [
          { text: strings.common.cancel, style: 'cancel' },
          {
            text: strings.portability.restoreConfirm,
            style: 'destructive',
            onPress: () => {
              void (async () => {
                try {
                  await restoreBackup(database, text);
                  setStatus(strings.portability.restoreDone);
                  setBackupText('');
                } catch (e) {
                  Alert.alert(strings.portability.restoreFailed, e instanceof Error ? e.message : String(e));
                }
              })();
            },
          },
        ],
      );
    } catch (e) {
      Alert.alert(strings.portability.restoreFailed, e instanceof Error ? e.message : strings.portability.invalidPayload);
    } finally {
      setBusy(false);
    }
  }, [backupText]);

  return (
    <Screen>
      <AppHeader title={strings.portability.title} onBack={pop} />
      <ScrollView keyboardShouldPersistTaps="handled" className="flex-1 px-4 pb-8">
        <Text className="mt-3 text-sm text-dim">{strings.portability.subtitle}</Text>
        {status ? <Text className="mt-2 text-sm text-accent">{status}</Text> : null}

        <SectionHeader title={strings.portability.exportRoutine} />
        <Card>
          <Text className="mb-2 text-sm text-dim">{routineName || strings.routines.empty}</Text>
          <View className="flex-row gap-2">
            <Button
              label={strings.portability.exportRoutine}
              variant="secondary"
              disabled={!routineId || busy}
              onPress={() => void onExport()}
              className="flex-1"
            />
            <Button
              label={strings.portability.showQr}
              variant="secondary"
              disabled={!routineId || busy}
              onPress={() => void onShowQr()}
              className="flex-1"
            />
          </View>
          {qrError ? <Text className="mt-2 text-sm text-danger">{qrError}</Text> : null}
          {qrMatrix ? (
            <View className="mt-3 items-center">
              <QrGrid matrix={qrMatrix} />
            </View>
          ) : null}
        </Card>

        <SectionHeader title={strings.portability.importRoutine} />
        <Card>
          <TextField
            label={strings.portability.importPasteTitle}
            multiline
            numberOfLines={4}
            value={importText}
            onChangeText={setImportText}
            placeholder="apexfoss://import?d=... or portable JSON"
            placeholderTextColor="#a3a3a3"
            className="min-h-24"
            textAlignVertical="top"
          />
          <Button
            label={strings.portability.importConfirm}
            disabled={busy}
            onPress={() => void onImportPreview()}
            className="mt-3"
          />
        </Card>

        <SectionHeader title={strings.portability.createBackup} />
        <Card>
          <Text className="mb-2 text-sm text-dim">{strings.portability.createBackupHint}</Text>
          <Button
            label={strings.portability.createBackup}
            variant="secondary"
            disabled={busy}
            onPress={() => void onCreateBackup()}
          />
        </Card>

        <SectionHeader title={strings.portability.restoreBackup} />
        <Card>
          <Text className="mb-2 text-sm text-danger">{strings.portability.restoreBackupHint}</Text>
          <TextField
            label={strings.portability.restoreBackup}
            multiline
            numberOfLines={4}
            value={backupText}
            onChangeText={setBackupText}
            placeholder='{"format":"apexfoss-backup"…}'
            placeholderTextColor="#a3a3a3"
            className="min-h-24"
            textAlignVertical="top"
          />
          <Button
            label={strings.portability.restoreConfirm}
            variant="danger"
            disabled={busy}
            onPress={() => void onRestore()}
            className="mt-3"
          />
        </Card>

        <Text className="mt-4 text-xs text-dim">{strings.portability.schemeNote}</Text>
        <Button label={strings.common.back} variant="ghost" onPress={() => push({ name: 'home' })} className="mt-4" />
      </ScrollView>
    </Screen>
  );
}
