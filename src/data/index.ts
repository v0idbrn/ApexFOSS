import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { Platform } from 'react-native';
import { schema } from './schema';
import { migrations } from './migrations';
import { modelClasses } from './models';

// JSI requires the native module (dev build / release). Node tests use their own adapter.
const useJsi = Platform.OS === 'android' || Platform.OS === 'ios';

export const adapter = new SQLiteAdapter({
  schema,
  migrations,
  dbName: 'apexfoss',
  jsi: useJsi,
  onSetUpError: (error) => {
    console.error('[watermelondb] setup error', error);
  },
});

export const database = new Database({
  adapter,
  modelClasses: modelClasses as any,
});
