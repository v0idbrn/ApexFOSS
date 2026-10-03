package expo.modules.apexnotifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.os.bundleOf
import expo.modules.interfaces.permissions.PermissionsResponse
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private val PERMISSIONS: Array<String> = arrayOf(Manifest.permission.POST_NOTIFICATIONS)
private const val CHANNEL_ID_KEY = "channelId"
private const val IMPORTANCE_KEY = "importance"
private const val NAME_KEY = "name"
private const val SOUND_KEY = "sound"

/**
 * FOSS local-notification backend for the F-Droid build (docs/DECISIONS.md).
 * Surface mirrors the subset of expo-notifications this app uses: permission
 * query/ask, one-shot + daily local scheduling, cancel/list, channel setup.
 * No push, no tokens, no Firebase anywhere.
 */
class ApexNotificationsModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ApexNotifications")

    AsyncFunction("getPermissionsAsync") { promise: Promise ->
      respond(promise, ask = false)
    }

    AsyncFunction("requestPermissionsAsync") { promise: Promise ->
      respond(promise, ask = true)
    }

    AsyncFunction("scheduleOnceAsync") { id: String?, title: String, body: String, channelId: String?, timestamp: Double ->
      AlarmScheduler.scheduleOnce(context, id, title, body, channelId, timestamp.toLong())
    }

    AsyncFunction("scheduleDailyAsync") { id: String?, title: String, body: String, channelId: String?, hour: Int, minute: Int ->
      AlarmScheduler.scheduleDaily(context, id, title, body, channelId, hour, minute)
    }

    AsyncFunction("cancelAsync") { id: String ->
      AlarmScheduler.cancel(context, id)
    }

    /**
     * Whether setAlarmClock will succeed right now. False when the user has
     * not (yet) granted SCHEDULE_EXACT_ALARM (denied by default on API 34+
     * for newly installed apps). JS gates scheduling on this; the in-app
     * countdown stays authoritative either way.
     */
    AsyncFunction("canScheduleExactAlarmsAsync") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return@AsyncFunction true
      val manager = context.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
      manager.canScheduleExactAlarms()
    }

    /**
     * Opens the system "Alarms & reminders" screen so the user can grant
     * SCHEDULE_EXACT_ALARM. No-op on API < 31 or when no activity is attached.
     */
    AsyncFunction("openExactAlarmSettingsAsync") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return@AsyncFunction false
      val activity = appContext.currentActivity ?: return@AsyncFunction false
      val intent = android.content.Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
        data = android.net.Uri.parse("package:${context.packageName}")
        addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      activity.startActivity(intent)
      true
    }

    AsyncFunction("cancelAllAsync") {
      AlarmScheduler.cancelAll(context)
    }

    AsyncFunction<List<String>>("listScheduledAsync") {
      AlarmScheduler.list(context)
    }

    AsyncFunction("setChannelAsync") { channelId: String, name: String, importance: Int, sound: Boolean ->
      setChannel(channelId, name, importance, sound)
    }
  }

  private fun respond(promise: Promise, ask: Boolean) {
    val ctx = appContext.reactContext
    val enabled = ctx != null && NotificationManagerCompat.from(ctx).areNotificationsEnabled()
    val needsAsk = ask &&
      ctx != null &&
      Build.VERSION.SDK_INT >= 33 &&
      ctx.applicationInfo.targetSdkVersion >= 33 &&
      ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) !=
      PackageManager.PERMISSION_GRANTED

    if (needsAsk) {
      val permissions = appContext.permissions
      if (permissions != null) {
        permissions.askForPermissions({ resolvePermissions(promise) }, *PERMISSIONS)
        return
      }
    }
    resolvePermissions(promise)
  }

  private fun resolvePermissions(promise: Promise) {
    val ctx = appContext.reactContext
    val granted = ctx != null && NotificationManagerCompat.from(ctx).areNotificationsEnabled()
    promise.resolve(
      bundleOf(
        PermissionsResponse.EXPIRES_KEY to PermissionsResponse.PERMISSION_EXPIRES_NEVER,
        PermissionsResponse.STATUS_KEY to
          (if (granted) PermissionsStatus.GRANTED.status else PermissionsStatus.DENIED.status),
        PermissionsResponse.CAN_ASK_AGAIN_KEY to true,
        PermissionsResponse.GRANTED_KEY to granted,
      ),
    )
  }

  private fun setChannel(channelId: String, name: String, importance: Int, sound: Boolean) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    // JS AndroidImportance enum -> android importance (expo enum value - 2, clamped).
    val nativeImportance = if (importance in 2..7) importance - 2 else NotificationManager.IMPORTANCE_DEFAULT
    manager.createNotificationChannel(
      NotificationChannel(channelId, name, nativeImportance).apply {
        setShowBadge(true)
        if (sound) {
          enableVibration(true)
        } else {
          setSound(null, null)
        }
      },
    )
  }
}
