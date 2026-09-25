const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withDangerousMod,
} = require('@expo/config-plugins');

/**
 * Release network hardening (docs/DECISIONS.md D-033, SECURITY_AUDIT.md).
 *
 * Evidence for removal from the RELEASE manifest:
 *  - no fetch/XHR/WebSocket/axios usage anywhere in src/ (static audit),
 *  - expo-updates disabled (expo.modules.updates.ENABLED = false),
 *  - notifications are local-scheduled (no push tokens, no servers),
 *  - exports/backup/QR/deep-links are local or user-initiated share intents.
 *
 * Libraries re-declare INTERNET (e.g. expo-file-system's own manifest), so a
 * plain strip of the app manifest is not enough: this plugin writes a
 * manifest-merger `tools:node="remove"` marker, which suppresses the
 * permission for every build variant that does not override it. The DEBUG
 * source-set manifest re-declares INTERNET with an explicit `tools:node="merge"`
 * (higher priority than main) so Metro and expo-dev-client keep working.
 * Final permission sets are verified with `aapt dump badging` on both APKs
 * (see SECURITY_AUDIT.md).
 *
 * Idempotent: safe to run on repeated prebuilds.
 */
const INTERNET = 'android.permission.INTERNET';

const withNetworkHardening = (config) => {
  // 1) Marker in the main manifest so library merge cannot re-add INTERNET.
  config = withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;
    const existing = Array.isArray(manifest['uses-permission'])
      ? manifest['uses-permission'].filter((p) => p.$?.['android:name'] !== INTERNET)
      : [];
    existing.push({ $: { 'android:name': INTERNET, 'tools:node': 'remove' } });
    manifest['uses-permission'] = existing;
    return modConfig;
  });

  // 2) Guarantee the debug source set declares INTERNET (Metro/dev-client).
  config = withDangerousMod(config, [
    'android',
    (modConfig) => {
      const debugManifest = path.join(
        modConfig.modRequest.platformProjectRoot,
        'app',
        'src',
        'debug',
        'AndroidManifest.xml',
      );
      fs.mkdirSync(path.dirname(debugManifest), { recursive: true });
      let xml = fs.existsSync(debugManifest)
        ? fs.readFileSync(debugManifest, 'utf8')
        : [
            '<manifest xmlns:android="http://schemas.android.com/apk/res/android"',
            '    xmlns:tools="http://schemas.android.com/tools">',
            '',
            '    <application android:usesCleartextTraffic="true" tools:targetApi="28" tools:ignore="GoogleAppIndexingWarning" tools:replace="android:usesCleartextTraffic" />',
            '</manifest>',
            '',
          ].join('\n');
      if (!xml.includes(INTERNET)) {
        xml = xml.replace(
          /(<manifest[^>]*>)/,
          `$1\n\n    <uses-permission android:name="${INTERNET}" tools:node="merge"/>`,
        );
        fs.writeFileSync(debugManifest, xml, 'utf8');
      } else if (!xml.includes('tools:node="merge"')) {
        xml = xml.replace(
          new RegExp(`<uses-permission android:name="${INTERNET}"\\s*/>`),
          `<uses-permission android:name="${INTERNET}" tools:node="merge"/>`,
        );
        fs.writeFileSync(debugManifest, xml, 'utf8');
      }
      return modConfig;
    },
  ]);

  return config;
};

module.exports = withNetworkHardening;
module.exports.INTERNET_PERMISSION = INTERNET;
