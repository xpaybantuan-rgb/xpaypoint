package id.xpaypoint.paymentlistener

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

class MainActivity : Activity() {
    private val prefs by lazy { getSharedPreferences("listener_config", MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(36, 36, 36, 36)
        }
        layout.addView(TextView(this).apply {
            text = "XPAYPOINT Payment Listener\n\nMeneruskan notifikasi merchant sebagai kandidat transaksi yang BELUM TERVERIFIKASI."
            textSize = 18f
        })
        val endpoint = EditText(this).apply {
            hint = "URL endpoint listener dari admin"
            setText(prefs.getString("endpoint", "https://xpayway-payment-engine.xpaybantuan.workers.dev/v1/payment/listener/notification"))
        }
        val token = EditText(this).apply {
            hint = "Device token dari admin"
            setText(prefs.getString("token", ""))
        }
        layout.addView(endpoint)
        layout.addView(token)
        layout.addView(Button(this).apply {
            text = "Simpan konfigurasi"
            setOnClickListener {
                prefs.edit()
                    .putString("endpoint", endpoint.text.toString().trim())
                    .putString("token", token.text.toString().trim())
                    .apply()
                text = "Tersimpan"
            }
        })
        layout.addView(Button(this).apply {
            text = "Aktifkan akses notifikasi"
            setOnClickListener {
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            }
        })
        layout.addView(TextView(this).apply {
            text = "\nPilih XPAYPOINT Payment Listener pada pengaturan akses notifikasi Android. Jangan aktifkan auto-delivery dari notifikasi saja."
            textSize = 14f
        })
        setContentView(layout)
    }

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
