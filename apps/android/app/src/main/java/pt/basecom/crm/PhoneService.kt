package pt.basecom.crm

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.CallLog
import android.telecom.TelecomManager
import android.telephony.TelephonyManager
import org.json.JSONObject
import java.time.Instant
import java.util.concurrent.Executors

/**
 * Trabalha em segundo plano (com uma notificação fixa, como o Android exige):
 * 1. pergunta ao CRM se há uma chamada para fazer e marca-a;
 * 2. quando a chamada acaba, lê a duração no registo de chamadas e informa o CRM (duração > 0 = atendida);
 * 3. nas chamadas recebidas, informa o CRM do número (o CRM mostra «Chamada a entrar» com a ficha).
 */
class PhoneService : Service() {
    companion object {
        private const val CHANNEL = "basecom"
        fun start(ctx: Context) {
            val i = Intent(ctx, PhoneService::class.java)
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
        }
    }

    private lateinit var api: Api
    private val events = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var running = false

    // Chamada pedida pelo CRM em curso.
    @Volatile private var outCallId: String? = null
    @Volatile private var outOffhook = false
    @Volatile private var outPlacedAt = 0L
    // Chamada recebida em curso.
    @Volatile private var inId: String? = null
    @Volatile private var inNumber: String? = null
    @Volatile private var inRinging = false

    private val stateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return
            @Suppress("DEPRECATION")
            val number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
            onState(state, number)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        api = Api(this)
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel(CHANNEL, "Ligação ao CRM", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else @Suppress("DEPRECATION") Notification.Builder(this))
            .setContentTitle("BASECOM ligado ao CRM")
            .setContentText("As chamadas pedidas no CRM são marcadas neste telemóvel.")
            .setSmallIcon(android.R.drawable.stat_sys_phone_call)
            .setColor(0xFFFF5A00.toInt())
            .setContentIntent(open)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE) else startForeground(1, n)
        val filter = IntentFilter(TelephonyManager.ACTION_PHONE_STATE_CHANGED)
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(stateReceiver, filter, Context.RECEIVER_EXPORTED) else registerReceiver(stateReceiver, filter)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!running && api.token != null) {
            running = true
            Thread({ loop() }, "basecom-crm").start()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        try { unregisterReceiver(stateReceiver) } catch (_: Exception) {}
        super.onDestroy()
    }

    /** Versão nova da app: aviso uma vez por versão (tocar abre a transferência). Vê de 6 em 6 horas. */
    private var lastUpdateCheck = 0L
    private fun checkUpdate() {
        if (System.currentTimeMillis() - lastUpdateCheck < 6 * 3_600_000L) return
        lastUpdateCheck = System.currentTimeMillis()
        val v = api.latestVersion() ?: return
        val installed = if (Build.VERSION.SDK_INT >= 28) packageManager.getPackageInfo(packageName, 0).longVersionCode else @Suppress("DEPRECATION") packageManager.getPackageInfo(packageName, 0).versionCode.toLong()
        val prefs = getSharedPreferences("basecom", MODE_PRIVATE)
        if (v.first <= installed || prefs.getLong("updateNotified", 0) == v.first) return
        prefs.edit().putLong("updateNotified", v.first).apply()
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel("update", "Atualizações da app", NotificationManager.IMPORTANCE_DEFAULT))
        val pi = PendingIntent.getActivity(this, 7, Intent(Intent.ACTION_VIEW, Uri.parse(api.apkUrl)), PendingIntent.FLAG_IMMUTABLE)
        val n = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, "update") else @Suppress("DEPRECATION") Notification.Builder(this))
            .setContentTitle("Nova versão da app BASECOM (${v.second})")
            .setContentText("Toque para descarregar e instalar.")
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setColor(0xFFFF5A00.toInt())
            .setContentIntent(pi).setAutoCancel(true).build()
        if (Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) nm.notify(7, n)
    }

    /** Ciclo principal: espera por pedidos do CRM; em falha de rede, volta a tentar com pausa crescente. */
    private fun loop() {
        var backoff = 2_000L
        while (running && api.token != null) {
            try {
                checkUpdate()
                val cmd = api.next()
                backoff = 2_000L
                if (cmd != null) main.post {
                    when (cmd.optString("kind")) {
                        "hangup" -> hangUp()
                        "sms" -> openSms(cmd.getString("number"), cmd.optString("text"))
                        else -> dial(cmd.getString("number"), cmd.optString("callId").ifBlank { null })
                    }
                }
            } catch (e: Api.HttpError) {
                if (e.status == 401) { api.token = null; running = false; stopSelf(); return }
                Thread.sleep(backoff); backoff = (backoff * 2).coerceAtMost(30_000)
            } catch (_: Exception) {
                Thread.sleep(backoff); backoff = (backoff * 2).coerceAtMost(30_000)
            }
        }
    }

    /**
     * SMS pedida no CRM: abre a app de mensagens com o número e o texto (o comercial carrega em enviar).
     * Como o Android não deixa abrir ecrãs a partir de segundo plano, aparece também um aviso: tocar nele abre a mensagem.
     */
    private fun openSms(number: String, text: String) {
        val intent = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:$number")).putExtra("sms_body", text).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { startActivity(intent) } catch (_: Exception) {}
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel("sms", "SMS do CRM", NotificationManager.IMPORTANCE_HIGH))
        val pi = PendingIntent.getActivity(this, number.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, "sms") else @Suppress("DEPRECATION") Notification.Builder(this))
            .setContentTitle("SMS para $number")
            .setContentText("Toque para abrir a mensagem e enviar.")
            .setSmallIcon(android.R.drawable.sym_action_chat)
            .setColor(0xFFFF5A00.toInt())
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build()
        if (Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) nm.notify(number.hashCode(), n)
    }

    private fun dial(number: String, callId: String?) {
        if (checkSelfPermission(Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED) return
        outCallId = callId; outOffhook = false; outPlacedAt = System.currentTimeMillis()
        try {
            getSystemService(TelecomManager::class.java).placeCall(Uri.fromParts("tel", number, null), Bundle())
        } catch (_: Exception) {
            startActivity(Intent(Intent.ACTION_CALL, Uri.fromParts("tel", number, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        // Se a chamada nunca chegar a começar (sem rede, cancelada), fecha-a ao fim de 60 s.
        main.postDelayed({ if (outCallId == callId && !outOffhook) finishOutgoing(0) }, 60_000)
    }

    /** «Desligar» no CRM: termina a chamada em curso (precisa da autorização de atender/terminar chamadas). */
    @Suppress("DEPRECATION")
    private fun hangUp() {
        if (checkSelfPermission(Manifest.permission.ANSWER_PHONE_CALLS) != PackageManager.PERMISSION_GRANTED) return
        try { getSystemService(TelecomManager::class.java).endCall() } catch (_: Exception) {}
    }

    private fun onState(state: String, number: String?) {
        when (state) {
            TelephonyManager.EXTRA_STATE_RINGING -> {
                if (outCallId != null || number.isNullOrBlank() || inRinging) return
                inRinging = true; inNumber = number
                events.execute {
                    try {
                        val r = api.event(JSONObject().put("type", "incoming_ringing").put("number", number).put("at", Instant.now().toString()))
                        inId = r.optString("incomingId").ifBlank { null }
                    } catch (_: Exception) {}
                }
            }
            TelephonyManager.EXTRA_STATE_OFFHOOK -> if (outCallId != null) outOffhook = true
            TelephonyManager.EXTRA_STATE_IDLE -> {
                if (outCallId != null && outOffhook) main.postDelayed({ finishOutgoing(null) }, 2_000)
                if (inRinging) {
                    val n = inNumber
                    inRinging = false
                    main.postDelayed({ finishIncoming(n) }, 2_000)
                }
            }
        }
    }

    /** Duração da última chamada no registo do telemóvel (0 = não atendida). */
    private fun lastDuration(type: Int, number: String?): Int {
        if (checkSelfPermission(Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) return 0
        return try {
            contentResolver.query(CallLog.Calls.CONTENT_URI, arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DURATION),
                null, null, CallLog.Calls.DATE + " DESC")?.use { c ->
                var checked = 0
                while (c.moveToNext() && checked < 5) {
                    checked++
                    val t = c.getInt(1)
                    val n = c.getString(0) ?: ""
                    val sameNumber = number == null || n.filter { it.isDigit() }.takeLast(9) == number.filter { it.isDigit() }.takeLast(9)
                    if (sameNumber && (t == type || (type == CallLog.Calls.INCOMING_TYPE && t == CallLog.Calls.MISSED_TYPE))) return c.getInt(2)
                }
                0
            } ?: 0
        } catch (_: Exception) { 0 }
    }

    private fun finishOutgoing(forced: Int?) {
        val id = outCallId ?: return
        outCallId = null; outOffhook = false
        val duration = forced ?: lastDuration(CallLog.Calls.OUTGOING_TYPE, null)
        events.execute {
            for (attempt in 1..3) {
                try {
                    api.event(JSONObject().put("type", "outgoing_ended").put("callId", id).put("endedAt", Instant.now().toString()).put("durationSeconds", duration))
                    break
                } catch (_: Exception) { Thread.sleep(2_000L * attempt) }
            }
        }
    }

    private fun finishIncoming(number: String?) {
        val duration = lastDuration(CallLog.Calls.INCOMING_TYPE, number)
        events.execute {
            // O aviso de chamada a entrar pode ainda estar a ser enviado: espera um pouco pelo id.
            var tries = 0
            while (inId == null && tries++ < 5) Thread.sleep(500)
            val id = inId ?: return@execute
            inId = null; inNumber = null
            try { api.event(JSONObject().put("type", "incoming_ended").put("incomingId", id).put("endedAt", Instant.now().toString()).put("durationSeconds", duration)) } catch (_: Exception) {}
        }
    }
}
