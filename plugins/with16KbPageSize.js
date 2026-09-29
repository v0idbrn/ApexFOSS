const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * 16 KB page-size compliance for libwatermelondb-jsi.so (D-054).
 *
 * Google Play requires 16 KB ELF alignment for native libraries in apps
 * targeting API 35+ (enforced since 1 Nov 2025). Every arm64 library in the
 * release APK already reports LOAD alignment 0x4000 except
 * libwatermelondb-jsi.so (0x1000): WatermelonDB 0.28.0 compiles its JSI
 * adapter from C++ source via CMake with the NDK default 4 KB
 * max-page-size, and AGP does not override it for this module.
 *
 * This plugin (listed in app.json) appends a shared-linker flag to the
 * module's defaultConfig cmake block at prebuild time:
 *   arguments "-DCMAKE_SHARED_LINKER_FLAGS=-Wl,-z,max-page-size=16384"
 * The module source (standard add_library SHARED, no custom linker script)
 * needs nothing else. Idempotent: safe to run on every prebuild, and it
 * re-applies after a fresh `npm install`.
 *
 * Verify on the built artifact (never trust Gradle success alone):
 *   llvm-readelf -l lib/arm64-v8a/libwatermelondb-jsi.so  # LOAD Align 0x4000
 */
const MARKER = 'apexfoss:16kb-page-size';
const FLAG_LINE =
  'arguments "-DCMAKE_SHARED_LINKER_FLAGS=-Wl,-z,max-page-size=16384"';

function apply16KbFlag(contents) {
  if (contents.includes(MARKER)) return { contents, changed: false };
  // First `externalNativeBuild { cmake {` block is defaultConfig's (the
  // top-level one carries the CMakeLists path instead).
  const re = /externalNativeBuild\s*\{\s*\r?\n(\s*)cmake\s*\{\r?\n/;
  const m = re.exec(contents);
  if (!m) {
    throw new Error(
      'with16KbPageSize: cannot locate defaultConfig externalNativeBuild cmake block ' +
        'in watermelondb android-jsi build.gradle',
    );
  }
  const indent = `${m[1]}    `;
  const eol = contents.includes('\r\n') ? '\r\n' : '\n';
  const insertAt = m.index + m[0].length;
  const block = `// ${MARKER} (Play 16KB requirement, targetSdk 35+): 16 KB ELF alignment.${eol}${indent}${FLAG_LINE}${eol}`;
  return { contents: contents.slice(0, insertAt) + block + contents.slice(insertAt), changed: true };
}

const with16KbPageSize = (config) => {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const gradlePath = path.join(
        projectRoot,
        'node_modules',
        '@nozbe',
        'watermelondb',
        'native',
        'android-jsi',
        'build.gradle',
      );
      if (!fs.existsSync(gradlePath)) {
        throw new Error(`with16KbPageSize: not found: ${gradlePath}`);
      }
      const original = fs.readFileSync(gradlePath, 'utf8');
      const { contents, changed } = apply16KbFlag(original);
      if (changed) fs.writeFileSync(gradlePath, contents);
      return config;
    },
  ]);
};

module.exports = with16KbPageSize;
// Exported for unit testing the transform without touching the filesystem.
module.exports.apply16KbFlag = apply16KbFlag;
module.exports.FLAG_LINE = FLAG_LINE;
