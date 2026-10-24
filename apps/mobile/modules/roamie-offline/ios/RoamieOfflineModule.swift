import ExpoModulesCore
import MLKitTranslate
import Network
import Speech
import AVFoundation

public class RoamieOfflineModule: Module {
  private let monitor = NWPathMonitor()
  private var translator: Translator?
  private var pair = ""
  private func language(_ code: String) throws -> TranslateLanguage {
    let value = TranslateLanguage(rawValue: code)
    guard TranslateLanguage.allLanguages().contains(value) else { throw OfflineError("This language is not supported offline.") }
    return value
  }
  private func installed(_ code: String) -> Bool {
    ModelManager.modelManager().isModelDownloaded(TranslateRemoteModel.translateRemoteModel(language: TranslateLanguage(rawValue: code)))
  }
  public func definition() -> ModuleDefinition {
    Name("RoamieOffline")
    OnCreate { self.monitor.start(queue: DispatchQueue(label: "roamie.offline.network")) }
    OnDestroy { self.monitor.cancel(); self.translator = nil }
    AsyncFunction("speechLocale") { (language: String) -> String? in
      let locales = SFSpeechRecognizer.supportedLocales().sorted { $0.identifier < $1.identifier }
      return locales.first { locale in
        locale.language.languageCode?.identifier == language && SFSpeechRecognizer(locale: locale)?.supportsOnDeviceRecognition == true
      }?.identifier.replacingOccurrences(of: "_", with: "-")
    }
    AsyncFunction("offlineVoices") { () -> [[String: String]] in
      AVSpeechSynthesisVoice.speechVoices().map { ["identifier": $0.identifier, "language": $0.language] }
    }
    AsyncFunction("status") { () -> [String: Any] in
      let path = self.monitor.currentPath
      return ["online": path.status == .satisfied, "wifi": path.usesInterfaceType(.wifi),
        "supported": TranslateLanguage.allLanguages().map { $0.rawValue },
        "downloaded": ModelManager.modelManager().downloadedTranslateModels.map { $0.language.rawValue }]
    }
    AsyncFunction("download") { (from: String, to: String, cellular: Bool, promise: Promise) in
      let options = TranslatorOptions(sourceLanguage: try self.language(from), targetLanguage: try self.language(to))
      let client = Translator.translator(options: options)
      client.downloadModelIfNeeded(with: ModelDownloadConditions(allowsCellularAccess: cellular, allowsBackgroundDownloading: true)) { error in
        _ = client
        if let error { promise.reject(error) }
        else if self.installed(from) && self.installed(to) { promise.resolve() }
        else { promise.reject(OfflineError("Language download did not finish. Please retry.")) }
      }
    }
    AsyncFunction("translate") { (text: String, from: String, to: String, promise: Promise) in
      guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && text.utf16.count <= 2000 else { throw OfflineError("Enter between 1 and 2000 characters.") }
      guard self.installed(from) && self.installed(to) else { throw OfflineError("Download both languages before translating offline.") }
      if self.pair != "\(from):\(to)" {
        self.translator = Translator.translator(options: TranslatorOptions(sourceLanguage: try self.language(from), targetLanguage: try self.language(to)))
        self.pair = "\(from):\(to)"
      }
      guard let client = self.translator else { throw OfflineError("The translator is unavailable. Please retry.") }
      client.translate(text) { result, error in
        _ = client
        if let error { promise.reject(error) }
        else if let result { promise.resolve(result) }
        else { promise.reject(OfflineError("The translation could not finish. Please retry.")) }
      }
    }
    AsyncFunction("remove") { (code: String, promise: Promise) in
      self.translator = nil; self.pair = ""
      ModelManager.modelManager().deleteDownloadedModel(TranslateRemoteModel.translateRemoteModel(language: try self.language(code))) { error in
        if let error { promise.reject(error) } else { promise.resolve() }
      }
    }
  }
}
private final class OfflineError: GenericException<String> {
  override var reason: String { param }
}
