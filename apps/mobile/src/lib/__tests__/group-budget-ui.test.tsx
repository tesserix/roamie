import { expect, jest, test } from "@jest/globals";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { Reminder } from "../../components/group-budget-forms";
import { ExpenseEditor } from "../../components/group-expense-editor";
import type { Group } from "../group-budget";
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
const group: Group = {
  id: "g",
  title: "Australia friends",
  currency: "AUD",
  revision: 1,
  isOwner: true,
  participants: [
    {
      id: "a",
      name: "Alice",
      email: "",
      whatsapp: "",
      isSelf: true,
      hasAccount: true,
      invitedUntil: null,
    },
    {
      id: "b",
      name: "Bob",
      email: "bob@example.com",
      whatsapp: "+61412345678",
      isSelf: false,
      hasAccount: false,
      invitedUntil: null,
    },
  ],
  expenses: [],
  settlements: [],
};
test("new expense defaults to every traveller equally and previews INR from AUD", async () => {
  const save = jest.fn(async () => {});
  await render(
    <ExpenseEditor
      group={group}
      home="INR"
      rates={{ AUD: 0.018 }}
      asOf="21 October 2026"
      onSave={save}
      onClose={() => {}}
      busy={false}
    />,
  );
  await fireEvent.changeText(
    screen.getByLabelText("Expense description"),
    "Lunch",
  );
  await fireEvent.changeText(screen.getByLabelText("Expense amount"), "100.00");
  expect(screen.getByText(/5,555.56/)).toBeTruthy();
  await fireEvent.press(
    screen.getByRole("button", { name: "Save shared expense" }),
  );
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "expense",
        method: "equal",
        amountMinor: 10000,
        currency: "AUD",
        homeCurrency: "INR",
        shares: [
          { participantId: "a", value: 1 },
          { participantId: "b", value: 1 },
        ],
      }),
    ),
  );
});
test("percentage and exact edits validate totals and preserve individual choices", async () => {
  const save = jest.fn(async () => {});
  await render(
    <ExpenseEditor
      group={group}
      home="AUD"
      rates={{ AUD: 1 }}
      asOf="today"
      onSave={save}
      onClose={() => {}}
      busy={false}
    />,
  );
  await fireEvent.changeText(
    screen.getByLabelText("Expense description"),
    "Dinner",
  );
  await fireEvent.changeText(screen.getByLabelText("Expense amount"), "100");
  await fireEvent.press(screen.getByRole("button", { name: "Percentage" }));
  await fireEvent.changeText(
    screen.getByLabelText("Percentage for Alice"),
    "60",
  );
  await fireEvent.changeText(screen.getByLabelText("Percentage for Bob"), "20");
  await fireEvent.press(
    screen.getByRole("button", { name: "Save shared expense" }),
  );
  expect(await screen.findByText("Percentages must total 100%.")).toBeTruthy();
  expect(save).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText("Percentage for Bob"), "40");
  await fireEvent.press(
    screen.getByRole("button", { name: "Save shared expense" }),
  );
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "percentage",
      shares: [
        { participantId: "a", value: 6000 },
        { participantId: "b", value: 4000 },
      ],
    }),
  );
  await fireEvent.press(screen.getByRole("button", { name: "Exact amounts" }));
  await fireEvent.changeText(
    screen.getByLabelText("Amount for Alice in AUD"),
    "70",
  );
  await fireEvent.changeText(
    screen.getByLabelText("Amount for Bob in AUD"),
    "30",
  );
  await fireEvent.press(
    screen.getByRole("button", { name: "Save shared expense" }),
  );
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "exact",
      shares: [
        { participantId: "a", value: 7000 },
        { participantId: "b", value: 3000 },
      ],
    }),
  );
});

test("email reminder is reviewed explicitly and queued only after the send action", async () => {
  const send = jest.fn(async () => {});
  await render(
    <Reminder
      group={group}
      debt={{
        fromId: "b",
        toId: "a",
        currency: "AUD",
        amountMinor: 5000,
        oldestOn: "2026-09-01",
        overdue: true,
      }}
      onClose={() => {}}
      onEmail={send}
      busy={false}
    />,
  );
  expect(send).not.toHaveBeenCalled();
  expect(screen.getByText(/bob@example.com/)).toBeTruthy();
  await fireEvent.press(
    screen.getByRole("button", { name: "Send email reminder" }),
  );
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
});
