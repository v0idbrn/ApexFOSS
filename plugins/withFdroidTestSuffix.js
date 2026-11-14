const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Temporary F-Droid test build suffix.
 *
 * When the Gradle property `apexFdroidTest` is set to 'true' (or env var
 * APEX_FDROID_TEST=true), appends '.fdroidtest' to the applicationId.
 *
 * This allows installing a test build alongside production (com.apexfoss.app)
 * on the same device without data conflicts.
 *
 * Default: OFF — normal builds and official F-Droid builds produce
 * com.apexfoss.app unchanged.
 */

function patchAppBuildGradle(contents) {
  // Check idempotency marker
  if (contents.includes('apexFdroidTest')) return contents;

  const defaultConfigStart = contents.indexOf('defaultConfig {');
  if (defaultConfigStart === -1) {
    throw new Error('withFdroidTestSuffix: defaultConfig { block not found');
  }

  const appIdLineIndex = contents.indexOf("applicationId 'com.apexfoss.app'", defaultConfigStart);
  if (appIdLineIndex === -1) {
    throw new Error('withFdroidTestSuffix: applicationId line not found');
  }

  const before = contents.substring(0, appIdLineIndex);
  const after = contents.substring(appIdLineIndex + "applicationId 'com.apexfoss.app'".length);

  const newBlock = `def baseAppId = 'com.apexfoss.app'
        def apexFdroidTest = providers.gradleProperty('apexFdroidTest').getOrElse('false') == 'true' ||
                             System.getenv('APEX_FDROID_TEST') == 'true'
        applicationId apexFdroidTest ? baseAppId + '.fdroidtest' : baseAppId`;

  return before + newBlock + after;
}

const withFdroidTestSuffix = (config) =>
  require('@expo/config-plugins').withAppBuildGradle(config, (modConfig) => {
    modConfig.modResults.contents = patchAppBuildGradle(modConfig.modResults.contents);
    return modConfig;
  });

module.exports = withFdroidTestSuffix;