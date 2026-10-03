package expo.modules.apexnotifications

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import org.json.JSONObject
import java.util.UUID

/**
 * AlarmManager-backed scheduler for the F-Droid build.
 *
 * Uses setAlarmClock (exact) with a setAndAllowWhileIdle fallback is intentionally
 * NOT needed: alarm-clock alarms are exempt from doze. NOTE: setAlarmClock
 * still requires SCHEDULE_EXACT_ALARM on API 31+ (declared in this module's
 * manifest; denied by default for newly installed target-34+ apps until the
 * user grants it under Special app access > Alarms & reminders). Callers must
 * check canScheduleExactAlarms() first — without the grant, setAlarmClock
 * throws SecurityException.
 * Scheduled alarms are tracked in SharedPreferences so cancel/list work across process death (the receiver is manifest-declared).
 */
object AlarmScheduler {
  const val EXTRA_ID = "apex_notification_id"
  const val EXTRA_TITLE = "apex_notification_title"
  const val EXTRA_BODY = "apex_notification_body"
  const val EXTRA_CHANNEL = "apex_notification_channel"
  const val EXTRA_DAILY = "apex_notification_daily"
  const val EXTRA_HOUR = "apex_notification_hour"
  const val EXTRA_MINUTE = "apex_notification_minute"

  const val DEFAULT_CHANNEL_ID = "apex-notifications-default"

  private const val PREFS = "apex_notifications_registry"

  private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun pendingIntent(
    ctx: Context,
    id: String,
    title: String,
    body: String,
    channel: String,
    daily: Boolean,
    hour: Int,
    minute: Int,
  ): PendingIntent {
    val intent = Intent(ctx, AlarmReceiver::class.java)
      .putExtra(EXTRA_ID, id)
      .putExtra(EXTRA_TITLE, title)
      .putExtra(EXTRA_BODY, body)
      .putExtra(EXTRA_CHANNEL, channel)
      .putExtra(EXTRA_DAILY, daily)
      .putExtra(EXTRA_HOUR, hour)
      .putExtra(EXTRA_MINUTE, minute)
    return PendingIntent.getBroadcast(
      ctx,
      id.hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun store(
    ctx: Context,
    id: String,
    title: String,
    body: String,
    channel: String,
    time: Long,
    daily: Boolean,
    hour: Int,
    minute: Int,
  ) {
    val record = JSONObject()
      .put("title", title)
      .put("body", body)
      .put("channel", channel)
      .put("time", time)
      .put("daily", daily)
      .put("hour", hour)
      .put("minute", minute)
    prefs(ctx).edit().putString(id, record.toString()).apply()
  }

  private fun arm(
    ctx: Context,
    id: String,
    title: String,
    body: String,
    channel: String,
    time: Long,
    daily: Boolean,
    hour: Int,
    minute: Int,
  ) {
    val alarmManager = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val operation = pendingIntent(ctx, id, title, body, channel, daily, hour, minute)
    val showIntent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.let { launch ->
      PendingIntent.getActivity(
        ctx,
        id.hashCode() xor 0x5eed,
        launch,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
    alarmManager.setAlarmClock(AlarmManager.AlarmClockInfo(time, showIntent ?: operation), operation)
  }

  fun scheduleOnce(
    ctx: Context,
    id: String?,
    title: String,
    body: String,
    channelId: String?,
    timestampMs: Long,
  ): String {
    val finalId = id ?: UUID.randomUUID().toString()
    val channel = channelId ?: DEFAULT_CHANNEL_ID
    store(ctx, finalId, title, body, channel, timestampMs, false, 0, 0)
    arm(ctx, finalId, title, body, channel, timestampMs, false, 0, 0)
    return finalId
  }

  fun scheduleDaily(
    ctx: Context,
    id: String?,
    title: String,
    body: String,
    channelId: String?,
    hour: Int,
    minute: Int,
  ): String {
    val finalId = id ?: UUID.randomUUID().toString()
    val channel = channelId ?: DEFAULT_CHANNEL_ID
    val next = nextDailyAt(hour, minute)
    store(ctx, finalId, title, body, channel, next, true, hour, minute)
    arm(ctx, finalId, title, body, channel, next, true, hour, minute)
    return finalId
  }

  fun cancel(ctx: Context, id: String) {
    val alarmManager = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val intent = Intent(ctx, AlarmReceiver::class.java).putExtra(EXTRA_ID, id)
    val operation = PendingIntent.getBroadcast(
      ctx,
      id.hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    alarmManager.cancel(operation)
    operation.cancel()
    prefs(ctx).edit().remove(id).apply()
  }

  fun cancelAll(ctx: Context) {
    list(ctx).forEach { cancel(ctx, it) }
  }

  fun list(ctx: Context): List<String> = prefs(ctx).all.keys.toList()

  fun complete(ctx: Context, id: String) {
    prefs(ctx).edit().remove(id).apply()
  }

  fun nextDailyAt(hour: Int, minute: Int): Long {
    val now = java.util.Calendar.getInstance()
    val next = (now.clone() as java.util.Calendar).apply {
      set(java.util.Calendar.HOUR_OF_DAY, hour)
      set(java.util.Calendar.MINUTE, minute)
      set(java.util.Calendar.SECOND, 0)
      set(java.util.Calendar.MILLISECOND, 0)
    }
    if (!next.after(now)) next.add(java.util.Calendar.DAY_OF_YEAR, 1)
    return next.timeInMillis
  }
}
