package id.xpaypoint.paymentlistener

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class NotificationForwardWorker(
    context: Context,
    params: WorkerParameters
) : Worker(context, params) {
    private val client = OkHttpClient.Builder()
        .callTimeout(12, TimeUnit.SECONDS)
        .build()

    override fun doWork(): Result {
        val prefs = applicationContext.getSharedPreferences("listener_config", Context.MODE_PRIVATE)
        val endpoint = prefs.getString("endpoint", "").orEmpty()
        val token = prefs.getString("token", "").orEmpty()
        if (!endpoint.startsWith("https://") || token.isBlank()) return Result.failure()

        val payload = JSONObject().apply {
            put("sourcePackage", inputData.getString("sourcePackage").orEmpty())
            put("title", inputData.getString("title").orEmpty())
            put("text", inputData.getString("text").orEmpty())
            put("bigText", inputData.getString("bigText").orEmpty())
            put("receivedAt", inputData.getLong("receivedAt", 0L))
            put("notificationKey", inputData.getString("notificationKey").orEmpty())
            put("verification", "unverified_notification_candidate")
        }

        val request = Request.Builder()
            .url(endpoint)
            .header("X-Listener-Token", token)
            .post(payload.toString().toRequestBody("application/json".toMediaType()))
            .build()

        return try {
            client.newCall(request).execute().use { response ->
                when {
                    response.isSuccessful -> Result.success()
                    response.code == 408 || response.code == 429 || response.code >= 500 -> Result.retry()
                    else -> Result.failure()
                }
            }
        } catch (_: Exception) {
            Result.retry()
        }
    }
}
