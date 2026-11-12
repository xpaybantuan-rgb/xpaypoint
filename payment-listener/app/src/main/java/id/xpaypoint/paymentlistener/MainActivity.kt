package id.xpaypoint.paymentlistener

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(36, 36, 36, 36)
        }
        layout.addView(TextView(this).apply {
            text = "XPAYPOINT Payment Listener"
            textSize = 22f
        })
        layout.addView(TextView(this).apply {
            text = "Meneruskan notifikasi merchant ke server sebagai kandidat transaksi yang BELUM TERVERIFIKASI."
            textSize = 14f
        })
        statusView = TextView(this).apply {
            textSize = 14f
            setPadding(0, 28, 0, 20)
        }
        layout.addView(statusView)

        val endpoint = EditText(this).apply {
            hint = "URL endpoint listener"
            setSingleLine(true)
            setText(prefs.getString("endpoint", "https://xpayway-payment-engine.xpaybantuan.workers.dev/v1/payment/listener/notification"))
        }
        val token = EditText(this).apply {
            hint = "Device token dari admin"
            setSingleLine(true)
            setText(prefs.getString("token", ""))
        }
        layout.addView(endpoint, fieldParams())
        layout.addView(token, fieldParams())

        layout.addView(Button(this).apply {
            text = "Simpan konfigurasi"
            setOnClickListener {
                val url = endpoint.text.toString().trim()
                val secret = token.text.toString().trim()
                if (!url.startsWith("https://") || secret.isBlank()) {
                    statusView.text = "Isi endpoint HTTPS dan device token terlebih dahulu."
                } else {
                    prefs.edit().putString("endpoint", url).putString("token", secret).apply()
                    statusView.text = "Konfigurasi tersimpan."
                }
            }
        })
        layout.addView(Button(this).apply {
            text = "Aktifkan akses notifikasi"
            setOnClickListener { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
        })

        updateView = TextView(this).apply {
            text = "Pembaruan aplikasi"
            textSize = 14f
            setPadding(0, 24, 0, 8)
        }
        layout.addView(updateView)
        layout.addView(Button(this).apply {
            text = "Periksa Update"
            setOnClickListener { checkForUpdate() }
        })

        layout.addView(TextView(this).apply {
            text = "\nCatatan keamanan: notifikasi hanya bahan pemeriksaan. Sistem tidak boleh menandai pesanan lunas atau mengirim top-up otomatis dari notifikasi Android."
            textSize = 13f
        })
        setContentView(layout)
        refreshStatus()
    }

    override fun onResume() {
        super.onResume()
        if (::statusView.isInitialized) refreshStatus()
        installPendingApkIfAllowed()
    }

    private fun checkForUpdate() {
        updateView.text = "Memeriksa versi terbaru..."
        Thread {
            try {
                val api = URL("https://api.github.com/repos/xpaybantuan-rgb/xpaypoint/releases/latest")
                val connection = (api.openConnection() as HttpURLConnection).apply {
                    connectTimeout = 12000
                    readTimeout = 12000
                    setRequestProperty("Accept", "application/vnd.github+json")
                    setRequestProperty("User-Agent", "XPAYPOINT-Payment-Listener")
                }
                val releaseText = connection.inputStream.bufferedReader().use { it.readText() }
                connection.disconnect()
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
                    runOnUiThread { updateView.text = "Aplikasi sudah versi terbaru (versi $currentCode)." }
                    return@Thread
                }
                val assets = release.getJSONArray("assets")
                var downloadUrl: String? = null
                for (i in 0 until assets.length()) {
                    val asset = assets.getJSONObject(i)
                    if (asset.optString("name") == "xpaypoint-payment-listener.apk") {
                        downloadUrl = asset.optString("browser_download_url")
                        break
                    }
                }
                val apkUrl = downloadUrl ?: throw IllegalStateException("File APK belum tersedia pada rilis terbaru.")
                runOnUiThread { updateView.text = "Update versi $latestCode ditemukan. Mengunduh..." }
                val apkConnection = (URL(apkUrl).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 15000
                    readTimeout = 30000
                    instanceFollowRedirects = true
                    setRequestProperty("User-Agent", "XPAYPOINT-Payment-Listener")
                }
                val apk = File(cacheDir, "xpaypoint-payment-listener-update.apk")
                apkConnection.inputStream.use { input -> apk.outputStream().use { output -> input.copyTo(output) } }
                apkConnection.disconnect()
                if (!apk.exists() || apk.length() < 500_000) {
                    throw IllegalStateException("Unduhan APK tidak lengkap.")
                }
                prefs.edit().putString("pending_update_apk", apk.absolutePath).apply()
                runOnUiThread {
                    updateView.text = "Update selesai diunduh. Menyiapkan instalasi..."
                    installPendingApkIfAllowed()
                }
            } catch (e: Exception) {
                runOnUiThread { updateView.text = "Gagal memeriksa update: ${e.message ?: "koneksi bermasalah"}" }
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
            startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
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
        val access = if (hasNotificationAccess(this)) "AKTIF" else "BELUM AKTIF"
        val pkg = prefs.getString("last_detected_package", null)
        val label = prefs.getString("last_detected_label", null)
        val detection = if (pkg.isNullOrBlank()) {
            "Belum ada notifikasi DANA/GoPay yang terdeteksi."
        } else {
            "Aplikasi merchant terdeteksi: $label\nPackage: $pkg"
        }
        val sourcePackage = prefs.getString("last_notification_package", null)
        val sourceLabel = prefs.getString("last_notification_label", null)
        val sourceTime = prefs.getLong("last_notification_time", 0L)
        val source = if (sourcePackage.isNullOrBlank()) {
            "Sumber notifikasi terakhir: belum ada notifikasi yang diterima Android."
        } else {
            val time = SimpleDateFormat("dd-MM-yyyy HH:mm:ss", Locale.getDefault()).format(Date(sourceTime))
            "Sumber notifikasi terakhir: $sourceLabel\nPackage: $sourcePackage\nWaktu: $time"
        }
        statusView.text = "Akses notifikasi: $access\n$detection\n\n$source"
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
