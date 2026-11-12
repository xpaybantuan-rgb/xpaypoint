package id.xpaypoint.paymentlistener

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import java.security.MessageDigest

class MerchantNotificationListener : NotificationListenerService() {
    // Package names are provisional until confirmed from the real notification source.
    private val merchantPackages = setOf("id.dana", "com.gojek.app")

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName !in merchantPackages) return

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
                "sourcePackage" to sbn.packageName,
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
}
