package pt.basecom.crm

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * Um só ecrã: emparelhar com o CRM (código de 6 algarismos que aparece no CRM, em «Telemóvel»),
 * dar as autorizações e deixar a app a trabalhar em segundo plano.
 */
class MainActivity : Activity() {
    private lateinit var api: Api
    private lateinit var status: TextView
    private lateinit var codeInput: EditText
    private lateinit var serverInput: EditText

    private val perms = buildList {
        add(Manifest.permission.CALL_PHONE)
        add(Manifest.permission.READ_PHONE_STATE)
        add(Manifest.permission.READ_CALL_LOG)
        if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
    }.toTypedArray()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        api = Api(this)
        val pad = (20 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad * 2, pad, pad) }
        fun label(t: String, size: Float = 15f, bold: Boolean = false, color: Int = Color.parseColor("#0B0B0B")) = TextView(this).apply {
            text = t; textSize = size; setTextColor(color); if (bold) typeface = Typeface.DEFAULT_BOLD; setPadding(0, pad / 3, 0, pad / 3)
        }
        root.addView(label("BASECOM", 28f, true, Color.parseColor("#FF5A00")))
        root.addView(label("Liga as chamadas pedidas pelo CRM e informa o fim, a duração e as chamadas recebidas."))
        status = label("", 16f, true)
        root.addView(status)

        serverInput = EditText(this).apply { setText(api.server); inputType = InputType.TYPE_TEXT_VARIATION_URI; hint = "Servidor" }
        codeInput = EditText(this).apply { inputType = InputType.TYPE_CLASS_NUMBER; hint = "Código de 6 algarismos (CRM → Telemóvel)"; textSize = 22f; gravity = Gravity.CENTER }
        root.addView(label("1. No CRM, carregue em «Telemóvel» e escreva aqui o código:", 14f))
        root.addView(codeInput, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        root.addView(Button(this).apply { text = "Emparelhar"; setOnClickListener { pair() } })
        root.addView(label("2. Autorizações (chamadas, estado do telefone, registo de chamadas, notificações):", 14f))
        root.addView(Button(this).apply { text = "Dar autorizações"; setOnClickListener { requestPermissions(perms, 1) } })
        root.addView(label("3. Para não ser fechada pelo telemóvel, deixe a app trabalhar sem restrições de bateria:", 14f))
        root.addView(Button(this).apply { text = "Sem restrições de bateria"; setOnClickListener { askBattery() } })
        root.addView(label("Servidor", 12f, color = Color.GRAY))
        root.addView(serverInput, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        root.addView(Button(this).apply { text = "Desemparelhar este telemóvel"; setOnClickListener { api.token = null; stopService(Intent(this@MainActivity, PhoneService::class.java)); refresh() } })
        setContentView(ScrollView(this).apply { addView(root) })
        refresh()
    }

    override fun onResume() { super.onResume(); refresh() }

    private fun missingPerms() = perms.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }

    private fun refresh() {
        val t = api.token
        status.text = when {
            t == null -> "Por emparelhar com o CRM."
            missingPerms().isNotEmpty() -> "Emparelhado (${api.userName}). Faltam autorizações: carregue em «Dar autorizações»."
            else -> "Pronto: emparelhado com ${api.userName}. Pode fechar esta janela."
        }
        status.setTextColor(if (t != null && missingPerms().isEmpty()) Color.parseColor("#1E6F33") else Color.parseColor("#A1000F"))
        if (t != null && missingPerms().isEmpty()) PhoneService.start(this)
    }

    private fun pair() {
        val code = codeInput.text.toString().trim()
        if (!Regex("^\\d{6}$").matches(code)) { status.text = "O código tem 6 algarismos."; return }
        api.server = serverInput.text.toString().ifBlank { "https://crm.basecom.pt" }
        status.text = "A emparelhar…"
        Thread {
            val msg = try { "Emparelhado com " + api.pair(code, "${Build.MANUFACTURER} ${Build.MODEL}") } catch (e: Exception) { "Não foi possível: ${e.message}" }
            runOnUiThread { status.text = msg; codeInput.setText(""); refresh(); if (missingPerms().isNotEmpty()) requestPermissions(perms, 1) }
        }.start()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        refresh()
    }

    private fun askBattery() {
        val pm = getSystemService(PowerManager::class.java)
        if (pm.isIgnoringBatteryOptimizations(packageName)) { status.text = "Já está sem restrições de bateria."; return }
        try {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        } catch (_: Exception) {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }
}
