import ExpoModulesCore
import AVFoundation
import RoamieVAD

public class RoamieCaptureModule: Module {
  private let queue = DispatchQueue(label: "app.tesserix.roamie.capture")
  private var foreground = true
  private var engine: AVAudioEngine?
  private var pending = Data()
  private var audio = Data()
  private var vad: OpaquePointer?
  private var total = 0
  private var captureId = ""
  private var interruption: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("RoamieCapture")
    Constants(["speechDetection": true])
    Events("pcm")
    AsyncFunction("startCapture") { (id: String) in
      try self.queue.sync { try self.start(id) }
    }
    AsyncFunction("stopCapture") { () -> [String: String] in
      try self.queue.sync {
        self.stop()
        let data = self.wav(self.audio)
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("roamie-capture-\(UUID().uuidString).wav")
        try data.write(to: file, options: .atomic)
        self.pending.removeAll(); self.audio.removeAll()
        return ["uri": file.absoluteString]
      }
    }
    OnAppEntersBackground { self.queue.async { self.foreground = false; self.interrupted() } }
    OnAppEntersForeground { self.queue.async { self.foreground = true } }
    OnDestroy { self.queue.sync { self.stop(); self.pending.removeAll() } }
  }

  private func start(_ id: String) throws {
    stop()
    guard foreground, AVAudioSession.sharedInstance().recordPermission == .granted else {
      throw NSError(domain: "RoamieCapture", code: 1, userInfo: [NSLocalizedDescriptionKey: "Microphone permission is required."])
    }
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothHFP])
    try session.setPreferredSampleRate(48000)
    try session.setActive(true)
    let next = AVAudioEngine()
    let input = next.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0,
          let output = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 48000, channels: 1, interleaved: true),
          let converter = AVAudioConverter(from: format, to: output) else {
      throw NSError(domain: "RoamieCapture", code: 2, userInfo: [NSLocalizedDescriptionKey: "Microphone format is unavailable."])
    }
    guard let detector = roamie_denoise_create() else { throw NSError(domain: "RoamieCapture", code: 3) }
    vad = detector
    captureId = id; pending.removeAll(); audio.removeAll(); total = 0
    input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
      guard let self else { return }
      let capacity = AVAudioFrameCount(ceil(Double(buffer.frameLength) * 48000 / format.sampleRate) + 32)
      guard let converted = AVAudioPCMBuffer(pcmFormat: output, frameCapacity: capacity) else { return }
      var supplied = false
      var error: NSError?
      converter.convert(to: converted, error: &error) { _, status in
        if supplied { status.pointee = .noDataNow; return nil }
        supplied = true; status.pointee = .haveData; return buffer
      }
      guard error == nil, let samples = converted.int16ChannelData?[0] else {
        self.queue.async { if self.captureId == id { self.interrupted() } }
        return
      }
      let bytes = Data(bytes: samples, count: Int(converted.frameLength) * 2)
      self.queue.async { self.append(bytes, id: id) }
    }
    engine = next
    do { next.prepare(); try next.start() } catch { stop(); throw error }
    interruption = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: nil) { [weak self] _ in
      self?.queue.async { self?.interrupted() }
    }
  }

  private func append(_ bytes: Data, id: String) {
    guard engine != nil, captureId == id, total < 2880000 else { return }
    let accepted = bytes.prefix(2880000 - total)
    total += accepted.count
    pending.append(accepted)
    while pending.count >= 9600 {
      let frame = Data(pending.prefix(9600))
      pending.removeFirst(9600)
      let result = clean(frame)
      audio.append(result.data)
      sendEvent("pcm", ["id": id, "speech": result.speech, "metering": result.level])
    }
    if total >= 2880000 { stop() }
  }

  private func clean(_ frame: Data) -> (data: Data, speech: Bool, level: Double) {
    var output = [Int16](repeating: 0, count: 1600)
    var voiced = 0
    frame.withUnsafeBytes { raw in
      let samples = raw.bindMemory(to: Int16.self)
      output.withUnsafeMutableBufferPointer { cleaned in
        if let vad, let base = samples.baseAddress, let destination = cleaned.baseAddress {
          for i in 0..<10 {
            if roamie_denoise_process(vad, base.advanced(by: i * 480), destination.advanced(by: i * 160)) > 0.6 { voiced += 1 }
          }
        }
      }
    }
    let sum = output.reduce(0.0) { $0 + pow(Double($1) / 32768, 2) }
    return (output.withUnsafeBytes { Data($0) }, voiced >= 3, 20 * log10(max(sqrt(sum / 1600), 0.00000001)))
  }

  private func interrupted() {
    guard engine != nil else { return }
    sendEvent("pcm", ["id": captureId, "error": "microphone_interrupted", "data": "", "metering": -160])
    stop(); pending.removeAll()
  }

  private func wav(_ pcm: Data) -> Data {
    var data = Data("RIFF".utf8)
    func u32(_ value: UInt32) { var v = value.littleEndian; withUnsafeBytes(of: &v) { data.append(contentsOf: $0) } }
    func u16(_ value: UInt16) { var v = value.littleEndian; withUnsafeBytes(of: &v) { data.append(contentsOf: $0) } }
    u32(UInt32(pcm.count + 36)); data.append(Data("WAVEfmt ".utf8)); u32(16)
    u16(1); u16(1); u32(16000); u32(32000); u16(2); u16(16)
    data.append(Data("data".utf8)); u32(UInt32(pcm.count)); data.append(pcm)
    return data
  }

  private func stop() {
    if let engine { engine.inputNode.removeTap(onBus: 0); engine.stop() }
    engine = nil
    if vad != nil {
      let count = pending.count
      var final = pending
      final.append(Data(count: 19200 - count))
      let first = clean(Data(final.prefix(9600))).data
      let second = clean(Data(final.suffix(9600))).data
      audio.append((first + second).prefix(count / 6 * 2 + 352))
      pending.removeAll()
    }
    if let vad { roamie_denoise_free(vad) }; vad = nil
    if let interruption { NotificationCenter.default.removeObserver(interruption) }
    interruption = nil
  }
}
