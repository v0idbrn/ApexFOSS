import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { database } from '../../data';
import { strings } from '../../constants/strings';
import { useNav } from '../navigation';
import { AppHeader, Button, Card, Screen, SectionHeader, TextField } from '../components';
import { shareRoutinePackage, shareBackup, reportPortabilityError, portabilityErrorMessage } from '../../portability/share';
import {
  parseRoutinePackage,
  buildRoutinePackage,
  serializeRoutinePackage,
} from '../../portability/routinePackage';
import { previewRoutineImport, importRoutinePackage } from '../../portability/importRoutine';
import { createBackup, restoreBackup, parseBackup, backupSummary } from '../../portability/backup';
import { buildImportDeepLink, decodeRoutineTransport, parseImportDeepLink } from '../../portability/encoding';
import { fitsQr, encodeQr } from '../../portability/qr';
import { takePendingDeepLink } from '../../portability/pendingDeepLink';
import { takePendingFileImport } from '../../portability/pendingFileImport';
import { pickImportFile } from '../../portability/fileImport';
import { QrGrid } from '../QrGrid';
import { makeDbActions } from '../../data/actions';

function exerciseLine(label: string, count: number, names: string[]): string {
  return `${label} (${count})${names.length ? `: ${names.join(', ')}` : ''}`;
}

export function PortabilityScreen() {
  const { pop } = useNav();
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
    const pendingFile = takePendingFileImport();
    if (pendingFile) {
      if (pendingFile.kind === 'routine') setImportText(pendingFile.text);
      else setBackupText(pendingFile.text);
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

  const runRoutinePreview = useCallback(async (rawText: string) => {
    const text = rawText.trim();
    if (!text) {
      Alert.alert(strings.portability.importRoutine, strings.portability.emptyPaste);
      return;
    }
    try {
      let json = text;
      if (text.startsWith('apexfoss://')) {
        const parsed = parseImportDeepLink(text);
        if (!parsed.ok) throw new Error(strings.portability.invalidPayload);
        json = serializeRoutinePackage(decodeRoutineTransport(parsed.encoded));
      }
      parseRoutinePackage(json);
      const preview = await previewRoutineImport(database, json);
      Alert.alert(
        `${strings.portability.importPreviewTitle}: ${preview.routineName}`,
        `${strings.portability.blockCount}: ${preview.blockCount}\n` +
          `${strings.portability.stepCount}: ${preview.stepCount}\n` +
          `${exerciseLine(strings.portability.matchedExercises, preview.matchedExercises, preview.matchedExerciseNames)}\n` +
          exerciseLine(strings.portability.newExercises, preview.newExercises, preview.newExerciseNames),
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
      Alert.alert(strings.portability.importFailed, portabilityErrorMessage(e));
    }
  }, []);

  const onImportPreview = useCallback(async () => {
    setBusy(true);
    try {
      await runRoutinePreview(importText);
    } finally {
      setBusy(false);
    }
  }, [importText, runRoutinePreview]);

  const onImportFromFile = useCallback(async () => {
    setBusy(true);
    try {
      const picked = await pickImportFile('routine');
      if (picked.status === 'canceled') return;
      if (picked.status === 'wrong-type') {
        Alert.alert(strings.portability.importFailed, strings.portability.invalidRoutineFile);
        return;
      }
      setImportText(picked.text);
      await runRoutinePreview(picked.text);
    } catch (e) {
      Alert.alert(strings.portability.importFailed, portabilityErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [runRoutinePreview]);

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

  const runRestorePreview = useCallback(async (rawText: string) => {
    const text = rawText.trim();
    if (!text) {
      Alert.alert(strings.portability.restoreBackup, strings.portability.emptyPaste);
      return;
    }
    try {
      const backup = parseBackup(text);
      const summary = backupSummary(backup);
      const lines = [
        strings.portability.restoreValidationOk,
        `${strings.routines.title}: ${summary.routines}`,
        `${strings.exercises.title}: ${summary.exercises}`,
        `${strings.muscles.sessions}: ${summary.sessions} · ${strings.muscles.sets}: ${summary.setLogs}`,
      ];
      if (summary.readinessTests > 0) lines.push(`${strings.readiness.title}: ${summary.readinessTests}`);
      if (summary.equipmentItems > 0) lines.push(`${strings.exercises.equipment}: ${summary.equipmentItems}`);
      if (summary.programs > 0 || summary.mesocycles > 0) {
        lines.push(`${strings.programs.title}: ${summary.programs} · ${strings.programs.mesocycles}: ${summary.mesocycles}`);
      }
      if (summary.goals > 0) lines.push(`${strings.goals.title}: ${summary.goals}`);
      if (summary.bodyMetrics > 0) lines.push(`${strings.body.title}: ${summary.bodyMetrics}`);
      lines.push(`${strings.portability.summarySchema}: ${backup.schemaVersion}`);
      Alert.alert(
        strings.portability.restoreConfirmTitle,
        `${strings.portability.restoreConfirmBody}\n\n${lines.join('\n')}`,
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
      Alert.alert(strings.portability.restoreFailed, portabilityErrorMessage(e));
    }
  }, []);

  const onRestore = useCallback(async () => {
    setBusy(true);
    try {
      await runRestorePreview(backupText);
    } finally {
      setBusy(false);
    }
  }, [backupText, runRestorePreview]);

  const onRestoreFromFile = useCallback(async () => {
    setBusy(true);
    try {
      const picked = await pickImportFile('backup');
      if (picked.status === 'canceled') return;
      if (picked.status === 'wrong-type') {
        Alert.alert(strings.portability.restoreFailed, strings.portability.invalidBackupFile);
        return;
      }
      setBackupText(picked.text);
      await runRestorePreview(picked.text);
    } catch (e) {
      Alert.alert(strings.portability.restoreFailed, portabilityErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [runRestorePreview]);

  return (
    <Screen>
      <AppHeader title={strings.portability.title} onBack={pop} />
      <ScrollView keyboardShouldPersistTaps="handled" className="flex-1 px-4 pb-8">
        <Text className="mt-3 text-sm text-dim">{strings.portability.subtitle}</Text>
        {status ? (
          <Text accessibilityLiveRegion="polite" className="mt-2 text-sm text-accent-ink" testID="portability-status">
            {status}
          </Text>
        ) : null}

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
          {qrError ? (
            <Text accessibilityRole="alert" className="mt-2 text-sm text-danger" testID="portability-qr-error">
              {qrError}
            </Text>
          ) : null}
          {qrMatrix ? (
            <View
              className="mt-3 items-center"
              accessible
              accessibilityRole="image"
              accessibilityLabel={strings.common.qrCode}
              testID="portability-qr"
            >
              <QrGrid matrix={qrMatrix} />
            </View>
          ) : null}
        </Card>

        <SectionHeader title={strings.portability.importRoutine} />
        <Card>
          <TextField
            label={strings.portability.importPasteTitle}
            accessibilityLabel={strings.portability.importPasteTitle}
            multiline
            numberOfLines={4}
            value={importText}
            onChangeText={setImportText}
            placeholder={strings.portability.importPlaceholder}
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
          <Button
            label={strings.portability.importFromFile}
            variant="secondary"
            disabled={busy}
            onPress={() => void onImportFromFile()}
            className="mt-2"
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
            accessibilityLabel={strings.portability.restoreBackup}
            multiline
            numberOfLines={4}
            value={backupText}
            onChangeText={setBackupText}
            placeholder={strings.portability.jsonPlaceholder}
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
          <Button
            label={strings.portability.restoreFromFile}
            variant="secondary"
            disabled={busy}
            onPress={() => void onRestoreFromFile()}
            className="mt-2"
          />
        </Card>

        <Text className="mt-4 text-xs text-dim">{strings.portability.schemeNote}</Text>
        <Button label={strings.common.back} variant="ghost" onPress={pop} className="mt-4" />
      </ScrollView>
    </Screen>
  );
}
