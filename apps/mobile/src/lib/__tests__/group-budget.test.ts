import { expect, test } from "@jest/globals";
import {
  allocate,
  debts,
  minorAmount,
  reminderUrl,
  convertMinor,
} from "../group-budget";
const a = "a",
  b = "b",
  c = "c";
test("equal and percentage splits distribute every minor unit deterministically", () => {
  expect(
    allocate(100, "equal", [
      { participantId: c, value: 1 },
      { participantId: a, value: 1 },
      { participantId: b, value: 1 },
    ]),
  ).toEqual([
    { participantId: a, amountMinor: 34 },
    { participantId: b, amountMinor: 33 },
    { participantId: c, amountMinor: 33 },
  ]);
  expect(
    allocate(101, "percentage", [
      { participantId: a, value: 5000 },
      { participantId: b, value: 5000 },
    ]).map((x) => x.amountMinor),
  ).toEqual([51, 50]);
  expect(() =>
    allocate(100, "percentage", [{ participantId: a, value: 9999 }]),
  ).toThrow();
  expect(() =>
    allocate(100, "exact", [{ participantId: a, value: 99 }]),
  ).toThrow();
  expect(() =>
    allocate(100, "equal", [
      { participantId: a, value: 1 },
      { participantId: a, value: 1 },
    ]),
  ).toThrow();
});
test("exact values and money precision do not round away user mistakes", () => {
  expect(
    allocate(100, "exact", [
      { participantId: a, value: 40 },
      { participantId: b, value: 60 },
    ]).map((x) => x.amountMinor),
  ).toEqual([40, 60]);
  expect(minorAmount("12.50", "AUD")).toBe(1250);
  expect(minorAmount("12.001", "AUD")).toBeNull();
  expect(minorAmount("1500", "JPY")).toBe(1500);
  expect(minorAmount("1.5", "JPY")).toBeNull();
  expect(minorAmount("1.005", "KWD")).toBe(1005);
  expect(minorAmount("1.25", "INR")).toBe(125);
  expect(minorAmount("1e5", "USD")).toBeNull();
});
test("settlements consume oldest obligations and keep currencies separate", () => {
  const expenses = [
    {
      id: "1",
      payerId: a,
      currency: "AUD",
      occurredOn: "2026-09-01",
      splits: [{ participantId: b, amountMinor: 100 }],
    },
    {
      id: "2",
      payerId: a,
      currency: "AUD",
      occurredOn: "2026-10-15",
      splits: [{ participantId: b, amountMinor: 200 }],
    },
    {
      id: "3",
      payerId: a,
      currency: "INR",
      occurredOn: "2026-09-01",
      splits: [{ participantId: b, amountMinor: 500 }],
    },
  ];
  const result = debts(
    expenses,
    [{ fromId: b, toId: a, currency: "AUD", amountMinor: 100 }],
    "2026-10-21",
  );
  expect(result).toEqual([
    {
      fromId: b,
      toId: a,
      currency: "AUD",
      amountMinor: 200,
      oldestOn: "2026-10-15",
      overdue: false,
    },
    {
      fromId: b,
      toId: a,
      currency: "INR",
      amountMinor: 500,
      oldestOn: "2026-09-01",
      overdue: true,
    },
  ]);
  expect(
    debts(
      expenses,
      [
        { fromId: b, toId: a, currency: "AUD", amountMinor: 300 },
        { fromId: b, toId: a, currency: "INR", amountMinor: 500 },
      ],
      "2026-10-21",
    ),
  ).toEqual([]);
});
test("reciprocal debts net without changing anyone else or hiding old unpaid amounts", () => {
  const input = [
    {
      id: "1",
      payerId: a,
      currency: "AUD",
      occurredOn: "2026-09-01",
      splits: [{ participantId: b, amountMinor: 100 }],
    },
    {
      id: "2",
      payerId: b,
      currency: "AUD",
      occurredOn: "2026-10-20",
      splits: [{ participantId: a, amountMinor: 40 }],
    },
  ];
  expect(debts(input, [], "2026-10-21")).toEqual([
    {
      fromId: b,
      toId: a,
      currency: "AUD",
      amountMinor: 60,
      oldestOn: "2026-09-01",
      overdue: true,
    },
  ]);
});
test("contact handoffs encode user messages and reject invalid contacts", () => {
  expect(reminderUrl("email", "a@example.com", "Hi & hello")).toContain(
    "Hi%20%26%20hello",
  );
  expect(reminderUrl("whatsapp", "+61412345678", "Hi")).toBe(
    "https://wa.me/61412345678?text=Hi",
  );
  expect(() =>
    reminderUrl("email", "bad\r\nBcc:x@example.com", "Hi"),
  ).toThrow();
});

test("home conversion handles INR/AUD and ISO currency precision", () => {
  expect(convertMinor(10000, "AUD", "INR", { AUD: 0.018 })).toBe(555556);
  expect(convertMinor(100, "HUF", "INR", { HUF: 4 })).toBe(25);
  expect(minorAmount("1.25", "TWD")).toBe(125);
  expect(minorAmount("1.5", "BIF")).toBeNull();
  expect(convertMinor(100, "AUD", "INR", { AUD: 0 })).toBeNull();
});
