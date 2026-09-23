#!/usr/bin/env bash
# Installs JDK 17 (Temurin, portable zip) + Android SDK cmdline-tools into ./.tooling
# User-land only: no installers, no admin rights, nothing outside the project dir.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .tooling && cd .tooling

if [ ! -d jdk ]; then
  echo ">> Downloading Temurin JDK 17..."
  curl -sSL -o jdk.zip "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk"
  unzip -q jdk.zip && rm jdk.zip
  mv jdk-* jdk
fi
export JAVA_HOME="$(pwd)/jdk"
export PATH="$JAVA_HOME/bin:$PATH"

if [ ! -d android-sdk/cmdline-tools/latest ]; then
  echo ">> Downloading Android cmdline-tools..."
  curl -sSL -o cmdtools.zip "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
  unzip -q cmdtools.zip && rm cmdtools.zip
  mkdir -p android-sdk/cmdline-tools
  mv cmdline-tools android-sdk/cmdline-tools/latest
fi
export ANDROID_HOME="$(pwd)/android-sdk"

echo ">> Accepting licenses + installing platform, build-tools, platform-tools..."
yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager.bat" --licenses > /dev/null 2>&1 || true
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager.bat" "platform-tools" "platforms;android-36" "build-tools;36.0.0" > /dev/null

echo ">> Writing local.properties"
echo "sdk.dir=$(cygpath -m "$ANDROID_HOME" 2>/dev/null || echo "$ANDROID_HOME")" > ../local.properties

echo ">> DONE. JAVA_HOME=$JAVA_HOME"
"$JAVA_HOME/bin/java" -version 2>&1 | head -1
