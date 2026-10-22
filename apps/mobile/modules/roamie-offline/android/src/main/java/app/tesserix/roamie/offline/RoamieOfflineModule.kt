package app.tesserix.roamie.offline

import android.net.Uri
import android.app.ActivityManager
import android.content.Context
import android.speech.tts.TextToSpeech
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.nl.languageid.LanguageIdentification
import com.google.mlkit.nl.languageid.LanguageIdentificationOptions
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.TranslateRemoteModel
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import com.google.mlkit.vision.text.devanagari.DevanagariTextRecognizerOptions
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues
import java.io.File
import java.security.MessageDigest

class RoamieOfflineModule : Module() {
  private val translators = mutableMapOf<String, Translator>()
  private val context get() = requireNotNull(appContext.reactContext)

  override fun definition() = ModuleDefinition {
    Name("RoamieOffline")

    AsyncFunction("supportedTextLanguages") { TranslateLanguage.getAllLanguages() }
    AsyncFunction("canRemoveLanguagePacks") { true }

    AsyncFunction("isTranslationReady") { from: String, to: String, promise: Promise ->
      RemoteModelManager.getInstance().getDownloadedModels(TranslateRemoteModel::class.java)
        .addOnSuccessListener { models ->
          val installed = models.map { it.language }.toSet() + "en"
          promise.resolve(installed.contains(from) && installed.contains(to))
        }
        .addOnFailureListener { promise.reject("model_status", "Could not check downloaded languages.", it) }
    }

    AsyncFunction("downloadedLanguages") { promise: Promise ->
      RemoteModelManager.getInstance().getDownloadedModels(TranslateRemoteModel::class.java)
        .addOnSuccessListener { models -> promise.resolve(models.map { it.language }) }
        .addOnFailureListener { promise.reject("model_status", "Could not check downloaded languages.", it) }
    }

    AsyncFunction("downloadLanguage") { language: String, cellular: Boolean, promise: Promise ->
      if (!TranslateLanguage.getAllLanguages().contains(language)) {
        promise.reject("unsupported_language", "This language needs an internet connection.", null)
      } else if (language == "en") {
        promise.resolve(null)
      } else {
        val conditions = DownloadConditions.Builder().apply { if (!cellular) requireWifi() }.build()
        RemoteModelManager.getInstance().download(TranslateRemoteModel.Builder(language).build(), conditions)
          .addOnSuccessListener { promise.resolve(null) }
          .addOnFailureListener { promise.reject("download_failed", "Language download failed. Connect to Wi-Fi and retry.", it) }
      }
    }

    AsyncFunction("removeLanguage") { language: String, promise: Promise ->
      synchronized(translators) { translators.values.forEach { it.close() }; translators.clear() }
      RemoteModelManager.getInstance().deleteDownloadedModel(TranslateRemoteModel.Builder(language).build())
        .addOnSuccessListener { promise.resolve(null) }
        .addOnFailureListener { promise.reject("delete_failed", "Could not remove this language. Try again.", it) }
    }

    AsyncFunction("identifyLanguage") { text: String, promise: Promise ->
      val identifier = LanguageIdentification.getClient(LanguageIdentificationOptions.Builder().setConfidenceThreshold(0.7f).build())
      identifier.identifyLanguage(text)
        .addOnSuccessListener { promise.resolve(it) }
        .addOnFailureListener { promise.reject("language_detection", "Choose the source language and try again.", it) }
        .addOnCompleteListener { identifier.close() }
    }

    AsyncFunction("translate") { text: String, from: String, to: String, promise: Promise ->
      if (text.isBlank() || text.codePointCount(0, text.length) > 5000) {
        promise.reject("invalid_text", "Use a phrase of up to 5,000 characters.", null)
      } else {
        translator(from, to).translate(text)
          .addOnSuccessListener { promise.resolve(it) }
          .addOnFailureListener { promise.reject("translation_failed", "Download both languages, then try again.", it) }
      }
    }

    AsyncFunction("recognizeText") { uri: String, language: String, promise: Promise ->
      val recognizer = when (language) {
        "zh" -> TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
        "hi", "ne", "mr" -> TextRecognition.getClient(DevanagariTextRecognizerOptions.Builder().build())
        "ja" -> TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build())
        "ko" -> TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())
        "auto", "en", "de", "es", "fr", "fil", "id", "it", "ms", "nl", "pl", "pt", "sv", "sw", "tr", "vi" ->
          TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        else -> null
      }
      if (recognizer == null) {
        promise.reject("unsupported_script", "Camera reading for this language needs internet. You can type the text instead.", null)
      } else {
        val image = InputImage.fromFilePath(context, Uri.fromFile(localFile(uri)))
        val rotated = image.rotationDegrees == 90 || image.rotationDegrees == 270
        val width = (if (rotated) image.height else image.width).toDouble()
        val height = (if (rotated) image.width else image.height).toDouble()
        recognizer.process(image)
          .addOnSuccessListener { result ->
            promise.resolve(result.textBlocks.flatMap { it.lines }.take(80).mapNotNull { line ->
              line.boundingBox?.let { box -> mapOf("text" to line.text, "box" to mapOf(
                "x" to box.left / width, "y" to box.top / height,
                "w" to box.width() / width, "h" to box.height() / height
              )) }
            })
          }
          .addOnFailureListener { promise.reject("ocr_failed", "Could not read this photo. Try a clearer photo or type the text.", it) }
          .addOnCompleteListener { recognizer.close() }
      }
    }

    AsyncFunction("offlineVoices") { promise: Promise ->
      var engine: TextToSpeech? = null
      engine = TextToSpeech(context) { status ->
        val tts = engine
        if (status != TextToSpeech.SUCCESS || tts == null) promise.resolve(emptyList<Map<String, String>>())
        else promise.resolve(tts.voices.orEmpty().filter { !it.isNetworkConnectionRequired && !it.features.orEmpty().contains("notInstalled") }
          .map { mapOf("identifier" to it.name, "language" to it.locale.toLanguageTag()) })
        tts?.shutdown()
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("sha256") { uri: String ->
      val digest = MessageDigest.getInstance("SHA-256")
      localFile(uri).inputStream().use { stream ->
        val buffer = ByteArray(1_048_576)
        while (true) { val count = stream.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
      }
      digest.digest().joinToString("") { "%02x".format(it) }
    }

    AsyncFunction("ocrLanguages") {
      listOf("en", "de", "es", "fr", "fil", "id", "it", "ms", "nl", "pl", "pt", "sv", "sw", "tr", "vi", "zh", "hi", "ne", "mr", "ja", "ko")
    }

    AsyncFunction("audioToWav") { uri: String ->
      val output = File.createTempFile("roamie-asr-", ".wav", context.cacheDir)
      try { AudioDecoder.toWav(localFile(uri), output); Uri.fromFile(output).toString() }
      catch (error: Exception) { output.delete(); throw error }
    }

    AsyncFunction("availableMemory") {
      val memory = ActivityManager.MemoryInfo()
      (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(memory)
      if (memory.lowMemory) 0.0 else memory.availMem.toDouble()
    }

    OnDestroy {
      synchronized(translators) { translators.values.forEach { it.close() }; translators.clear() }
    }
  }

  private fun translator(from: String, to: String): Translator = synchronized(translators) {
    val key = "$from:$to"
    translators[key] ?: run {
      if (translators.size >= 2) { translators.values.forEach { it.close() }; translators.clear() }
      Translation.getClient(TranslatorOptions.Builder().setSourceLanguage(from).setTargetLanguage(to).build()).also { translators[key] = it }
    }
  }

  private fun localFile(uri: String): File {
    val parsed = Uri.parse(uri)
    require(parsed.scheme == "file") { "Only files stored on this phone can be processed offline." }
    val file = File(requireNotNull(parsed.path)).canonicalFile
    require(file.path.startsWith(File(context.applicationInfo.dataDir).canonicalPath + "/")) { "The file must belong to this app." }
    return file
  }
}
