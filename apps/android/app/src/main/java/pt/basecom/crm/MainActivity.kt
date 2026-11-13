package pt.basecom.crm

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * Ecrã único da app BASECOM: estado da ligação ao CRM e os 3 passos (emparelhar, autorizações, bateria).
 * Cores e logótipo do Design System BASECOM.
 */
class MainActivity : Activity() {
    private lateinit var api: Api
    private lateinit var statusTitle: TextView
    private lateinit var statusText: TextView
    private lateinit var statusDot: View
    private lateinit var codeInput: EditText
    private lateinit var serverInput: EditText
    private lateinit var pairCard: LinearLayout

    private val orange = Color.parseColor("#FF5A00")
    private val ink = Color.parseColor("#0B0B0B")
    private val muted = Color.parseColor("#6E6E73")
    private val line = Color.parseColor("#E5E5EA")
    private val surface = Color.parseColor("#F5F5F7")
    private val green = Color.parseColor("#1E6F33")
    private val red = Color.parseColor("#A1000F")

    private val perms = buildList {
        add(Manifest.permission.CALL_PHONE)
        add(Manifest.permission.READ_PHONE_STATE)
        add(Manifest.permission.READ_CALL_LOG)
        add(Manifest.permission.ANSWER_PHONE_CALLS)
        if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
    }.toTypedArray()

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun rounded(fill: Int, radius: Int = 14, stroke: Int? = null) = GradientDrawable().apply {
        setColor(fill); cornerRadius = dp(radius).toFloat(); if (stroke != null) setStroke(dp(1), stroke)
    }
    private fun text(t: String, size: Float, color: Int = ink, bold: Boolean = false) = TextView(this).apply {
        text = t; textSize = size; setTextColor(color); if (bold) typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
    }
    private fun button(t: String, primary: Boolean, onClick: () -> Unit) = Button(this).apply {
        text = t; isAllCaps = false; textSize = 16f; stateListAnimator = null
        setTextColor(if (primary) Color.WHITE else ink)
        background = if (primary) rounded(orange, 12) else rounded(Color.WHITE, 12, line)
        setPadding(dp(16), dp(14), dp(16), dp(14))
        setOnClickListener { onClick() }
    }
    private fun card() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; background = rounded(Color.WHITE, 16, line); setPadding(dp(18), dp(18), dp(18), dp(18))
    }
    private fun LinearLayout.gap(h: Int) = addView(View(context), LinearLayout.LayoutParams(MATCH_PARENT, dp(h)))
    private fun step(n: Int, title: String, body: String) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        addView(text("$n", 14f, Color.WHITE, true).apply { gravity = Gravity.CENTER; background = rounded(ink, 14) }, LinearLayout.LayoutParams(dp(28), dp(28)))
        addView(LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, 0, 0)
            addView(text(title, 16f, ink, true)); addView(text(body, 13f, muted))
        }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        api = Api(this)
        window.statusBarColor = surface
        if (Build.VERSION.SDK_INT >= 23) window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(28), dp(20), dp(28)); setBackgroundColor(surface) }

        root.addView(ImageView(this).apply { setImageResource(R.drawable.logo_basecom); adjustViewBounds = true; scaleType = ImageView.ScaleType.FIT_START },
            LinearLayout.LayoutParams(dp(180), WRAP_CONTENT))
        root.gap(6)
        root.addView(text("Telefone do CRM", 13f, muted))
        root.gap(20)

        // Estado
        val status = card()
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        statusDot = View(this)
        row.addView(statusDot, LinearLayout.LayoutParams(dp(12), dp(12)))
        statusTitle = text("", 18f, ink, true).apply { setPadding(dp(10), 0, 0, 0) }
        row.addView(statusTitle)
        status.addView(row)
        status.gap(6)
        statusText = text("", 14f, muted)
        status.addView(statusText)
        root.addView(status)
        root.gap(16)

        // Passos
        pairCard = card()
        pairCard.addView(step(1, "Emparelhar com o CRM", "No CRM, carregue no ícone do telemóvel (em baixo, no menu) e escreva aqui o código."))
        pairCard.gap(12)
        codeInput = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER; hint = "000000"; textSize = 28f; gravity = Gravity.CENTER; letterSpacing = 0.3f
            background = rounded(surface, 12, line); setPadding(dp(12), dp(14), dp(12), dp(14))
        }
        pairCard.addView(codeInput, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        pairCard.gap(10)
        pairCard.addView(button("Emparelhar", true) { pair() }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        root.addView(pairCard)
        root.gap(12)

        val permsCard = card()
        permsCard.addView(step(2, "Autorizações", "Chamadas, estado do telefone, registo de chamadas e notificações."))
        permsCard.gap(10)
        permsCard.addView(button("Dar autorizações", false) { requestPermissions(perms, 1) }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        root.addView(permsCard)
        root.gap(12)

        val batteryCard = card()
        batteryCard.addView(step(3, "Sem restrições de bateria", "Para o telemóvel não fechar a app em segundo plano."))
        batteryCard.gap(10)
        batteryCard.addView(button("Abrir definições de bateria", false) { askBattery() }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        root.addView(batteryCard)
        root.gap(24)

        root.addView(text("Servidor", 12f, muted))
        serverInput = EditText(this).apply { setText(api.server); inputType = InputType.TYPE_TEXT_VARIATION_URI; textSize = 14f; background = rounded(Color.WHITE, 10, line); setPadding(dp(12), dp(10), dp(12), dp(10)) }
        root.addView(serverInput, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        root.gap(10)
        root.addView(button("Desemparelhar este telemóvel", false) {
            api.token = null; stopService(Intent(this, PhoneService::class.java)); refresh()
        }.apply { setTextColor(red) }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        root.gap(16)
        root.addView(text("BASECOM · versão ${packageManager.getPackageInfo(packageName, 0).versionName}", 12f, muted).apply { gravity = Gravity.CENTER }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))

        setContentView(ScrollView(this).apply { setBackgroundColor(surface); addView(root) })
        refresh()
    }

    override fun onResume() { super.onResume(); refresh() }

    private fun missingPerms() = perms.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }

    private fun setStatus(color: Int, title: String, body: String) {
        statusDot.background = rounded(color, 6)
        statusTitle.text = title; statusText.text = body
    }

    private fun refresh() {
        val t = api.token
        when {
            t == null -> setStatus(red, "Por emparelhar", "Siga os passos abaixo para ligar este telemóvel ao CRM.")
            missingPerms().isNotEmpty() -> setStatus(orange, "Faltam autorizações", "Emparelhado com ${api.userName}. Carregue em «Dar autorizações».")
            else -> setStatus(green, "Ligado ao CRM", "Emparelhado com ${api.userName}. Pode fechar esta janela: as chamadas pedidas no CRM são marcadas aqui.")
        }
        pairCard.visibility = if (t == null) View.VISIBLE else View.GONE
        if (t != null && missingPerms().isEmpty()) PhoneService.start(this)
    }

    private fun pair() {
        val code = codeInput.text.toString().trim()
        if (!Regex("^\\d{6}$").matches(code)) { setStatus(red, "Código inválido", "O código tem 6 algarismos."); return }
        api.server = serverInput.text.toString().ifBlank { "https://crm.basecom.pt" }
        setStatus(orange, "A emparelhar…", "")
        Thread {
            val err = try { api.pair(code, "${Build.MANUFACTURER} ${Build.MODEL}"); null } catch (e: Exception) { e.message }
            runOnUiThread {
                codeInput.setText("")
                if (err != null) setStatus(red, "Não foi possível emparelhar", err) else { refresh(); if (missingPerms().isNotEmpty()) requestPermissions(perms, 1) }
            }
        }.start()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        refresh()
    }

    private fun askBattery() {
        val pm = getSystemService(PowerManager::class.java)
        if (pm.isIgnoringBatteryOptimizations(packageName)) { setStatus(green, statusTitle.text.toString(), "Já está sem restrições de bateria."); return }
        try {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        } catch (_: Exception) {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }
}
