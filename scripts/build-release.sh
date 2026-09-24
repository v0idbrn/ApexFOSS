#!/usr/bin/env bash
# Reproducible local release build using the user-land toolchain in .tooling/.
# Keystore + passwords live OUTSIDE the repo (~/.apexfoss/) — see plugins/withApexSigning.js.
set -euo pipefail
cd "$(dirname "$0")/.."
export JAVA_HOME="$(pwd)/.tooling/jdk"
export ANDROID_HOME="$(pwd)/.tooling/android-sdk"
export PATH="$JAVA_HOME/bin:$PATH"
cd android
./gradlew assembleRelease "$@"
