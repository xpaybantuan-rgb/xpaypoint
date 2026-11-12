package id.xpaypoint.paymentlistener

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

class MainActivity : Activity() {
    private val prefs by lazy { getSharedPreferences("listener_config", MODE_PRIVATE) }
    private lateinit var statusView: TextView

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
    }

    private fun refreshStatus() {
        val access = if (hasNotificationAccess(this)) "AKTIF" else "BELUM AKTIF"
        val pkg = prefs.getString("last_detected_package", null)
        val label = prefs.getString("last_detected_label", null)
        val detection = if (pkg.isNullOrBlank()) {
            "Belum ada notifikasi DANA/GoPay yang terdeteksi."
        } else {
            "Aplikasi terdeteksi: $label\nPackage: $pkg"
        }
        statusView.text = "Akses notifikasi: $access\n$detection"
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
