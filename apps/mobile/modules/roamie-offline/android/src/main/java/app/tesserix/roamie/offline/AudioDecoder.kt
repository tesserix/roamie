package app.tesserix.roamie.offline

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

internal object AudioDecoder {
  fun toWav(input: File, output: File) {
    require(input.length() <= 5 * 1024 * 1024) { "Record a shorter phrase." }
    val extractor = MediaExtractor()
    var codec: MediaCodec? = null
    try {
      extractor.setDataSource(input.path)
      val track = (0 until extractor.trackCount).first { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
      val format = extractor.getTrackFormat(track)
      require(!format.containsKey(MediaFormat.KEY_DURATION) || format.getLong(MediaFormat.KEY_DURATION) <= 60_000_000) { "Record a phrase shorter than one minute." }
      extractor.selectTrack(track)
      val decoder = MediaCodec.createDecoderByType(requireNotNull(format.getString(MediaFormat.KEY_MIME)))
      codec = decoder
      decoder.configure(format, null, null, 0)
      decoder.start()
      var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
      var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
      val pcm = ByteArrayOutputStream()
      val info = MediaCodec.BufferInfo()
      var ended = false
      val deadline = System.nanoTime() + 10_000_000_000L
      while (true) {
        check(System.nanoTime() < deadline) { "Could not decode this recording in time." }
        if (!ended) {
          val index = decoder.dequeueInputBuffer(10_000)
          if (index >= 0) {
            val buffer = requireNotNull(decoder.getInputBuffer(index))
            val size = extractor.readSampleData(buffer, 0)
            if (size < 0) { decoder.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); ended = true }
            else { decoder.queueInputBuffer(index, 0, size, extractor.sampleTime, 0); extractor.advance() }
          }
        }
        val index = decoder.dequeueOutputBuffer(info, 10_000)
        if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          rate = decoder.outputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
          channels = decoder.outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        } else if (index >= 0) {
          val buffer = requireNotNull(decoder.getOutputBuffer(index))
          buffer.position(info.offset)
          buffer.limit(info.offset + info.size)
          val bytes = ByteArray(info.size)
          buffer.get(bytes)
          require(pcm.size() + bytes.size <= 16 * 1024 * 1024) { "Record a shorter phrase." }
          pcm.write(bytes)
          decoder.releaseOutputBuffer(index, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
        }
      }
      require(rate in 8000..192000 && channels in 1..2) { "Unsupported recording format." }
      val source = ByteBuffer.wrap(pcm.toByteArray()).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
      val frames = source.remaining() / channels
      require(frames > 0 && frames.toDouble() / rate <= 60) { "Record a phrase shorter than one minute." }
      val count = (frames.toLong() * 16000 / rate).toInt()
      val data = ByteBuffer.allocate(count * 2).order(ByteOrder.LITTLE_ENDIAN)
      fun mono(frame: Int): Double = (0 until channels).sumOf { source.get(frame * channels + it).toDouble() } / channels
      for (i in 0 until count) {
        val position = i.toDouble() * rate / 16000
        val first = position.toInt().coerceAtMost(frames - 1)
        val next = (first + 1).coerceAtMost(frames - 1)
        val fraction = position - first
        data.putShort((mono(first) * (1 - fraction) + mono(next) * fraction).toInt().coerceIn(-32768, 32767).toShort())
      }
      val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
      header.put("RIFF".toByteArray()).putInt(36 + data.capacity()).put("WAVEfmt ".toByteArray())
      header.putInt(16).putShort(1).putShort(1).putInt(16000).putInt(32000).putShort(2).putShort(16)
      header.put("data".toByteArray()).putInt(data.capacity())
      output.outputStream().use { it.write(header.array()); it.write(data.array()) }
    } finally {
      try { codec?.stop() } catch (_: Exception) { }
      codec?.release()
      extractor.release()
    }
  }
}
