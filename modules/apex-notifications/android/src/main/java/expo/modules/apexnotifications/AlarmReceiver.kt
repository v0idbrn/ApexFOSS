package expo.modules.apexnotifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Manifest-declared receiver (survives process death; no FCM involved).
 * Posts the notification and re-arms daily reminders so the chain continues
 * without the app being open. After a device reboot alarms are gone — the
 * reminder resync on next app open recreates them (documented limitation).
 */
class AlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra(AlarmScheduler.EXTRA_ID) ?: return
    val title = intent.getStringExtra(AlarmScheduler.EXTRA_TITLE) ?: return
    val body = intent.getStringExtra(AlarmScheduler.EXTRA_BODY) ?: ""
    val channel = intent.getStringExtra(AlarmScheduler.EXTRA_CHANNEL)
      ?: AlarmScheduler.DEFAULT_CHANNEL_ID
    val daily = intent.getBooleanExtra(AlarmScheduler.EXTRA_DAILY, false)
    val hour = intent.getIntExtra(AlarmScheduler.EXTRA_HOUR, 0)
    val minute = intent.getIntExtra(AlarmScheduler.EXTRA_MINUTE, 0)

    post(context, id, title, body, channel)
    if (daily) {
      AlarmScheduler.scheduleDaily(context, id, title, body, channel, hour, minute)
    } else {
      AlarmScheduler.complete(context, id)
    }
  }

  private fun post(context: Context, id: String, title: String, body: String, channelId: String) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(channelId) == null) {
        val label = context.applicationInfo.loadLabel(context.packageManager).toString()
        manager.createNotificationChannel(
          NotificationChannel(channelId, label, NotificationManager.IMPORTANCE_HIGH).apply {
            enableVibration(true)
            setShowBadge(true)
          },
        )
      }
    }

    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val contentIntent = launch?.let {
      PendingIntent.getActivity(
        context,
        id.hashCode() xor 0x600,
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    val notification = NotificationCompat.Builder(context, channelId)
      .setSmallIcon(context.applicationInfo.icon)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
      .apply { if (contentIntent != null) setContentIntent(contentIntent) }
      .build()

    NotificationManagerCompat.from(context).notify(id.hashCode(), notification)
  }
}
