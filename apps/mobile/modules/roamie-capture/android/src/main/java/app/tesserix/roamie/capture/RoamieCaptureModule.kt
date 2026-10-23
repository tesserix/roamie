package app.tesserix.roamie.capture

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.log10
import kotlin.math.sqrt

class RoamieCaptureModule : Module() {
  companion object { init { System.loadLibrary("roamie_vad") } }
  private external fun createVad(): Long
  private external fun processVad(handle: Long, bytes: ByteArray): Boolean
  private external fun freeVad(handle: Long)
  private var audioData = ByteArrayOutputStream()
  private var foreground = true
  private var recorder: AudioRecord? = null
  private var worker: Thread? = null
  private val running = AtomicBoolean(false)
  private var tail = ByteArray(0)

  override fun definition() = ModuleDefinition {
    Name("RoamieCapture")
    Constants("speechDetection" to true)
    Events("pcm")
    AsyncFunction("startCapture") { id: String -> synchronized(this@RoamieCaptureModule) { start(id) } }
    AsyncFunction("stopCapture") {
      synchronized(this@RoamieCaptureModule) {
        stop()
        val context = appContext.reactContext ?: error("Microphone context unavailable")
        val pcm = audioData.toByteArray()
        val file = File.createTempFile("roamie-capture-", ".wav", context.cacheDir)
        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        header.put("RIFF".toByteArray()).putInt(pcm.size + 36).put("WAVEfmt ".toByteArray()).putInt(16)
        header.putShort(1).putShort(1).putInt(16000).putInt(32000).putShort(2).putShort(16)
        header.put("data".toByteArray()).putInt(pcm.size)
        file.outputStream().use { it.write(header.array()); it.write(pcm) }
        tail = ByteArray(0); audioData.reset()
        mapOf("uri" to file.toURI().toString())
      }
    }
    OnActivityEntersBackground { synchronized(this@RoamieCaptureModule) { foreground = false; stop(); tail = ByteArray(0) } }
    OnActivityEntersForeground { synchronized(this@RoamieCaptureModule) { foreground = true } }
    OnDestroy { synchronized(this@RoamieCaptureModule) { stop(); tail = ByteArray(0) } }
  }

  private fun start(id: String) {
    stop()
    check(foreground) { "Return to Roamie before recording" }
    val context = appContext.reactContext ?: error("Microphone context unavailable")
    check(context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) { "Microphone permission is required" }
    val minimum = AudioRecord.getMinBufferSize(48000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    check(minimum > 0) { "Microphone format unavailable" }
    val audio = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, 48000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minimum, 6400))
    if (audio.state != AudioRecord.STATE_INITIALIZED) { audio.release(); error("Microphone unavailable") }
    recorder = audio; tail = ByteArray(0); audioData.reset()
    try { audio.startRecording() } catch (error: Exception) { audio.release(); recorder = null; throw error }
    running.set(true)
    worker = Thread({
      val frame = ByteArray(9600)
      var filled = 0
      var total = 0
      val vad = createVad()
      try {
        check(vad != 0L) { "Speech detector unavailable" }
        while (running.get() && total < 2880000) {
          val count = audio.read(frame, filled, frame.size - filled, AudioRecord.READ_BLOCKING)
          if (count <= 0) {
            if (running.get()) error("Microphone interrupted")
            break
          }
          filled += count; total += count
          if (filled == frame.size) {
            val speech = processVad(vad, frame)
            audioData.write(frame, 0, 3200)
            var sum = 0.0
            for (i in 0 until 3200 step 2) {
              val sample = ((frame[i].toInt() and 255) or (frame[i + 1].toInt() shl 8)).toShort()
              val value = sample.toDouble() / 32768
              sum += value * value
            }
            sendEvent("pcm", mapOf("id" to id, "speech" to speech, "metering" to 20 * log10(maxOf(sqrt(sum / 1600), 0.00000001))))
            filled = 0
          }
        }
      } catch (_: Exception) {
        if (running.get()) sendEvent("pcm", mapOf("id" to id, "error" to "microphone_interrupted", "data" to "", "metering" to -160))
      } finally {
        if (vad != 0L) {
          frame.fill(0, filled)
          processVad(vad, frame)
          val count = minOf(filled / 6 * 2 + 352, 3200)
          audioData.write(frame, 0, count)
          if (filled / 6 * 2 + 352 > 3200) {
            frame.fill(0)
            processVad(vad, frame)
            audioData.write(frame, 0, filled / 6 * 2 + 352 - 3200)
          }
        }
        freeVad(vad)
        if (total >= 2880000 && running.getAndSet(false)) {
          try { audio.stop() } catch (_: IllegalStateException) { }
        }
      }
    }, "roamie-pcm").also { it.start() }
  }

  private fun stop() {
    running.set(false)
    try { recorder?.stop() } catch (_: IllegalStateException) { }
    worker?.join(1000)
    recorder?.release()
    recorder = null; worker = null
  }
}
