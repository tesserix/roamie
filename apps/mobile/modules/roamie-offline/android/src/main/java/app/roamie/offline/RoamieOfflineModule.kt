package app.roamie.offline

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import expo.modules.kotlin.Promise
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.nl.translate.*
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

class RoamieOfflineModule : Module() {
  private val manager get() = RemoteModelManager.getInstance()
  private val lock = ReentrantLock()
  @Volatile private var destroyed = false
  private var translator: Translator? = null
  private var pair = ""
  private fun language(code: String): String {
    require(TranslateLanguage.getAllLanguages().contains(code)) { "This language is not supported offline." }
    return code
  }
  private fun model(code: String) = TranslateRemoteModel.Builder(language(code)).build()
  private fun installed(code: String) = Tasks.await(manager.isModelDownloaded(model(code)), 10, TimeUnit.SECONDS)
  private fun reset() { translator?.close(); translator = null; pair = "" }
  override fun definition() = ModuleDefinition {
    Name("RoamieOffline")
    AsyncFunction("offlineVoices") { promise: Promise ->
      Handler(Looper.getMainLooper()).post {
        var engine: TextToSpeech? = null
        engine = TextToSpeech(requireNotNull(appContext.reactContext)) { code ->
          val voices = if (code == TextToSpeech.SUCCESS) engine?.voices?.filter {
            !it.isNetworkConnectionRequired && it.features?.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) != true
          }?.map { mapOf("identifier" to it.name, "language" to it.locale.toLanguageTag()) } ?: emptyList() else emptyList()
          engine?.shutdown()
          promise.resolve(voices)
        }
      }
    }
    AsyncFunction("status") {
      val context = requireNotNull(appContext.reactContext)
      val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      val caps = cm.getNetworkCapabilities(cm.activeNetwork)
      mapOf("online" to (caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true),
        "wifi" to (caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true),
        "supported" to TranslateLanguage.getAllLanguages(),
        "downloaded" to Tasks.await(manager.getDownloadedModels(TranslateRemoteModel::class.java), 10, TimeUnit.SECONDS).map { it.language })
    }
    AsyncFunction("download") { from: String, to: String, cellular: Boolean ->
      lock.withLock {
        val options = TranslatorOptions.Builder().setSourceLanguage(language(from)).setTargetLanguage(language(to)).build()
        val client = Translation.getClient(options)
        val conditions = DownloadConditions.Builder().apply { if (!cellular) requireWifi() }.build()
        try { Tasks.await(client.downloadModelIfNeeded(conditions), 240, TimeUnit.SECONDS) } finally { client.close(); if (destroyed) reset() }
        check(installed(from) && installed(to)) { "Language download did not finish. Please retry." }
      }
      Unit
    }
    AsyncFunction("translate") { text: String, from: String, to: String ->
      lock.withLock {
        require(text.isNotBlank() && text.length <= 2000) { "Enter between 1 and 2000 characters." }
        check(installed(from) && installed(to)) { "Download both languages before translating offline." }
        if (pair != "$from:$to") { reset(); translator = Translation.getClient(TranslatorOptions.Builder().setSourceLanguage(from).setTargetLanguage(to).build()); pair = "$from:$to" }
        try { Tasks.await(requireNotNull(translator).translate(text), 30, TimeUnit.SECONDS) }
        finally { if (destroyed) reset() }
      }
    }
    AsyncFunction("remove") { code: String ->
      lock.withLock { reset(); Tasks.await(manager.deleteDownloadedModel(model(code)), 30, TimeUnit.SECONDS) }
      Unit
    }
    OnDestroy {
      destroyed = true
      if (lock.tryLock()) { try { reset() } finally { lock.unlock() } }
    }
  }
}
