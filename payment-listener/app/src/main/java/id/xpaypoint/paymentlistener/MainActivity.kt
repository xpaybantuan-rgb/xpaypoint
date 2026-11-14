package id.xpaypoint.paymentlistener

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.ViewGroup
import android.widget.ScrollView
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Switch
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : Activity() {
    private val prefs by lazy { getSharedPreferences("listener_config", MODE_PRIVATE) }
    private lateinit var statusView: TextView
    private lateinit var updateView: TextView
    private var openedInstallSettings = false
    private var updateCheckInProgress = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(22, 26, 22, 28)
            setBackgroundColor(Color.rgb(245, 247, 251))
        }
        val scroll = ScrollView(this).apply { isFillViewport = true; addView(page) }

        page.addView(TextView(this).apply {
            text = "XPAYPOINT"
            textSize = 13f
            setTextColor(Color.rgb(28, 91, 190))
            letterSpacing = 0.16f
        })
        page.addView(TextView(this).apply {
            text = "Payment Listener"
            textSize = 27f
            setTextColor(Color.rgb(20, 29, 48))
            setPadding(0, 3, 0, 5)
        })
        page.addView(TextView(this).apply {
            text = "Pemantau notifikasi merchant untuk membantu pemeriksaan transaksi."
            textSize = 14f
            setTextColor(Color.rgb(91, 103, 122))
        })

        statusView = TextView(this).apply {
            textSize = 14f
            setTextColor(Color.rgb(35, 48, 68))
            setPadding(16, 16, 16, 16)
            background = panelBackground()
        }
        page.addView(statusView, sectionParams())

        page.addView(sectionHeading("Koneksi server"))
        val endpoint = EditText(this).apply {
            hint = "URL endpoint HTTPS"
            setSingleLine(true)
            setText(prefs.getString("endpoint", "https://xpayway-payment-engine.xpaybantuan.workers.dev/v1/payment/listener/notification"))
        }
        val token = EditText(this).apply {
            hint = "Device token dari admin"
            setSingleLine(true)
            setText(prefs.getString("token", ""))
        }
        val configPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(14, 8, 14, 14)
            background = panelBackground()
            addView(endpoint, fieldParams())
            addView(token, fieldParams())
            addView(Button(this@MainActivity).apply {
                text = "Simpan konfigurasi"
                setOnClickListener {
                    val url = endpoint.text.toString().trim()
                    val secret = token.text.toString().trim()
                    if (!url.startsWith("https://") || secret.isBlank()) {
                        statusView.text = "Konfigurasi belum lengkap. Gunakan URL HTTPS dan device token."
                    } else {
                        prefs.edit().putString("endpoint", url).putString("token", secret).apply()
                        statusView.text = statusSummary()
                    }
                }
            })
        }
        page.addView(configPanel, sectionParams())

        page.addView(sectionHeading("Akses notifikasi"))
        page.addView(Button(this).apply {
            text = "Buka pengaturan akses notifikasi"
            setOnClickListener { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
        }, sectionParams())

        page.addView(sectionHeading("Privasi dan pengiriman"))
        page.addView(TextView(this).apply {
            text = "Secara default, isi notifikasi tetap di perangkat. Aktifkan izin di bawah hanya jika lu setuju detail notifikasi merchant dikirim ke server XPAYPOINT."
            textSize = 13f
            setTextColor(Color.rgb(91, 103, 122))
            setPadding(0, 0, 0, 10)
        })
        page.addView(Switch(this).apply {
            text = "Izinkan kirim detail notifikasi merchant"
            textSize = 14f
            setTextColor(Color.rgb(35, 48, 68))
            isChecked = prefs.getBoolean("forward_notifications_enabled", false)
            setOnCheckedChangeListener { _, checked ->
                prefs.edit().putBoolean("forward_notifications_enabled", checked).apply()
                refreshStatus()
            }
        }, sectionParams())

        page.addView(sectionHeading("Pembaruan aplikasi"))
        updateView = TextView(this).apply {
            text = "Pengecekan versi melalui GitHub Releases."
            textSize = 13f
            setTextColor(Color.rgb(91, 103, 122))
            setPadding(0, 0, 0, 8)
        }
        page.addView(updateView)
        page.addView(Button(this).apply {
            text = "Periksa update sekarang"
            setOnClickListener { checkForUpdate() }
        }, sectionParams())

        page.addView(TextView(this).apply {
            text = "PENTING\\nNotifikasi Android hanya kandidat informasi. Aplikasi ini tidak memverifikasi pembayaran, tidak menandai pesanan lunas, dan tidak memicu top-up otomatis."
            textSize = 12f
            setTextColor(Color.rgb(135, 77, 20))
            setPadding(14, 14, 14, 14)
            background = warningBackground()
        })
        setContentView(scroll)
        refreshStatus()
        val lastCheck = prefs.getLong("last_update_check_at", 0L)
        if (System.currentTimeMillis() - lastCheck >= 24L * 60L * 60L * 1000L) checkForUpdate()
    }

    override fun onResume() {
        super.onResume()
        if (::statusView.isInitialized) refreshStatus()
        if (openedInstallSettings) {
            openedInstallSettings = false
            if (android.os.Build.VERSION.SDK_INT < 26 || packageManager.canRequestPackageInstalls()) {
                installPendingApkIfAllowed()
            } else {
                updateView.text = "Izin instalasi belum diaktifkan. Aktifkan izin tersebut, lalu tekan Periksa Update lagi."
            }
            return
        }
    }

    private fun checkForUpdate() {
        if (updateCheckInProgress) return
        updateCheckInProgress = true
        updateView.text = "Memeriksa versi terbaru..."
        Thread {
            var releaseConnection: HttpURLConnection? = null
            try {
                val api = URL("https://api.github.com/repos/xpaybantuan-rgb/xpaypoint/releases/latest")
                val connection = (api.openConnection() as HttpURLConnection).apply {
                    connectTimeout = 12000
                    readTimeout = 12000
                    setRequestProperty("Accept", "application/vnd.github+json")
                    setRequestProperty("User-Agent", "XPAYPOINT-Payment-Listener")
                }
                releaseConnection = connection
                val responseCode = connection.responseCode
                if (responseCode !in 200..299) {
                    throw IllegalStateException("GitHub merespons HTTP $responseCode.")
                }
                val releaseText = connection.inputStream.bufferedReader().use { it.readText() }
                connection.disconnect()
                releaseConnection = null
                val release = JSONObject(releaseText)
                val tag = release.optString("tag_name")
                val latestCode = tag.substringAfterLast("-v").toIntOrNull()
                    ?: throw IllegalStateException("Nomor versi rilis tidak valid.")
                val currentCode = if (android.os.Build.VERSION.SDK_INT >= 28) {
                    packageManager.getPackageInfo(packageName, 0).longVersionCode.toInt()
                } else {
                    @Suppress("DEPRECATION")
                    packageManager.getPackageInfo(packageName, 0).versionCode
                }
                if (latestCode <= currentCode) {
                    prefs.edit().putLong("last_update_check_at", System.currentTimeMillis()).apply()
                    runOnUiThread { updateView.text = "Aplikasi sudah versi terbaru (versi $currentCode)." }
                    return@Thread
                }
                val assets = release.getJSONArray("assets")
                var downloadUrl: String? = null
                var expectedDigest: String? = null
                for (i in 0 until assets.length()) {
                    val asset = assets.getJSONObject(i)
                    if (asset.optString("name") == "xpaypoint-payment-listener.apk") {
                        downloadUrl = asset.optString("browser_download_url")
                        expectedDigest = asset.optString("digest").takeIf { it.isNotBlank() && it != "null" }
                        break
                    }
                }
                val apkUrl = downloadUrl ?: throw IllegalStateException("File APK belum tersedia pada rilis terbaru.")
                val digest = expectedDigest ?: throw IllegalStateException("Checksum APK dari GitHub tidak tersedia; update dibatalkan demi keamanan.")
                if (!digest.matches(Regex("sha256:[a-fA-F0-9]{64}"))) {
                    throw IllegalStateException("Format checksum APK dari GitHub tidak valid.")
                }
                runOnUiThread { updateView.text = "Update versi $latestCode ditemukan. Mengunduh..." }
                val apkConnection = (URL(apkUrl).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 15000
                    readTimeout = 30000
                    instanceFollowRedirects = true
                    setRequestProperty("User-Agent", "XPAYPOINT-Payment-Listener")
                }
                val apk = File(cacheDir, "xpaypoint-payment-listener-update.apk")
                try {
                    apkConnection.inputStream.use { input -> apk.outputStream().use { output -> input.copyTo(output) } }
                } finally {
                    apkConnection.disconnect()
                }
                if (!apk.exists() || apk.length() < 500_000) {
                    throw IllegalStateException("Unduhan APK tidak lengkap.")
                }
                val actualDigest = java.security.MessageDigest.getInstance("SHA-256")
                    .digest(apk.readBytes())
                    .joinToString("") { "%02x".format(it) }
                if (!actualDigest.equals(digest.removePrefix("sha256:"), ignoreCase = true)) {
                    apk.delete()
                    throw IllegalStateException("Checksum APK tidak cocok. File update ditolak.")
                }
                prefs.edit()
                    .putString("pending_update_apk", apk.absolutePath)
                    .putLong("last_update_check_at", System.currentTimeMillis())
                    .apply()
                runOnUiThread {
                    updateView.text = "Update selesai diunduh. Menyiapkan instalasi..."
                    installPendingApkIfAllowed()
                }
            } catch (e: Exception) {
                runOnUiThread { updateView.text = "Gagal memeriksa update: ${e.message ?: "koneksi bermasalah"}" }
            } finally {
                releaseConnection?.disconnect()
                runOnUiThread { updateCheckInProgress = false }
            }
        }.start()
    }

    private fun installPendingApkIfAllowed() {
        val path = prefs.getString("pending_update_apk", null) ?: return
        val apk = File(path)
        if (!apk.exists()) {
            prefs.edit().remove("pending_update_apk").apply()
            return
        }
        if (android.os.Build.VERSION.SDK_INT >= 26 && !packageManager.canRequestPackageInstalls()) {
            updateView.text = "Izinkan pemasangan aplikasi dari sumber ini, lalu kembali ke XPAYPOINT Listener."
            if (!openedInstallSettings) {
                openedInstallSettings = true
                startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
            }
            return
        }
        try {
            val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", apk)
            val install = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            prefs.edit().remove("pending_update_apk").apply()
            startActivity(install)
        } catch (e: Exception) {
            updateView.text = "Tidak bisa membuka pemasang APK: ${e.message}"
        }
    }

    private fun refreshStatus() {
        statusView.text = statusSummary()
    }

    private fun statusSummary(): String {
        val access = if (hasNotificationAccess(this)) "AKTIF" else "BELUM AKTIF"
        val forwarding = if (prefs.getBoolean("forward_notifications_enabled", false)) "DIIZINKAN" else "NONAKTIF"
        val pkg = prefs.getString("last_detected_package", null)
        val label = prefs.getString("last_detected_label", null)
        val detection = if (pkg.isNullOrBlank()) "Belum ada aplikasi merchant yang terdeteksi." else "$label\\n$pkg"
        val sourcePackage = prefs.getString("last_notification_package", null)
        val sourceLabel = prefs.getString("last_notification_label", null)
        val sourceTime = prefs.getLong("last_notification_time", 0L)
        val source = if (sourcePackage.isNullOrBlank()) "Belum ada notifikasi yang diterima Android." else {
            val time = SimpleDateFormat("dd-MM-yyyy HH:mm:ss", Locale.getDefault()).format(Date(sourceTime))
            "$sourceLabel\\n$time"
        }
        return "AKSES NOTIFIKASI: $access\\nPENGIRIMAN DETAIL: $forwarding\\n\\nAPLIKASI MERCHANT TERDETEKSI\\n$detection\\n\\nNOTIFIKASI TERAKHIR\\n$source"
    }

    private fun sectionHeading(value: String) = TextView(this).apply {
        text = value
        textSize = 17f
        setTextColor(Color.rgb(20, 29, 48))
        setPadding(0, 10, 0, 9)
    }

    private fun sectionParams() = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
    ).apply { bottomMargin = 16 }

    private fun panelBackground() = GradientDrawable().apply {
        setColor(Color.WHITE)
        cornerRadius = 18f
        setStroke(1, Color.rgb(229, 233, 240))
    }

    private fun warningBackground() = GradientDrawable().apply {
        setColor(Color.rgb(255, 246, 229))
        cornerRadius = 14f
        setStroke(1, Color.rgb(245, 221, 180))
    }

    private fun fieldParams() = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
    ).apply { bottomMargin = 12 }

    companion object {
        fun hasNotificationAccess(activity: Activity): Boolean {
            val expected = ComponentName(activity, MerchantNotificationListener::class.java)
            val enabled = Settings.Secure.getString(
                activity.contentResolver,
                "enabled_notification_listeners"
            ) ?: return false
            return enabled.split(":").any { ComponentName.unflattenFromString(it) == expected }
        }
    }
}
