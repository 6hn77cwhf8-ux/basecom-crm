package pt.basecom.crm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Ao ligar o telemóvel (ou depois de atualizar a app), volta a pôr a app a trabalhar se já estiver emparelhada. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (Api(context).token != null) PhoneService.start(context)
    }
}
