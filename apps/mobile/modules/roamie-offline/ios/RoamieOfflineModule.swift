import ExpoModulesCore
import Translation
import NaturalLanguage
import SwiftUI
import Vision
import AVFoundation
import CryptoKit
import os

public class RoamieOfflineModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RoamieOffline")

    AsyncFunction("supportedTextLanguages") { () async -> [String] in
      #if targetEnvironment(simulator)
      return []
      #else
      guard #available(iOS 18.0, *) else { return [] }
      return await LanguageAvailability().supportedLanguages.compactMap { self.code($0) }
      #endif
    }

    AsyncFunction("canRemoveLanguagePacks") { false }

    AsyncFunction("isTranslationReady") { (from: String, to: String) async -> Bool in
      guard #available(iOS 18.0, *) else { return false }
      return await LanguageAvailability().status(from: self.language(from), to: self.language(to)) == .installed
    }

    AsyncFunction("downloadedLanguages") { () async -> [String] in
      guard #available(iOS 18.0, *) else { return [] }
      let availability = LanguageAvailability()
      var installed = ["en"]
      for language in await availability.supportedLanguages {
        guard let code = self.code(language), code != "en" else { continue }
        if await availability.status(from: self.language("en"), to: language) == .installed { installed.append(code) }
      }
      return installed
    }

    AsyncFunction("downloadLanguage") { (language: String, cellular: Bool) async throws in
      #if targetEnvironment(simulator)
      throw self.failure("Use a physical iPhone to download text translation packs. Speech models can still be prepared here.")
      #else
      guard #available(iOS 18.0, *) else { throw self.failure("Offline text translation requires iOS 18 or later.") }
      if language == "en" { return }
      _ = try await self.withTranslationSession(from: "en", to: language, text: nil)
      #endif
    }

    AsyncFunction("removeLanguage") { (_: String) throws in
      throw self.failure("iOS manages these packs. Remove downloaded languages in the Translate app's settings.")
    }

    AsyncFunction("identifyLanguage") { (text: String) -> String in
      let recognizer = NLLanguageRecognizer()
      recognizer.processString(text)
      guard let result = recognizer.languageHypotheses(withMaximum: 1).first, result.value >= 0.7 else { return "und" }
      return result.key.rawValue == "fil" ? "tl" : String(result.key.rawValue.split(separator: "-")[0])
    }

    AsyncFunction("translate") { (text: String, from: String, to: String) async throws -> String in
      guard #available(iOS 18.0, *) else { throw self.failure("Offline text translation requires iOS 18 or later.") }
      guard !text.isEmpty, text.count <= 5000 else { throw self.failure("Use a phrase of up to 5,000 characters.") }
      guard await LanguageAvailability().status(from: self.language(from), to: self.language(to)) == .installed else {
        throw self.failure("Download both languages in Offline languages before translating.")
      }
      if #available(iOS 26.0, *) {
        let session = TranslationSession(installedSource: self.language(from), target: self.language(to))
        return try await session.translate(text).targetText
      }
      return try await self.withTranslationSession(from: from, to: to, text: text)
    }

    AsyncFunction("recognizeText") { (uri: String, language: String) -> [[String: Any]] in
      let url = try self.localURL(uri)
      let request = VNRecognizeTextRequest()
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = true
      if language != "auto" {
        let supported = try request.supportedRecognitionLanguages().filter { $0.hasPrefix(language == "fil" ? "tl" : language) }
        guard !supported.isEmpty else { throw self.failure("Camera reading for this language needs internet. You can type the text instead.") }
        request.recognitionLanguages = supported
      }
      try VNImageRequestHandler(url: url).perform([request])
      return (request.results ?? []).prefix(80).compactMap { observation in
        guard let text = observation.topCandidates(1).first?.string, !text.isEmpty else { return nil }
        let b = observation.boundingBox
        return ["text": text, "box": ["x": b.minX, "y": 1 - b.maxY, "w": b.width, "h": b.height]]
      }
    }.runOnQueue(DispatchQueue.global(qos: .userInitiated))

    AsyncFunction("offlineVoices") { () -> [[String: String]] in
      AVSpeechSynthesisVoice.speechVoices().map { ["identifier": $0.identifier, "language": $0.language] }
    }

    AsyncFunction("ocrLanguages") { () -> [String] in
      try VNRecognizeTextRequest().supportedRecognitionLanguages().map { String($0.split(separator: "-")[0]) }
    }

    AsyncFunction("sha256") { (uri: String) -> String in
      let handle = try FileHandle(forReadingFrom: self.localURL(uri))
      defer { try? handle.close() }
      var digest = SHA256()
      while let data = try handle.read(upToCount: 1_048_576), !data.isEmpty { digest.update(data: data) }
      return digest.finalize().map { String(format: "%02x", $0) }.joined()
    }.runOnQueue(DispatchQueue.global(qos: .utility))

    AsyncFunction("availableMemory") { () -> Double in
      #if targetEnvironment(simulator)
      return Double(ProcessInfo.processInfo.physicalMemory)
      #else
      return Double(os_proc_available_memory())
      #endif
    }

    AsyncFunction("audioToWav") { (uri: String) -> String in
      let input = try AVAudioFile(forReading: self.localURL(uri))
      guard input.length > 0, Double(input.length) / input.processingFormat.sampleRate <= 60,
            let source = AVAudioPCMBuffer(pcmFormat: input.processingFormat, frameCapacity: AVAudioFrameCount(input.length)),
            let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true),
            let converter = AVAudioConverter(from: input.processingFormat, to: format),
            let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(ceil(Double(input.length) * 16000 / input.processingFormat.sampleRate)) + 1024)
      else { throw self.failure("Record a phrase shorter than one minute.") }
      try input.read(into: source)
      var supplied = false
      var error: NSError?
      let status = converter.convert(to: output, error: &error) { _, state in
        if supplied { state.pointee = .endOfStream; return nil }
        supplied = true
        state.pointee = .haveData
        return source
      }
      guard error == nil, status != .error else { throw self.failure("Could not read this recording. Please record again.") }
      let url = FileManager.default.temporaryDirectory.appendingPathComponent("roamie-asr-\(UUID().uuidString).wav")
      let file = try AVAudioFile(forWriting: url, settings: format.settings, commonFormat: .pcmFormatInt16, interleaved: true)
      try file.write(from: output)
      return url.absoluteString
    }.runOnQueue(DispatchQueue.global(qos: .userInitiated))
  }

  private func language(_ code: String) -> Locale.Language {
    Locale.Language(identifier: code == "tl" ? "fil" : code == "zh" ? "zh-Hans" : code)
  }

  private func code(_ language: Locale.Language) -> String? {
    guard let code = language.languageCode?.identifier else { return nil }
    return code == "fil" ? "tl" : code
  }

  @available(iOS 18.0, *)
  @MainActor
  private func withTranslationSession(from: String, to: String, text: String?) async throws -> String {
    guard let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).flatMap({ $0.windows }).first(where: { $0.isKeyWindow }),
          let root = window.rootViewController else { throw failure("Return to Roamie to prepare this language.") }
    return try await withCheckedThrowingContinuation { continuation in
      var host: UIHostingController<TranslationOperation>?
      var finished = false
      let complete: (Result<String, Error>) -> Void = { result in
        guard !finished else { return }
        finished = true
        host?.willMove(toParent: nil)
        host?.view.removeFromSuperview()
        host?.removeFromParent()
        host = nil
        continuation.resume(with: result)
      }
      let view = TranslationOperation(source: language(from), target: language(to), text: text, complete: complete)
      let controller = UIHostingController(rootView: view)
      host = controller
      var parent = root
      while let presented = parent.presentedViewController { parent = presented }
      parent.addChild(controller)
      controller.view.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
      controller.view.backgroundColor = .clear
      controller.view.isUserInteractionEnabled = false
      controller.view.accessibilityElementsHidden = true
      parent.view.addSubview(controller.view)
      controller.didMove(toParent: parent)
    }
  }

  private func localURL(_ uri: String) throws -> URL {
    guard let url = URL(string: uri), url.isFileURL,
          url.standardizedFileURL.path.hasPrefix(NSHomeDirectory() + "/") else {
      throw failure("Only files stored on this phone can be processed offline.")
    }
    return url
  }

  private func failure(_ message: String) -> NSError {
    NSError(domain: "RoamieOffline", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
}

@available(iOS 18.0, *)
private struct TranslationOperation: View {
  let source: Locale.Language
  let target: Locale.Language
  let text: String?
  let complete: (Result<String, Error>) -> Void

  var body: some View {
    Color.clear.translationTask(source: source, target: target) { session in
      do {
        if let text { complete(.success(try await session.translate(text).targetText)) }
        else { try await session.prepareTranslation(); complete(.success("")) }
      } catch { complete(.failure(error)) }
    }
  }
}
