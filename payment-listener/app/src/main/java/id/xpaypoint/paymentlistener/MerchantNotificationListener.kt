package id.xpaypoint.paymentlistener

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import java.security.MessageDigest
import java.util.Locale

class MerchantNotificationListener : NotificationListenerService() {
    private val merchantPackages = setOf("id.dana", "com.gojek.gopaymerchant")

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val packageName = sbn.packageName
        val label = appLabel(packageName)
        // Store source metadata only (package + app label); never store other apps' notification text.
        getSharedPreferences("listener_config", MODE_PRIVATE).edit()
            .putString("last_notification_package", packageName)
            .putString("last_notification_label", label)
            .putLong("last_notification_time", sbn.postTime)
            .apply()

        if (packageName !in merchantPackages) {
            rememberPossibleMerchantApp(packageName, label)
            return
        }

        val extras = sbn.notification.extras
        val title = extras.getCharSequence("android.title")?.toString().orEmpty()
        val text = extras.getCharSequence("android.text")?.toString().orEmpty()
        val bigText = extras.getCharSequence("android.bigText")?.toString().orEmpty()
        if (title.isBlank() && text.isBlank() && bigText.isBlank()) return

        val keySource = "${sbn.packageName}|${sbn.postTime}|${sbn.id}|$title|$text|$bigText"
        val key = MessageDigest.getInstance("SHA-256")
            .digest(keySource.toByteArray())
            .joinToString("") { "%02x".format(it) }

        val work = OneTimeWorkRequestBuilder<NotificationForwardWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInputData(androidx.work.workDataOf(
                "sourcePackage" to packageName,
                "title" to title.take(500),
                "text" to text.take(2000),
                "bigText" to bigText.take(4000),
                "receivedAt" to sbn.postTime,
                "notificationKey" to key
            ))
            .build()

        WorkManager.getInstance(applicationContext)
            .enqueueUniqueWork("merchant-notification-$key", ExistingWorkPolicy.KEEP, work)
    }

    private fun appLabel(packageName: String): String = try {
        val info = packageManager.getApplicationInfo(packageName, 0)
        packageManager.getApplicationLabel(info).toString()
    } catch (_: Exception) {
        packageName
    }

    private fun rememberPossibleMerchantApp(packageName: String, label: String) {
        val searchable = "$packageName $label".lowercase(Locale.ROOT)
        if (listOf("dana", "gojek", "gopay", "merchant").none { searchable.contains(it) }) return
        getSharedPreferences("listener_config", MODE_PRIVATE).edit()
            .putString("last_detected_package", packageName)
            .putString("last_detected_label", label)
            .apply()
    }
}
