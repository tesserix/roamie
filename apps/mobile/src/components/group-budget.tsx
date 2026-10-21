import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, FlatList, Pressable, useWindowDimensions, Share, View } from 'react-native';
import { Text } from '@/components/typography';
import {
  Button,
  Card,
  Chip,
  IconButton,
  Message,
  Screen,
  TAB_CLEARANCE,
} from "./ui";
import { GroupCopy, GroupSheet } from "./group-budget-fields";
import {
  CreateGroup,
  ContactEditor,
  RepaymentEditor,
  Reminder,
} from "./group-budget-forms";
import { ExpenseEditor } from "./group-expense-editor";
import { SearchPicker } from "./search-picker";
import { font, lift, radius, space, useColors } from "@/constants/theme";
import { useTextScale } from "@/lib/accessibility";
import { CURRENCIES } from "@/data/currencies";
import { fxRates } from "@/lib/api";
import { ApiError } from "@/lib/trip-api";
import * as api from "@/lib/group-budget-api";
import {
  convertMinor,
  debts,
  groupFormat,
  type Debt,
  type Group,
  type GroupExpense,
  type GroupList,
  type Participant,
} from "@/lib/group-budget";
import { newId, type Trip } from "@/lib/trips";
import { useGroupCurrency } from "@/lib/group-currency";

type Props = {
  home: string;
  accountId?: string;
  displayName: string;
  trips: Pick<Trip, "id" | "title" | "currency">[];
  onClose: () => void;
};
type Pane =
  "Balances" | "Expenses" | "Travellers" | "Repayments" | "Email reminders";
type Entry = {
  id: string;
  title: string;
  subtitle: string;
  amount?: string;
  estimate?: string;
  overdue?: boolean;
  actions: { label: string; text?: string; run: () => void }[];
};
export function GroupBudget({
  home: initialHome,
  accountId,
  displayName,
  trips,
  onClose,
}: Props) {
  const preference = useGroupCurrency(initialHome, accountId),
    home = preference.home;
  const homeRef = useRef(home);
  useEffect(() => {
    homeRef.current = home;
  }, [home]);
  const c = useColors();
  const { width } = useWindowDimensions();
  const textScale = useTextScale();
  const stackAmounts = width < 360 || textScale > 1.15;
  const [listing, setListing] = useState<GroupList>({
    groups: [],
    invitations: [],
    nextCursor: null,
  });
  const [group, setGroup] = useState<Group | null>(null);
  const [pane, setPane] = useState<Pane>("Balances");
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<{
    base: string;
    rates: Record<string, number>;
    asOf: string;
  } | null>(null);
  const [rateError, setRateError] = useState(false);
  const [options, setOptions] = useState(false);
  const [create, setCreate] = useState(false),
    [person, setPerson] = useState<Participant | null | undefined>(undefined);
  const [expense, setExpense] = useState<GroupExpense | null | undefined>(
    undefined,
  );
  const [repayment, setRepayment] = useState<Debt | null>(null),
    [reminder, setReminder] = useState<Debt | null>(null);
  const controller = useRef(new AbortController());
  const pending = useRef<{ body: string; id: string } | null>(null),
    saving = useRef(false),
    selected = useRef<Group | null>(null),
    requested = useRef<string | null>(null);
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    return () => active.abort();
  }, []);
  const accept = useCallback((data: Group) => {
    setGroup((previous) =>
      previous?.id === data.id && previous.revision > data.revision
        ? previous
        : data,
    );
    selected.current = data;
    requested.current = data.id;
  }, []);
  const rates = useCallback(() => {
    const signal = controller.current.signal;
    return fxRates(home)
      .then((data) => {
        if (!signal.aborted && homeRef.current === home && data.base === home) {
          setQuote(data);
          setRateError(false);
        }
      })
      .catch(() => {
        if (!signal.aborted && homeRef.current === home) {
          setQuote(null);
          setRateError(true);
        }
      });
  }, [home]);
  const list = useCallback((after?: string) => {
    const signal = controller.current.signal;
    return api
      .listGroups(after, signal)
      .then((data) => {
        if (!signal.aborted) {
          setListing((previous) =>
            after
              ? {
                  ...data,
                  groups: [
                    ...previous.groups,
                    ...data.groups.filter(
                      (g) => !previous.groups.some((x) => x.id === g.id),
                    ),
                  ],
                }
              : data,
          );
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!signal.aborted)
          setError(
            e instanceof Error ? e.message : "Could not load your groups.",
          );
      })
      .finally(() => {
        if (!signal.aborted) setLoading(false);
      });
  }, []);
  const open = useCallback(
    async (id: string) => {
      const signal = controller.current.signal;
      requested.current = id;
      setLoading(true);
      try {
        const data = await api.getGroup(id, signal);
        if (!signal.aborted && requested.current === id) {
          accept(data);
          setError(null);
        }
      } catch (e) {
        if (!signal.aborted)
          setError(
            e instanceof Error ? e.message : "Could not open this group.",
          );
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [accept],
  );
  useEffect(() => {
    void list();
    void rates();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void rates();
        if (selected.current) void open(selected.current.id);
        else void list();
      }
    });
    return () => subscription.remove();
  }, [list, open, rates]);
  function key(body: unknown) {
    const encoded = JSON.stringify(body);
    if (pending.current?.body !== encoded)
      pending.current = { body: encoded, id: newId() };
    return pending.current.id;
  }
  async function change(input: api.GroupChange) {
    const signal = controller.current.signal;
    if (!group || saving.current)
      throw new Error("Wait for the current save to finish.");
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api.changeGroup(
        group,
        key({ id: group.id, revision: group.revision, input }),
        input,
        signal,
      );
      if (!signal.aborted) {
        accept(result);
        pending.current = null;
      }
      return result;
    } catch (e) {
      if (!signal.aborted) {
        setError(
          e instanceof Error ? e.message : "Could not save this change.",
        );
        if (e instanceof ApiError && e.status === 409) {
          pending.current = null;
          void open(group.id);
        }
      }
      throw e;
    } finally {
      saving.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }
  async function createGroup(title: string, currency: string, name: string) {
    const signal = controller.current.signal;
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      const input = { title, currency, displayName: name };
      const result = await api.createGroup(
        { ...input, requestId: key(input) },
        signal,
      );
      if (!signal.aborted) {
        accept(result);
        pending.current = null;
        setCreate(false);
        setPane("Travellers");
        setError(null);
      }
    } finally {
      saving.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }
  async function join(id: string) {
    const signal = controller.current.signal;
    setBusy(true);
    try {
      const result = await api.joinGroup(id, signal);
      if (!signal.aborted) {
        accept(result);
        setError(null);
      }
    } catch (e) {
      if (!signal.aborted)
        setError(e instanceof Error ? e.message : "Could not join this group.");
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  function confirm(title: string, body: string, input: api.GroupChange) {
    Alert.alert(title, body, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Confirm",
        onPress: () => {
          void change(input).catch(() => {});
        },
      },
    ]);
  }
  const estimate = (amount: number, currency: string) => {
    const converted = convertMinor(
      amount,
      currency,
      home,
      quote?.base === home ? quote.rates : {},
    );
    return converted === null
      ? `Conversion to ${home} unavailable`
      : currency === home
        ? undefined
        : `≈ ${groupFormat(converted, home)}`;
  };
  const currentDebts = group ? debts(group.expenses, group.settlements) : [];
  const name = (id: string) =>
    group?.participants.find((p) => p.id === id)?.name ?? "Traveller";
  let entries: Entry[] = [];
  if (group) {
    if (pane === "Balances")
      entries = [...currentDebts]
        .sort((a, b) => Number(b.overdue) - Number(a.overdue))
        .map((d) => ({
          id: `${d.fromId}:${d.toId}:${d.currency}`,
          title: `${name(d.fromId)} owes ${name(d.toId)}`,
          subtitle: `${d.overdue ? "30+ days unpaid · " : "Unpaid since "}${d.oldestOn}`,
          amount: groupFormat(d.amountMinor, d.currency),
          estimate: estimate(d.amountMinor, d.currency),
          overdue: d.overdue,
          actions: [
            ...(group.isOwner ||
            group.participants.some(
              (p) => p.isSelf && (p.id === d.fromId || p.id === d.toId),
            )
              ? [
                  {
                    label: `Record repayment from ${name(d.fromId)} to ${name(d.toId)}`,
                    text: "Settle",
                    run: () => setRepayment(d),
                  },
                ]
              : []),
            ...(group.isOwner ||
            group.participants.some((p) => p.isSelf && p.id === d.toId)
              ? [
                  {
                    label: `Remind ${name(d.fromId)}`,
                    text: "Remind",
                    run: () => setReminder(d),
                  },
                ]
              : []),
          ],
        }));
    if (pane === "Expenses")
      entries = group.expenses.map((e) => ({
        id: e.id,
        title: e.description,
        subtitle: `${name(e.payerId)} paid · ${e.occurredOn} · ${e.method === "equal" ? "Equal split" : e.method === "percentage" ? "Percentage split" : "Exact split"}`,
        amount: groupFormat(e.amountMinor, e.currency),
        estimate: estimate(e.amountMinor, e.currency),
        actions: e.canEdit
          ? [
              {
                label: `Edit shared expense ${e.description}`,
                text: "Edit",
                run: () => setExpense(e),
              },
              {
                label: `Remove shared expense ${e.description}`,
                text: "Remove",
                run: () =>
                  confirm(
                    "Remove shared expense?",
                    "Its repayment history remains recorded. Any overpayment will be shown as owed back.",
                    { action: "voidExpense", id: e.id },
                  ),
              },
            ]
          : [],
      }));
    if (pane === "Travellers")
      entries = group.participants.map((p) => ({
        id: p.id,
        title: p.name + (p.isSelf ? " (you)" : ""),
        subtitle: [
          p.email,
          p.whatsapp,
          p.hasAccount
            ? "Connected to Roamie"
            : p.invitedUntil
              ? `Invited until ${p.invitedUntil}`
              : "Recorded traveller · no account needed",
        ]
          .filter(Boolean)
          .join("\n"),
        actions: [
          ...(group.isOwner || p.isSelf
            ? [
                {
                  label: `Edit contact ${p.name}`,
                  text: "Edit",
                  run: () => setPerson(p),
                },
              ]
            : []),
          ...(group.isOwner && !p.hasAccount && p.email
            ? [
                {
                  label: `Invite ${p.name} to Roamie`,
                  text: "Invite",
                  run: () => {
                    Alert.alert(
                      `Invite ${p.name}?`,
                      "This allows the verified owner of this email address to view this group, its contacts and expenses, and add expenses. The invitation lasts seven days.",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Invite",
                          onPress: () => {
                            void change({
                              action: "invite",
                              participantId: p.id,
                            })
                              .then(() =>
                                Alert.alert(
                                  "Invitation ready",
                                  `Ask ${p.name} to sign in with ${p.email} and open Budget → Split with a group.`,
                                  [
                                    { text: "OK" },
                                    {
                                      text: "Share invitation",
                                      onPress: () => {
                                        void Share.share({
                                          message: `Join our Roamie group “${group.title}”. Sign in with ${p.email}, then open Budget → Split with a group and accept your invitation. The invitation expires after seven days.`,
                                        }).catch(() =>
                                          setError(
                                            "Could not open sharing. Try again.",
                                          ),
                                        );
                                      },
                                    },
                                  ],
                                ),
                              )
                              .catch(() => {});
                          },
                        },
                      ],
                    );
                  },
                },
              ]
            : []),
          ...(group.isOwner && p.hasAccount && !p.isSelf
            ? [
                {
                  label: `Remove access for ${p.name}`,
                  text: "Remove access",
                  run: () =>
                    confirm(
                      "Remove this traveller’s access?",
                      "Their expenses and repayments stay in the group, but this account will no longer be able to view or change it.",
                      { action: "revokeAccess", participantId: p.id },
                    ),
                },
              ]
            : []),
          ...(group.isOwner && p.invitedUntil
            ? [
                {
                  label: `Revoke invitation for ${p.name}`,
                  text: "Revoke invite",
                  run: () =>
                    confirm(
                      "Revoke this invitation?",
                      "This stops this email address from joining using the pending invitation.",
                      { action: "revokeInvite", participantId: p.id },
                    ),
                },
              ]
            : []),
        ],
      }));
    if (pane === "Email reminders")
      entries = (group.emails ?? []).map((email) => ({
        id: email.id,
        title: `Reminder for ${name(email.fromId)}`,
        subtitle: `${{ queued: "Queued to send", accepted: "Accepted for sending; delivery is not confirmed", failed: "Could not confirm sending", cancelled: "Cancelled before further attempts" }[email.status]} · ${new Date(email.requestedAt).toLocaleDateString()}`,
        amount: groupFormat(email.amountMinor, email.currency),
        actions: [],
      }));
    if (pane === "Repayments")
      entries = group.settlements.map((s) => ({
        id: s.id,
        title: `${name(s.fromId)} repaid ${name(s.toId)}`,
        subtitle: `${s.occurredOn} · Recorded payment; Roamie does not transfer money`,
        amount: groupFormat(s.amountMinor, s.currency),
        estimate: estimate(s.amountMinor, s.currency),
        actions:
          group.isOwner ||
          group.participants.some(
            (p) => p.isSelf && (p.id === s.fromId || p.id === s.toId),
          )
            ? [
                {
                  label: `Correct repayment ${name(s.fromId)} to ${name(s.toId)}`,
                  text: "Correct",
                  run: () =>
                    confirm(
                      "Undo this recorded repayment?",
                      "Only use this to correct a recording mistake. This does not reverse an actual bank payment.",
                      { action: "voidSettlement", id: s.id },
                    ),
                },
              ]
            : [],
      }));
  }
  const rateControls = (
    <View style={{ gap: space.md, paddingTop: space.md }}>
      <GroupCopy>
        {quote?.base === home
          ? `Daily reference rates · updated ${quote.asOf}. Home currency: ${home}.`
          : "Home-currency conversion is unavailable. Original amounts remain visible."}
      </GroupCopy>
      <Button
        label={rateError ? "Retry exchange rates" : "Refresh rates"}
        kind="secondary"
        onPress={() => void rates()}
      />
      {group ? (
        <Button
          label="Refresh shared expenses"
          kind="secondary"
          onPress={() => void open(group.id)}
          busy={loading}
        />
      ) : null}
    </View>
  );
  const header = (
    <View style={{ gap: space.md, paddingBottom: space.md }}>
      {preference.error ? (
        <GroupCopy alert>{preference.error}</GroupCopy>
      ) : null}
      {group ? (
        <>
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: space.sm,
            }}
          >
            <Text style={[font.caption, { color: c.muted }]}>
              {group.participants.length} travellers · {group.expenses.length}{" "}
              {group.expenses.length === 1 ? "expense" : "expenses"}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Viewing in ${home}. Change currency`}
              onPress={() => setOptions(true)}
              style={({ pressed }) => ({
                minHeight: 44,
                justifyContent: "center",
                paddingHorizontal: 12,
                borderRadius: radius.pill,
                backgroundColor: c.surface,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={[font.caption, { color: c.accent }]}>
                Viewing in {home} ⌄
              </Text>
            </Pressable>
          </View>
          {group.participants.length === 1 && pane === "Travellers" ? (
            <View style={{ gap: space.xs }}>
              <Text
                style={[font.title, { color: c.text }]}
                accessibilityRole="header"
              >
                Add your travellers
              </Text>
              <GroupCopy>
                Start with their names. Add an email to invite them; WhatsApp is
                optional.
              </GroupCopy>
            </View>
          ) : null}
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}
          >
            <Button
              label="Add expense"
              icon="plus"
              onPress={() => setExpense(null)}
              disabled={busy || loading}
              style={{ flex: 1, minWidth: 160 }}
            />
            {group.isOwner ? (
              <Button
                label="Add traveller"
                kind="secondary"
                onPress={() => setPerson(null)}
                disabled={busy || loading}
                style={{ flex: 1, minWidth: 160 }}
              />
            ) : null}
          </View>
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}
          >
            {(["Balances", "Expenses", "Travellers"] as const).map((value) => (
              <Chip
                key={value}
                label={value === "Travellers" ? "People" : value}
                selected={pane === value}
                onPress={() => setPane(value)}
              />
            ))}
          </View>
        </>
      ) : (
        <>
          <Text style={[font.title, { color: c.text }]}>
            Travel together. Split simply.
          </Text>
          <GroupCopy>
            Create a group, add your travellers, then share trip expenses.
          </GroupCopy>
          <Button
            label="Create a group"
            icon="plus"
            onPress={() => setCreate(true)}
            disabled={busy}
          />
          {listing.invitations.map((invite) => (
            <Card key={invite.id} style={{ gap: space.sm }}>
              <Text style={[font.headline, { color: c.text }]}>
                Invitation: {invite.title}
              </Text>
              <GroupCopy>
                Joining shares group expenses and contacts with the other
                members.
              </GroupCopy>
              <Button
                label={`Join ${invite.title}`}
                onPress={() => void join(invite.id)}
                busy={busy}
              />
            </Card>
          ))}
        </>
      )}
      {error ? (
        <>
          <GroupCopy alert>{error}</GroupCopy>
          <Button
            label="Retry group connection"
            kind="secondary"
            onPress={() => {
              if (group) void open(group.id);
              else void list();
            }}
          />
        </>
      ) : null}
      {group && pane === "Balances" && currentDebts.some((d) => d.overdue) ? (
        <View
          style={{
            padding: space.md,
            borderRadius: radius.md,
            backgroundColor: c.warnSoft,
            gap: space.xs,
          }}
        >
          <Text
            accessibilityRole="header"
            style={[font.headline, { color: c.warn }]}
          >
            Unsettled over 30 days
          </Text>
          <Text style={[font.body, { color: c.text }]}>
            Review the highlighted balances and send a friendly reminder.
          </Text>
        </View>
      ) : null}
      {group ? (
        <Text
          accessibilityRole="header"
          style={[font.overline, { color: c.muted }]}
        >
          {pane === "Balances"
            ? "Who owes whom"
            : pane === "Travellers"
              ? "People"
              : pane}
        </Text>
      ) : null}
    </View>
  );
  return (
    <Screen
      title={group ? "Budget" : "Group expenses"}
      subtitle={group?.title ?? "Split with a group"}
      right={
        <View style={{ flexDirection: "row", gap: space.xs }}>
          <IconButton
            icon="arrow.left"
            label={group ? "All groups" : "Back to personal budget"}
            onPress={() => {
              if (busy) return;
              if (group) {
                setGroup(null);
                selected.current = null;
                requested.current = null;
                void list();
              } else onClose();
            }}
          />
          <IconButton
            icon="ellipsis"
            label="Group options"
            onPress={() => setOptions(true)}
          />
        </View>
      }
    >
      {group ? (
        <FlatList
          key={pane}
          data={entries}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            padding: space.md,
            gap: space.md,
            paddingBottom: TAB_CLEARANCE,
          }}
          ListHeaderComponent={header}
          ListFooterComponent={
            rateError ? (
              <Button
                label="Retry exchange rates"
                kind="secondary"
                onPress={() => void rates()}
              />
            ) : (
              <Text
                style={[font.caption, { color: c.muted, paddingTop: space.sm }]}
              >
                Converted amounts are estimates using daily reference rates.
              </Text>
            )
          }
          ListEmptyComponent={
            <Message
              icon="wallet.pass.fill"
              title={
                pane === "Balances"
                  ? group.expenses.length
                    ? "All settled up"
                    : "No shared spending yet"
                  : `No ${pane.toLowerCase()} yet`
              }
              body={
                pane === "Balances"
                  ? "Add an expense to see who owes whom."
                  : "New records appear here after they are saved."
              }
            />
          }
          renderItem={({ item }) => (
            <View
              style={{
                ...lift,
                padding: 12,
                gap: space.xs,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: item.overdue ? c.warn : c.border,
                backgroundColor: item.overdue ? c.warnSoft : c.surface,
              }}
            >
              <View
                style={{
                  flexDirection: stackAmounts ? "column" : "row",
                  justifyContent: "space-between",
                  alignItems: stackAmounts ? "stretch" : "flex-start",
                  gap: space.sm,
                }}
              >
                <View style={{ flex: 1, gap: space.xs }}>
                  <Text style={[font.headline, { color: c.text }]}>
                    {item.title}
                  </Text>
                  <Text style={[font.caption, { color: c.muted }]}>
                    {item.subtitle}
                  </Text>
                </View>
                {item.amount ? (
                  <View
                    style={{
                      alignItems: stackAmounts ? "flex-start" : "flex-end",
                      gap: 2,
                      flexShrink: 1,
                    }}
                  >
                    <Text
                      style={[
                        font.title,
                        { color: item.overdue ? c.warn : c.accent },
                      ]}
                    >
                      {item.amount}
                    </Text>
                    {item.estimate ? (
                      <Text style={[font.caption, { color: c.muted }]}>
                        {item.estimate}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
              {item.actions.length ? (
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: space.sm,
                    justifyContent: "flex-end",
                  }}
                >
                  {item.actions.map((action) => (
                    <Pressable
                      key={action.label}
                      accessibilityRole="button"
                      accessibilityLabel={action.label}
                      accessibilityState={{ disabled: busy }}
                      disabled={busy}
                      onPress={action.run}
                      style={({ pressed }) => ({
                        minHeight: 44,
                        minWidth: 64,
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: radius.md,
                        backgroundColor:
                          action.text === "Settle"
                            ? c.accentSoft
                            : "transparent",
                        opacity: busy ? 0.4 : pressed ? 0.7 : 1,
                      })}
                    >
                      <Text
                        style={[
                          font.headline,
                          { color: c.accent, fontSize: 15 },
                        ]}
                      >
                        {action.text ?? action.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          )}
        />
      ) : (
        <FlatList
          data={listing.groups}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            padding: space.md,
            gap: space.md,
            paddingBottom: TAB_CLEARANCE,
          }}
          ListHeaderComponent={header}
          ListEmptyComponent={
            !loading ? (
              <Message
                icon="wallet.pass.fill"
                title="Your first shared adventure"
                body="Create a group, add your fellow travellers and start with one expense."
              />
            ) : null
          }
          renderItem={({ item }) => (
            <Button
              label={`Open ${item.title}`}
              kind="secondary"
              onPress={() => {
                setPane("Balances");
                void open(item.id);
              }}
              disabled={busy || loading}
            />
          )}
          ListFooterComponent={
            listing.nextCursor ? (
              <Button
                label="More groups"
                kind="secondary"
                busy={loading}
                onPress={() => void list(listing.nextCursor ?? undefined)}
              />
            ) : null
          }
        />
      )}
      {options ? (
        <GroupSheet
          title="Group options"
          onClose={() => setOptions(false)}
          busy={busy}
        >
          <SearchPicker
            title="Your home currency"
            value={home}
            options={CURRENCIES}
            onChange={preference.change}
          />
          {group ? (
            <>
              <Button
                label="Repayments"
                kind="secondary"
                onPress={() => {
                  setPane("Repayments");
                  setOptions(false);
                }}
              />
              <Button
                label="Email reminders"
                kind="secondary"
                onPress={() => {
                  setPane("Email reminders");
                  setOptions(false);
                }}
              />
              <GroupCopy>
                Balances stay in the original currency. Conversions are
                estimates in {home}. Recording a repayment does not move money
                or add to trip spending.
              </GroupCopy>
            </>
          ) : null}
          {rateControls}
        </GroupSheet>
      ) : null}
      {create ? (
        <CreateGroup
          home={home}
          displayName={displayName}
          trips={trips}
          onClose={() => setCreate(false)}
          onSave={createGroup}
          busy={busy}
        />
      ) : null}
      {person !== undefined && group ? (
        <ContactEditor
          person={person}
          onClose={() => setPerson(undefined)}
          busy={busy}
          onSave={async (input) => {
            await change(input);
            setPerson(undefined);
            setPane("Travellers");
          }}
        />
      ) : null}
      {expense !== undefined && group ? (
        <ExpenseEditor
          group={group}
          home={home}
          rates={quote?.base === home ? quote.rates : null}
          asOf={quote?.base === home ? quote.asOf : null}
          expense={expense ?? undefined}
          busy={busy}
          onClose={() => setExpense(undefined)}
          onSave={async (input) => {
            await change(input);
            setExpense(undefined);
            setPane("Expenses");
          }}
        />
      ) : null}
      {repayment && group ? (
        <RepaymentEditor
          debt={repayment}
          from={name(repayment.fromId)}
          to={name(repayment.toId)}
          busy={busy}
          onClose={() => setRepayment(null)}
          onSave={async (input) => {
            await change(input);
            setRepayment(null);
          }}
        />
      ) : null}
      {reminder && group ? (
        <Reminder
          group={group}
          debt={reminder}
          busy={busy}
          onEmail={async () => {
            await change({
              action: "emailReminder",
              fromId: reminder.fromId,
              toId: reminder.toId,
              currency: reminder.currency,
            });
            setReminder(null);
            setPane("Email reminders");
          }}
          onClose={() => setReminder(null)}
        />
      ) : null}
    </Screen>
  );
}
