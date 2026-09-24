const { withAppBuildGradle } = require('@expo/config-plugins');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Injects release signing into android/app/build.gradle at prebuild time.
 * The keystore + its properties file live OUTSIDE the repo (~/.apexfoss/), so:
 *  - no secrets are ever committed;
 *  - builds stay reproducible via CNG (this plugin re-applies signing on every prebuild).
 *
 * Expected file: ~/.apexfoss/apexfoss-signing.properties with keys:
 *   storeFile, storePassword, keyAlias, keyPassword
 */
const propsPath = path.join(os.homedir(), '.apexfoss', 'apexfoss-signing.properties');

function readSigningProps() {
  if (!fs.existsSync(propsPath)) {
    throw new Error(
      `ApexFOSS signing config not found at ${propsPath}. ` +
        `Create the keystore outside the repo and the properties file with: ` +
        `storeFile, storePassword, keyAlias, keyPassword`,
    );
  }
  const props = {};
  for (const line of fs.readFileSync(propsPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m) props[m[1]] = m[2].trim();
  }
  return props;
}

const withApexSigning = (config) => {
  const props = readSigningProps();
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') return config;
    const marker = '// apexfoss:release-signing';
    if (!config.modResults.contents.includes(marker)) {
      config.modResults.contents += `

${marker}
def apexKeystoreProperties = new Properties()
apexKeystoreProperties.load(new FileInputStream("${propsPath.replace(/\\/g, '/')}"))
android {
    signingConfigs {
        release {
            storeFile file(apexKeystoreProperties['storeFile'])
            storePassword apexKeystoreProperties['storePassword']
            keyAlias apexKeystoreProperties['keyAlias']
            keyPassword apexKeystoreProperties['keyPassword']
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}
`;
    }
    return config;
  });
};

module.exports = withApexSigning;
