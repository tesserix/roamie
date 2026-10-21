import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button, Chip, SectionLabel } from "./ui";
import { SearchPicker } from "./search-picker";
import { GroupCopy, GroupField, GroupSheet } from "./group-budget-fields";
import { CURRENCIES } from "@/data/currencies";
import { font, space, radius, useColors } from "@/constants/theme";
import {
  allocate,
  convertMinor,
  currencyDecimals,
  groupFormat,
  minorAmount,
  today,
  type Group,
  type GroupExpense,
  type ShareInput,
  type SplitMethod,
} from "@/lib/group-budget";
import type { GroupChange } from "@/lib/group-budget-api";

type Props = {
  group: Group;
  home: string;
  rates: Record<string, number> | null;
  asOf: string | null;
  expense?: GroupExpense;
  onSave: (change: GroupChange) => Promise<void>;
  onClose: () => void;
  busy: boolean;
};
export function ExpenseEditor({
  group,
  home,
  rates,
  asOf,
  expense,
  onSave,
  onClose,
  busy,
}: Props) {
  const c = useColors();
  const original = expense?.shares.length
    ? expense.shares
    : expense?.splits.map((s) => ({
        participantId: s.participantId,
        value: s.amountMinor,
      }));
  const [description, setDescription] = useState(expense?.description ?? "");
  const [currency, setCurrency] = useState(expense?.currency ?? group.currency);
  const [amount, setAmount] = useState(
    expense
      ? (
          expense.amountMinor /
          10 ** currencyDecimals(expense.currency)
        ).toFixed(currencyDecimals(expense.currency))
      : "",
  );
  const [payerId, setPayer] = useState(
    expense?.payerId ??
      group.participants.find((p) => p.isSelf)?.id ??
      group.participants[0].id,
  );
  const [occurredOn, setDate] = useState(expense?.occurredOn ?? today());
  const [method, setMethod] = useState<SplitMethod>(expense?.method ?? "equal");
  const [selected, setSelected] = useState(
    original?.map((x) => x.participantId) ??
      group.participants.map((p) => p.id),
  );
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (original ?? []).map((s) => [
        s.participantId,
        String(
          s.value /
            (expense?.method === "percentage"
              ? 100
              : expense?.method === "exact"
                ? 10 ** currencyDecimals(currency)
                : 1),
        ),
      ]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const minor = minorAmount(amount, currency);
  const estimate =
    minor === null ? null : convertMinor(minor, currency, home, rates ?? {});
  function inputs(): ShareInput[] {
    return selected.map((participantId) => {
      const text = values[participantId] ?? "";
      let value = 1;
      if (method === "percentage") {
        if (!/^\d+(?:\.\d{1,2})?$/.test(text) || Number(text) > 100)
          throw new Error(
            "Use percentages from 0 to 100, with up to two decimal places.",
          );
        const [w, f = ""] = text.split(".");
        value = Number(w) * 100 + Number(f.padEnd(2, "0"));
      }
      if (method === "exact") {
        value = /^0+(?:\.0+)?$/.test(text)
          ? 0
          : (minorAmount(text, currency) ?? -1);
      }
      return { participantId, value };
    });
  }
  function chooseMethod(value: SplitMethod) {
    setMethod(value);
    setError(null);
    if (!selected.length) return;
    if (value === "percentage")
      setValues(
        Object.fromEntries(
          allocate(
            10000,
            "equal",
            selected.map((participantId) => ({ participantId, value: 1 })),
          ).map((s) => [s.participantId, String(s.amountMinor / 100)]),
        ),
      );
    if (value === "exact" && minor)
      setValues(
        Object.fromEntries(
          allocate(
            minor,
            "equal",
            selected.map((participantId) => ({ participantId, value: 1 })),
          ).map((s) => [
            s.participantId,
            (s.amountMinor / 10 ** currencyDecimals(currency)).toFixed(
              currencyDecimals(currency),
            ),
          ]),
        ),
      );
  }
  let preview: ReturnType<typeof allocate> = [];
  try {
    if (minor) preview = allocate(minor, method, inputs());
  } catch {}
  async function save() {
    try {
      if (!description.trim())
        throw new Error("Add a description for the expense.");
      if (minor === null)
        throw new Error(
          "Enter a positive amount using this currency’s decimal places.",
        );
      if (estimate === null)
        throw new Error(
          "Currency conversion is unavailable. Refresh rates before saving.",
        );
      const shares = inputs();
      allocate(minor, method, shares);
      setError(null);
      await onSave({
        action: "expense",
        id: expense?.id ?? null,
        payerId,
        description: description.trim(),
        currency,
        amountMinor: minor,
        occurredOn,
        method,
        shares,
        homeCurrency: home,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this expense.");
    }
  }
  return (
    <GroupSheet
      title={expense ? "Edit shared expense" : "Add shared expense"}
      onClose={onClose}
      busy={busy}
    >
      <GroupField
        label="Expense description"
        value={description}
        onChangeText={setDescription}
        placeholder="Dinner, train tickets, hotel…"
        maxLength={160}
      />
      <SearchPicker
        title="Expense currency"
        value={currency}
        options={CURRENCIES}
        onChange={setCurrency}
      />
      <GroupField
        label="Expense amount"
        value={amount}
        onChangeText={setAmount}
        placeholder="0.00"
        keyboardType="decimal-pad"
        maxLength={20}
      />
      {minor !== null && estimate !== null ? (
        <Text style={[font.title, { color: c.accent }]}>
          ≈ {groupFormat(estimate, home)}
        </Text>
      ) : null}
      <GroupCopy>
        {currency === home
          ? "Your home currency."
          : asOf
            ? `In your home currency (${home}). Daily reference rate: ${asOf}. The saved entry keeps its original currency.`
            : "Home-currency rates are unavailable. Refresh rates to convert this expense."}
      </GroupCopy>
      <SearchPicker
        title="Paid by"
        value={payerId}
        options={group.participants.map((p) => ({
          value: p.id,
          label: p.name + (p.isSelf ? " (you)" : ""),
        }))}
        onChange={setPayer}
      />
      <GroupField
        label="Date paid (YYYY-MM-DD)"
        value={occurredOn}
        onChangeText={setDate}
        autoCapitalize="none"
        placeholder="YYYY-MM-DD"
        maxLength={10}
      />
      <SectionLabel>How should we split it?</SectionLabel>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {(["equal", "percentage", "exact"] as const).map((value) => (
          <Chip
            key={value}
            label={
              value === "equal"
                ? "Equally"
                : value === "percentage"
                  ? "Percentage"
                  : "Exact amounts"
            }
            selected={method === value}
            onPress={() => chooseMethod(value)}
          />
        ))}
      </View>
      <GroupCopy>
        Everyone is included by default. Deselect anyone who did not share this
        expense. Any rounding remainder is allocated consistently.
      </GroupCopy>
      {group.participants.map((p) => {
        const checked = selected.includes(p.id);
        const split = preview.find((s) => s.participantId === p.id);
        return (
          <View
            key={p.id}
            style={{
              padding: space.md,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: c.border,
              gap: space.sm,
            }}
          >
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel={`Include ${p.name}`}
              accessibilityState={{ checked }}
              onPress={() => {
                setSelected((ids) =>
                  checked ? ids.filter((id) => id !== p.id) : [...ids, p.id],
                );
                setError(null);
              }}
              style={({ pressed }) => ({
                minHeight: 44,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text
                style={[font.body, { color: checked ? c.accent : c.muted }]}
              >
                {checked ? "☑" : "☐"}
              </Text>
              <Text style={[font.headline, { flex: 1, color: c.text }]}>
                {p.name}
                {p.isSelf ? " (you)" : ""}
              </Text>
              {split ? (
                <Text style={[font.body, { color: c.text }]}>
                  {groupFormat(split.amountMinor, currency)}
                </Text>
              ) : null}
            </Pressable>
            {checked && method !== "equal" ? (
              <GroupField
                label={
                  method === "percentage"
                    ? `Percentage for ${p.name}`
                    : `Amount for ${p.name} in ${currency}`
                }
                value={values[p.id] ?? ""}
                onChangeText={(value) => {
                  setValues((all) => ({ ...all, [p.id]: value }));
                  setError(null);
                }}
                keyboardType="decimal-pad"
                maxLength={20}
              />
            ) : null}
          </View>
        );
      })}
      {error ? <GroupCopy alert>{error}</GroupCopy> : null}
      <Button
        label="Save shared expense"
        onPress={() => void save()}
        busy={busy}
      />
    </GroupSheet>
  );
}
