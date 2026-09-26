import AppIntents
import Foundation

// Run by a Shortcuts "Transaction" automation after each Apple Pay payment; the app adds trip spending on next open.
struct LogCardPayment: AppIntent {
  static let title: LocalizedStringResource = "Log card payment"
  static let description = IntentDescription("Adds a card payment to your Roamie wallet when you pay during a trip.")
  static let openAppWhenRun = false

  @Parameter(title: "Merchant")
  var merchant: String

  @Parameter(title: "Amount")
  var amount: IntentCurrencyAmount

  func perform() async throws -> some IntentResult {
    let now = Date()
    let day = DateFormatter()
    day.calendar = Calendar(identifier: .gregorian)
    day.locale = Locale(identifier: "en_US_POSIX")
    day.dateFormat = "yyyy-MM-dd"
    let key = "roamie.cardPayments"
    var queue = UserDefaults.standard.array(forKey: key) as? [[String: String]] ?? []
    queue.append([
      "id": UUID().uuidString,
      "merchant": merchant,
      "amount": "\(amount.amount)",
      "currency": amount.currencyCode,
      "date": day.string(from: now),
      "at": ISO8601DateFormatter().string(from: now),
    ])
    UserDefaults.standard.set(Array(queue.suffix(200)), forKey: key)
    return .result()
  }
}
