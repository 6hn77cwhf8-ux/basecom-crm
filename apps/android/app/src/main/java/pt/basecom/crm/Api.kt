package pt.basecom.crm

import android.content.Context
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Ligação ao CRM (https://crm.basecom.pt). O telemóvel identifica-se com o seu token («Authorization: Device …»). */
class Api(private val ctx: Context) {
    private val prefs = ctx.getSharedPreferences("basecom", Context.MODE_PRIVATE)

    var server: String
        get() = prefs.getString("server", "https://crm.basecom.pt") ?: "https://crm.basecom.pt"
        set(v) = prefs.edit().putString("server", v.trimEnd('/')).apply()
    var token: String?
        get() = prefs.getString("token", null)
        set(v) = prefs.edit().putString("token", v).apply()
    var userName: String?
        get() = prefs.getString("userName", null)
        set(v) = prefs.edit().putString("userName", v).apply()

    class HttpError(val status: Int, message: String) : IOException(message)

    fun request(method: String, path: String, body: JSONObject? = null, timeoutMs: Int = 15_000): JSONObject {
        val c = URL(server + path).openConnection() as HttpURLConnection
        try {
            c.requestMethod = method
            c.connectTimeout = 10_000
            c.readTimeout = timeoutMs
            c.setRequestProperty("Accept", "application/json")
            token?.let { c.setRequestProperty("Authorization", "Device $it") }
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            val code = c.responseCode
            val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: "{}"
            val json = try { JSONObject(text) } catch (_: Exception) { JSONObject() }
            if (code !in 200..299) throw HttpError(code, json.optString("error", "Erro $code"))
            return json
        } finally {
            c.disconnect()
        }
    }

    /** Troca o código de 6 algarismos (gerado no CRM) pelo token deste telemóvel. */
    fun pair(code: String, model: String): String {
        val r = request("POST", "/device/pair", JSONObject().put("code", code).put("model", model))
        token = r.getString("token")
        userName = r.optString("userName")
        return userName ?: ""
    }

    /** Espera até 25 s por uma chamada a fazer. */
    fun next(): JSONObject? {
        val r = request("GET", "/device/next", timeoutMs = 40_000)
        return if (r.isNull("command")) null else r.getJSONObject("command")
    }

    fun event(e: JSONObject): JSONObject = request("POST", "/device/events", e)
}
