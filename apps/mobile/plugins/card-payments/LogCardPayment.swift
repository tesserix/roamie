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

  static var parameterSummary: some ParameterSummary {
    Summary("Log \(\.$amount) at \(\.$merchant)")
  }

  @MainActor
  func perform() async throws -> some IntentResult {
    let defaults = UserDefaults.standard
    guard let account = defaults.string(forKey: "roamie.cardPaymentAccount"), !account.isEmpty else {
      throw CardPaymentError.signedOut
    }
    let currency = amount.currencyCode.uppercased()
    let name = merchant.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !amount.amount.isNaN, amount.amount > 0, Locale.commonISOCurrencyCodes.contains(currency), !name.isEmpty else {
      throw CardPaymentError.invalidPayment
    }
    let now = Date()
    let day = DateFormatter()
    day.calendar = Calendar(identifier: .gregorian)
    day.locale = Locale(identifier: "en_US_POSIX")
    day.dateFormat = "yyyy-MM-dd"
    let key = "roamie.cardPayments"
    var queue = defaults.array(forKey: key) as? [[String: String]] ?? []
    guard queue.count < 200 else { throw CardPaymentError.queueFull }
    queue.append([
      "id": UUID().uuidString,
      "accountId": account,
      "merchant": String(name.prefix(120)),
      "amount": NSDecimalNumber(decimal: amount.amount).stringValue,
      "currency": currency,
      "date": day.string(from: now),
      "at": ISO8601DateFormatter().string(from: now),
    ])
    defaults.set(queue, forKey: key)
    return .result()
  }
}

private enum CardPaymentError: LocalizedError {
  case signedOut, invalidPayment, queueFull

  var errorDescription: String? {
    switch self {
    case .signedOut: "Open Roamie, sign in and wait for your budget to load, then run this action again."
    case .invalidPayment: "Choose the transaction’s Merchant and Amount, including its currency. The amount must be positive."
    case .queueFull: "Open Roamie to import queued payments before recording more."
    }
  }
}
