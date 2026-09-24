import { useMemo } from 'react';
import { View } from 'react-native';
import type { QrMatrix } from '../portability/qr';

/** Pure View grid renderer for QR matrices — no SVG/camera dependency. */
export function QrGrid({ matrix, size = 280 }: { matrix: QrMatrix; size?: number }) {
  const cell = Math.max(1, Math.floor(size / matrix.size));
  const grid = useMemo(() => matrix.modules, [matrix]);
  return (
    <View
      accessibilityLabel="QR code"
      style={{ width: cell * matrix.size, height: cell * matrix.size, backgroundColor: '#ffffff' }}
    >
      {grid.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row' }}>
          {row.map((dark, c) => (
            <View
              key={c}
              style={{
                width: cell,
                height: cell,
                backgroundColor: dark ? '#000000' : '#ffffff',
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}
