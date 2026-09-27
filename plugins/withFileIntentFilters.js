const { withAndroidManifest } = require('@expo/config-plugins');

const VIEW = 'android.intent.action.VIEW';
const DEFAULT = 'android.intent.category.DEFAULT';
const MIMES = ['application/json', 'application/octet-stream', 'text/plain'];

const hasFileOpenFilter = (activity) =>
  Array.isArray(activity['intent-filter']) &&
  activity['intent-filter'].some(
    (f) =>
      Array.isArray(f.action) &&
      f.action.some((a) => a.$?.['android:name'] === VIEW) &&
      Array.isArray(f.data) &&
      f.data.some((d) => d.$?.['android:scheme'] === 'content'),
  );

const withFileIntentFilters = (config) =>
  withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;
    const application = Array.isArray(manifest.application) ? manifest.application[0] : null;
    const activities = application && Array.isArray(application.activity) ? application.activity : [];
    const main = activities.find((a) => a.$?.['android:name'] === '.MainActivity');
    if (!main || hasFileOpenFilter(main)) return modConfig;
    main['intent-filter'] = Array.isArray(main['intent-filter']) ? main['intent-filter'] : [];
    main['intent-filter'].push({
      action: [{ $: { 'android:name': VIEW } }],
      category: [{ $: { 'android:name': DEFAULT } }],
      data: [
        { $: { 'android:scheme': 'content' } },
        { $: { 'android:scheme': 'file' } },
        ...MIMES.map((mimeType) => ({ $: { 'android:mimeType': mimeType } })),
      ],
    });
    return modConfig;
  });

module.exports = withFileIntentFilters;
