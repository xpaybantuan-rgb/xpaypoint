package id.xpaypoint.paymentlistener

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

class MerchantNotificationListener : NotificationListenerService() {
    private val client = OkHttpClient.Builder()
        .callTimeout(8, TimeUnit.SECONDS)
        .build()

    // Package allow-list only. Notification content is forwarded as untrusted text.
    private val merchantPackages = setOf(
        "id.dana",
        "com.gojek.app"
    )

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName !in merchantPackages) return

        val extras = sbn.notification.extras
        val title = extras.getCharSequence("android.title")?.toString().orEmpty()
        val text = extras.getCharSequence("android.text")?.toString().orEmpty()
        val bigText = extras.getCharSequence("android.bigText")?.toString().orEmpty()
        if (title.isBlank() && text.isBlank() && bigText.isBlank()) return

        val keySource = "${sbn.packageName}| ${sbn.postTime}|$title|$text|$bigText"
        val key = MessageDigest.getInstance("SHA-256")
            .digest(keySource.toByteArray())
            .joinToString("") { "%02x".format(it) }

        val prefs = getSharedPreferences("listener_config", MODE_PRIVATE)
        val endpoint = prefs.getString("endpoint", "").orEmpty()
        val token = prefs.getString("token", "").orEmpty()
        if (!endpoint.startsWith("https://") || token.isBlank()) return

        val payload = JSONObject().apply {
            put("sourcePackage", sbn.packageName)
            put("title", title.take(500))
            put("text", text.take(2000))
            put("bigText", bigText.take(4000))
            put("receivedAt", sbn.postTime)
            put("notificationKey", key)
            put("verification", "unverified_notification_candidate")
        }

        val request = Request.Builder()
            .url(endpoint)
            .header("X-Listener-Token", token)
            .post(payload.toString().toRequestBody("application/json".toMediaType()))
            .build()

        // Best-effort prototype: no automatic payment confirmation on network success.
        runCatching {
            client.newCall(request).execute().use { response ->
                // Backend response intentionally does not affect payment state.
                response.code
            }
        }
    }
}
