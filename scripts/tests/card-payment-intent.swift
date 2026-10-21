import AppIntents
import Foundation

@main
struct CardPaymentIntentTests {
  static func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw NSError(domain: "RoamieCardPaymentTests", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
  }

  static func payment(_ value: Decimal = Decimal(string: "12.50")!) -> LogCardPayment {
    let intent = LogCardPayment()
    intent.merchant = "Roamie QA cafe"
    intent.amount = IntentCurrencyAmount(amount: value, currencyCode: "AUD")
    return intent
  }

  static func main() async throws {
    let defaults = UserDefaults.standard
    let keys = ["roamie.cardPaymentAccount", "roamie.cardPayments"]
    let before = keys.map { defaults.object(forKey: $0) }
    defer {
      for (key, value) in zip(keys, before) {
        if let value { defaults.set(value, forKey: key) } else { defaults.removeObject(forKey: key) }
      }
    }
    defaults.set([], forKey: keys[1])
    defaults.removeObject(forKey: keys[0])
    var failed = false
    do { _ = try await payment().perform() } catch { failed = true }
    try require(failed, "A signed-out automation must fail without queuing a payment")
    defaults.set("qa-account", forKey: keys[0])
    _ = try await payment().perform()
    let saved = defaults.array(forKey: keys[1]) as? [[String: String]] ?? []
    try require(saved.count == 1, "Exactly one payment should be queued")
    try require(saved[0]["accountId"] == "qa-account", "Payment must retain its account")
    try require(saved[0]["amount"] == "12.5" && saved[0]["currency"] == "AUD", "Currency and decimal amount must survive")
    failed = false
    do { _ = try await payment(-1).perform() } catch { failed = true }
    try require(failed, "A negative payment must be rejected")
    defaults.set(Array(repeating: saved[0], count: 200), forKey: keys[1])
    failed = false
    do { _ = try await payment().perform() } catch { failed = true }
    try require(failed, "A full queue must fail instead of silently discarding older payments")
    print("PASS: account ownership, signed-out rejection, decimal currency, invalid amount, full queue")
  }
}
