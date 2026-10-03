const { patchSettingsGradle, MARKER } = require('./withFdroidNotificationFlavor');

const ANCHOR_CONFIGURE_REFERENCE = 'extensions.configure(com.facebook.react.ReactSettingsExtension)';

const SAMPLE = [
  'plugins {',
  '  id("com.facebook.react.settings")',
  '  id("expo-autolinking-settings")',
  '}',
  '',
  'extensions.configure(com.facebook.react.ReactSettingsExtension) { ex ->',
  "  if (System.getenv('EXPO_USE_COMMUNITY_AUTOLINKING') == '1') {",
  '    ex.autolinkLibrariesFromCommand()',
  '  } else {',
  '    ex.autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand)',
  '  }',
  '}',
  'expoAutolinking.useExpoModules()',
  '',
  "rootProject.name = 'ApexFOSS'",
].join('\n');

describe('withFdroidNotificationFlavor settings patch', () => {
  it('injects the invocation flag, both exclusions and the patched rnConfigCommand', () => {
    const out = patchSettingsGradle(SAMPLE);
    expect(out).toContain(MARKER);
    expect(out).toContain("providers.gradleProperty('apexFdroid')");
    expect(out).toContain("apexFdroidFlavor ? ['expo-notifications'] : ['apex-notifications']");
    expect(out).toContain('expoAutolinking.exclude = apexNotificationExclude');
    expect(out).toContain(
      "ex.autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand + ['--exclude'] + apexNotificationExclude)",
    );
    // The exclusion is declared before the closure that consumes it and before
    // useExpoModules().
    expect(out.indexOf('apexNotificationExclude =')).toBeLessThan(
      out.indexOf(ANCHOR_CONFIGURE_REFERENCE),
    );
    expect(out.indexOf('apexNotificationExclude =')).toBeLessThan(
      out.indexOf('expoAutolinking.useExpoModules()'),
    );
  });

  it('is idempotent', () => {
    const once = patchSettingsGradle(SAMPLE);
    expect(patchSettingsGradle(once)).toBe(once);
  });

  it('throws when the prebuild template anchors are missing', () => {
    expect(() => patchSettingsGradle('plugins {}')).toThrow(/anchors not found/);
  });
});
