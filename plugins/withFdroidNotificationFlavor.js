const { withSettingsGradle } = require('@expo/config-plugins');

/**
 * Invocation-scoped F-Droid flavor (docs/DISTRIBUTION_FDROID_SUBMISSION.md).
 *
 * expo autolinking is evaluated once per Gradle invocation at settings time —
 * not per variant — so a product flavor cannot swap linked modules in a single
 * build. Instead the F-Droid build is a separate invocation flagged with
 * `-PapexFdroid=true`:
 *
 *  - F-Droid  : exclude `expo-notifications` (its Android side pulls in
 *               com.google.firebase:firebase-messaging -> FCM service, c2dm
 *               permission, MESSAGING_EVENT) and link `modules/apex-notifications`
 *               (local, FOSS, AlarmManager + NotificationManager only).
 *  - Normal   : exclude `apex-notifications` so the upstream APK stays
 *               equivalent to builds before this plugin existed.
 *
 * Both autolinking entry points in settings.gradle must be covered:
 *  - `expoAutolinking.exclude`      -> useExpoModules() resolve + module list
 *  - `rnConfigCommand --exclude`    -> react-native-config (gradle deps +
 *                                      PackageList); it does not read the
 *                                      extension property.
 *
 * Idempotent: safe to run on repeated prebuilds.
 */
const MARKER = '// apexfoss:fdroid-notification-flavor';
const ANCHOR_COMMAND =
  'ex.autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand)';
const ANCHOR_CONFIGURE =
  'extensions.configure(com.facebook.react.ReactSettingsExtension)';
const ANCHOR_USE_MODULES = 'expoAutolinking.useExpoModules()';

function patchSettingsGradle(contents) {
  if (contents.includes(MARKER)) return contents;
  if (
    !contents.includes(ANCHOR_COMMAND) ||
    !contents.includes(ANCHOR_CONFIGURE) ||
    !contents.includes(ANCHOR_USE_MODULES)
  ) {
    throw new Error(
      'withFdroidNotificationFlavor: settings.gradle anchors not found — ' +
        'review plugins/withFdroidNotificationFlavor.js against the prebuild template.',
    );
  }

  const injected = `${MARKER}
// Autolinking is settings-scoped (one evaluation per invocation), so the
// F-Droid build switches the notification stack per invocation, not per variant.
def apexFdroidFlavor = providers.gradleProperty('apexFdroid').getOrElse('false') == 'true'
def apexNotificationExclude = apexFdroidFlavor ? ['expo-notifications'] : ['apex-notifications']
expoAutolinking.exclude = apexNotificationExclude

`;

  return contents
    .replace(ANCHOR_COMMAND, ANCHOR_COMMAND.replace(
      'expoAutolinking.rnConfigCommand',
      "expoAutolinking.rnConfigCommand + ['--exclude'] + apexNotificationExclude",
    ))
    .replace(ANCHOR_CONFIGURE, `${injected}${ANCHOR_CONFIGURE}`);
}

const withFdroidNotificationFlavor = (config) =>
  withSettingsGradle(config, (modConfig) => {
    modConfig.modResults.contents = patchSettingsGradle(modConfig.modResults.contents);
    return modConfig;
  });

module.exports = withFdroidNotificationFlavor;
module.exports.patchSettingsGradle = patchSettingsGradle;
module.exports.MARKER = MARKER;
