import { portabilityErrorMessage } from './share';
import { PortabilityError } from './types';
import { strings } from '../constants/strings';

describe('portabilityErrorMessage', () => {
  it('maps checksum mismatch to a readable message', () => {
    expect(portabilityErrorMessage(new PortabilityError('checksum_mismatch'))).toBe(
      strings.portability.checksumMismatch,
    );
  });

  it.each(['schema_mismatch', 'unsupported_version', 'unsupported_backup_version'] as const)(
    'maps %s to the newer-version message',
    (code) => {
      expect(portabilityErrorMessage(new PortabilityError(code, 'schemaVersion'))).toBe(
        strings.portability.newerVersion,
      );
    },
  );

  it('falls back to the invalid-payload message for other portability errors', () => {
    expect(portabilityErrorMessage(new PortabilityError('missing_field', 'data.exercises'))).toBe(
      strings.portability.invalidPayload,
    );
  });

  it('passes ordinary error messages through unchanged', () => {
    expect(portabilityErrorMessage(new Error('disk full'))).toBe('disk full');
  });

  it('falls back to the invalid-payload message for non-errors', () => {
    expect(portabilityErrorMessage(null)).toBe(strings.portability.invalidPayload);
    expect(portabilityErrorMessage('boom')).toBe(strings.portability.invalidPayload);
  });
});
