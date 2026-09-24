const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * WatermelonDB >= 0.28 ships WatermelonDBJSIPackage as a plain ReactPackage whose
 * WMDatabaseJSIBridge module exposes a synchronous install() (reanimated-style).
 * The old JSIModulePackage wiring was removed from RN 0.81+, but
 * @morrowdigital/watermelondb-expo-plugin still injects it into MainApplication.kt,
 * which breaks compilation:
 *   e: MainApplication.kt:6:34 Unresolved reference 'JSIModulePackage'
 *
 * This plugin (listed AFTER the morrow plugin in app.json):
 *   1. strips the dead `import com.facebook.react.bridge.JSIModulePackage;` line;
 *   2. ensures `WatermelonDBJSIPackage` is registered in the PackageList apply block
 *      so NativeModules.WMDatabaseJSIBridge exists and JSI actually installs.
 * Idempotent: safe to run on every prebuild.
 */
const withWatermelonJsiFix = (config) => {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const androidRoot = config.modRequest.platformProjectRoot; // <project>/android
      const packageName = config.android?.package || 'com.apexfoss.app';
      let mainAppPath = path.join(
        androidRoot,
        'app',
        'src',
        'main',
        'java',
        ...packageName.split('.'),
        'MainApplication.kt',
      );
      if (!fs.existsSync(mainAppPath)) {
        // Fallback: template may use MainApplication.java layout
        const javaDir = path.join(androidRoot, 'app', 'src', 'main', 'java');
        const candidates = [];
        const walk = (dir) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/^MainApplication\.(kt|java)$/.test(entry.name)) candidates.push(full);
          }
        };
        walk(javaDir);
        if (candidates.length === 0) return config;
        mainAppPath = candidates[0];
      }

      let contents = fs.readFileSync(mainAppPath, 'utf8');
      const original = contents;

      // 1) Remove the dead import (any trailing whitespace variant).
      contents = contents.replace(
        /^[ \t]*import com\.facebook\.react\.bridge\.JSIModulePackage;[ \t]*\r?\n?/m,
        '',
      );

      // 2) Ensure the WatermelonDB JSI package import exists.
      if (!contents.includes('import com.nozbe.watermelondb.jsi.WatermelonDBJSIPackage;')) {
        if (/^import android\.app\.Application;[ \t]*$/m.test(contents)) {
          contents = contents.replace(
            /^import android\.app\.Application;[ \t]*$/m,
            'import android.app.Application;\nimport com.nozbe.watermelondb.jsi.WatermelonDBJSIPackage;',
          );
        } else {
          contents =
            'import com.nozbe.watermelondb.jsi.WatermelonDBJSIPackage;\n' + contents;
        }
      }

      // 3) Register the package so the JSI bridge NativeModule is instantiated.
      if (!contents.includes('add(WatermelonDBJSIPackage())')) {
        contents = contents.replace(
          /(PackageList\(this\)\.packages\.apply\s*\{)/,
          '$1\n          add(WatermelonDBJSIPackage())',
        );
      }

      if (contents !== original) {
        fs.writeFileSync(mainAppPath, contents);
      }
      return config;
    },
  ]);
};

module.exports = withWatermelonJsiFix;
