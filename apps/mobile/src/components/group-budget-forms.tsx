import { useState } from "react";
import * as Linking from "expo-linking";
import { Button } from "./ui";
import { GroupCopy, GroupField, GroupSheet } from "./group-budget-fields";
import { SearchPicker } from "./search-picker";
import { CURRENCIES } from "@/data/currencies";
import type { Trip } from "@/lib/trips";
import type * as api from "@/lib/group-budget-api";
import {
  currencyDecimals,
  groupFormat,
  minorAmount,
  reminderText,
  reminderUrl,
  today,
  type Debt,
  type Group,
  type Participant,
} from "@/lib/group-budget";

export function CreateGroup({
  home,
  displayName,
  trips,
  onClose,
  onSave,
  busy,
}: {
  home: string;
  displayName: string;
  trips: Pick<Trip, "id" | "title" | "currency">[];
  onClose: () => void;
  onSave: (title: string, currency: string, name: string) => Promise<void>;
  busy: boolean;
}) {
  const [title, setTitle] = useState(trips[0]?.title ?? ""),
    [currency, setCurrency] = useState(trips[0]?.currency ?? home),
    [name, setName] = useState(displayName),
    [error, setError] = useState<string | null>(null);
  return (
    <GroupSheet title="New travel group" onClose={onClose} busy={busy}>
      {trips.length ? (
        <SearchPicker
          title="Start from a trip"
          value={trips.find((t) => t.title === title)?.id ?? ""}
          options={trips.map((t) => ({ value: t.id, label: t.title }))}
          onChange={(id) => {
            const trip = trips.find((t) => t.id === id);
            if (trip) {
              setTitle(trip.title);
              setCurrency(trip.currency);
            }
          }}
        />
      ) : null}
      <GroupField
        label="Group name"
        value={title}
        onChangeText={setTitle}
        placeholder="Our Australia trip"
        maxLength={120}
      />
      <GroupField
        label="Your name in this group"
        value={name}
        onChangeText={setName}
        maxLength={100}
      />
      <SearchPicker
        title="Usually spent in"
        value={currency}
        options={CURRENCIES}
        onChange={setCurrency}
      />
      <GroupCopy>
        Each expense can use a different currency. Your personal display
        currency remains {home}.
      </GroupCopy>
      {error ? <GroupCopy alert>{error}</GroupCopy> : null}
      <Button
        label="Save group"
        busy={busy}
        onPress={() => {
          if (!title.trim() || !name.trim()) {
            setError("Add a group name and your name.");
            return;
          }
          void onSave(title.trim(), currency, name.trim()).catch((e) =>
            setError(
              e instanceof Error ? e.message : "Could not create this group.",
            ),
          );
        }}
      />
    </GroupSheet>
  );
}
export function ContactEditor({
  person,
  onClose,
  onSave,
  busy,
}: {
  person: Participant | null;
  onClose: () => void;
  onSave: (input: api.GroupChange) => Promise<void>;
  busy: boolean;
}) {
  const [name, setName] = useState(person?.name ?? ""),
    [email, setEmail] = useState(person?.email ?? ""),
    [whatsapp, setWhatsapp] = useState(person?.whatsapp ?? ""),
    [error, setError] = useState<string | null>(null);
  async function save() {
    try {
      if (!name.trim()) throw new Error("Add a traveller name.");
      if (email) reminderUrl("email", email.trim(), "");
      if (whatsapp) reminderUrl("whatsapp", whatsapp.trim(), "");
      await onSave({
        action: "participant",
        id: person?.id ?? null,
        name: name.trim(),
        email: email.trim(),
        whatsapp: whatsapp.trim(),
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save this traveller.",
      );
    }
  }
  return (
    <GroupSheet
      title={person ? "Traveller details" : "Add a traveller"}
      onClose={onClose}
      busy={busy}
    >
      <GroupField
        label="Traveller name"
        value={name}
        onChangeText={setName}
        maxLength={100}
      />
      <GroupField
        label="Email (optional)"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        maxLength={254}
      />
      <GroupField
        label="WhatsApp number (international format)"
        value={whatsapp}
        onChangeText={setWhatsapp}
        keyboardType="phone-pad"
        placeholder="+61412345678"
        maxLength={16}
      />
      <GroupCopy>
        Contacts are visible to this group. Add details with the traveller’s
        permission. Saving a contact does not send a message or grant account
        access.
      </GroupCopy>
      {error ? <GroupCopy alert>{error}</GroupCopy> : null}
      <Button label="Save traveller" busy={busy} onPress={() => void save()} />
    </GroupSheet>
  );
}
export function RepaymentEditor({
  debt,
  from,
  to,
  onClose,
  onSave,
  busy,
}: {
  debt: Debt;
  from: string;
  to: string;
  onClose: () => void;
  onSave: (input: api.GroupChange) => Promise<void>;
  busy: boolean;
}) {
  const [amount, setAmount] = useState(
      (debt.amountMinor / 10 ** currencyDecimals(debt.currency)).toFixed(
        currencyDecimals(debt.currency),
      ),
    ),
    [paidOn, setDate] = useState(today()),
    [error, setError] = useState<string | null>(null);
  async function save() {
    const minor = minorAmount(amount, debt.currency);
    if (minor === null || minor > debt.amountMinor) {
      setError("Enter a positive repayment no greater than the amount owed.");
      return;
    }
    try {
      await onSave({
        action: "settlement",
        fromId: debt.fromId,
        toId: debt.toId,
        currency: debt.currency,
        amountMinor: minor,
        occurredOn: paidOn,
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not record this repayment.",
      );
    }
  }
  return (
    <GroupSheet title="Record a repayment" onClose={onClose} busy={busy}>
      <GroupCopy>
        {from} owes {to} {groupFormat(debt.amountMinor, debt.currency)}. Record
        only money already repaid outside Roamie. A partial repayment leaves the
        rest outstanding.
      </GroupCopy>
      <GroupField
        label="Repayment amount"
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        maxLength={20}
      />
      <GroupField
        label="Repayment date (YYYY-MM-DD)"
        value={paidOn}
        onChangeText={setDate}
        maxLength={10}
      />
      <GroupCopy>
        Currency: {debt.currency}. This records a payment; it does not transfer
        money.
      </GroupCopy>
      {error ? <GroupCopy alert>{error}</GroupCopy> : null}
      <Button
        label="Record repayment"
        onPress={() => void save()}
        busy={busy}
      />
    </GroupSheet>
  );
}
export function Reminder({
  group,
  debt,
  onClose,
  onEmail,
  busy,
}: {
  group: Group;
  debt: Debt;
  onClose: () => void;
  onEmail: () => Promise<void>;
  busy: boolean;
}) {
  const person = group.participants.find((p) => p.id === debt.fromId)!;
  const [error, setError] = useState<string | null>(null);
  const message = reminderText(group, debt);
  async function open(channel: "email" | "whatsapp") {
    try {
      await Linking.openURL(
        reminderUrl(
          channel,
          channel === "email" ? person.email : person.whatsapp,
          message,
        ),
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not open the message app.",
      );
    }
  }
  return (
    <GroupSheet
      title="Review a friendly reminder"
      onClose={onClose}
      busy={busy}
    >
      <GroupCopy>
        {debt.overdue
          ? "This balance has shares unpaid for at least 30 days."
          : "This balance is not yet 30 days overdue. You can still send a friendly reminder."}
      </GroupCopy>
      <GroupCopy>{message}</GroupCopy>
      <GroupCopy>
        Email to: {person.email || "Add an email in Travellers first"}. Sending
        an email shares this reminder with the recipient and our email provider,
        Resend. WhatsApp opens a prepared message for you to review and send.
      </GroupCopy>
      {error ? <GroupCopy alert>{error}</GroupCopy> : null}
      <Button
        label="Send email reminder"
        busy={busy}
        disabled={!person.email || !debt.overdue}
        onPress={() => {
          void onEmail().catch((e: unknown) =>
            setError(
              e instanceof Error ? e.message : "Could not request this email.",
            ),
          );
        }}
      />
      <Button
        label="Review WhatsApp reminder"
        kind="secondary"
        disabled={!person.whatsapp}
        onPress={() => void open("whatsapp")}
      />
      {!person.email && !person.whatsapp ? (
        <GroupCopy>
          Add an email or WhatsApp number in Travellers first.
        </GroupCopy>
      ) : null}
    </GroupSheet>
  );
}
