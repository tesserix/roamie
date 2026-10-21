import { expect, jest, test } from "@jest/globals";
import { StrictMode } from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { GroupBudget } from "../../components/group-budget";
import * as api from "../group-budget-api";
import type { Group } from "../group-budget";
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => {}),
}));
jest.mock("../group-budget-api", () => ({
  listGroups: jest.fn(),
  getGroup: jest.fn(),
  createGroup: jest.fn(),
  changeGroup: jest.fn(),
  joinGroup: jest.fn(),
}));
jest.mock("../api", () => ({
  fxRates: jest.fn(async () => ({
    base: "INR",
    asOf: "21 October 2026",
    rates: { AUD: 0.018, INR: 1 },
  })),
}));

test("loads groups after React replays effect setup and cleanup", async () => {
  jest.mocked(api.listGroups).mockImplementation(async (_after, signal) => {
    if (signal?.aborted) throw new Error("Request cancelled or timed out.");
    return {
      groups: [{ id: "replayed", title: "Hanoi friends", currency: "VND" }],
      invitations: [],
      nextCursor: null,
    };
  });
  await render(
    <StrictMode>
      <GroupBudget
        home="INR"
        accountId="strict-qa"
        displayName="Alice"
        trips={[]}
        onClose={() => {}}
      />
    </StrictMode>,
  );
  expect(
    await screen.findByRole("button", { name: "Open Hanoi friends" }),
  ).toBeTruthy();
});
test("traveller creates a group, adds contact and an equal expense, then records a partial repayment", async () => {
  let group: Group = {
    id: "g",
    title: "Sydney friends",
    currency: "AUD",
    revision: 1,
    isOwner: true,
    participants: [
      {
        id: "a",
        name: "Alice",
        email: "alice@example.com",
        whatsapp: "",
        isSelf: true,
        hasAccount: true,
        invitedUntil: null,
      },
    ],
    expenses: [],
    settlements: [],
  };
  jest
    .mocked(api.listGroups)
    .mockResolvedValue({ groups: [], invitations: [], nextCursor: null });
  jest.mocked(api.createGroup).mockImplementation(async (input) => ({
    ...group,
    title: input.title,
    currency: input.currency,
  }));
  jest.mocked(api.changeGroup).mockImplementation(async (_g, _key, change) => {
    if (change.action === "participant")
      group = {
        ...group,
        participants: [
          ...group.participants,
          {
            id: "b",
            name: change.name,
            email: change.email,
            whatsapp: change.whatsapp,
            isSelf: false,
            hasAccount: false,
            invitedUntil: null,
          },
        ],
      };
    if (change.action === "expense")
      group = {
        ...group,
        expenses: [
          {
            ...change,
            id: "e",
            homeMinor: 555556,
            rateAsOf: "21 October 2026",
            splits: [
              { participantId: "a", amountMinor: 5000 },
              { participantId: "b", amountMinor: 5000 },
            ],
            canEdit: true,
          },
        ],
      };
    if (change.action === "settlement")
      group = { ...group, settlements: [{ ...change, id: "s" }] };
    group = { ...group, revision: group.revision + 1 };
    return group;
  });
  await render(
    <GroupBudget
      home="INR"
      displayName="Alice"
      trips={[{ id: "t", title: "Sydney friends", currency: "AUD" }]}
      onClose={() => {}}
    />,
  );
  await fireEvent.press(
    await screen.findByRole("button", { name: "Create a group" }),
  );
  await fireEvent.press(screen.getByRole("button", { name: "Save group" }));
  expect(await screen.findByText("Add your travellers")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Repayments" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Group options" }));
  expect(
    await screen.findByRole("button", { name: "Repayments" }),
  ).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Close" }));
  await fireEvent.press(
    await screen.findByRole("button", { name: "Add traveller" }),
  );
  await fireEvent.changeText(screen.getByLabelText("Traveller name"), "Bob");
  await fireEvent.changeText(
    screen.getByLabelText("Email (optional)"),
    "bob@example.com",
  );
  await fireEvent.changeText(
    screen.getByLabelText("WhatsApp (optional, with country code)"),
    "+61412345678",
  );
  await fireEvent.press(screen.getByRole("button", { name: "Save traveller" }));
  await waitFor(() =>
    expect(api.changeGroup).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({
        action: "participant",
        email: "bob@example.com",
      }),
      expect.anything(),
    ),
  );
  await fireEvent.press(screen.getByRole("button", { name: "Add expense" }));
  await fireEvent.changeText(
    screen.getByLabelText("Expense description"),
    "Dinner together",
  );
  await fireEvent.changeText(screen.getByLabelText("Expense amount"), "100");
  await fireEvent.press(
    screen.getByRole("button", { name: "Save shared expense" }),
  );
  expect(await screen.findByText("Dinner together")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Balances" }));
  expect(await screen.findByText("Bob owes Alice")).toBeTruthy();
  await fireEvent.press(
    screen.getByRole("button", { name: "Record repayment from Bob to Alice" }),
  );
  await fireEvent.changeText(screen.getByLabelText("Repayment amount"), "20");
  await fireEvent.press(
    screen.getByRole("button", { name: "Record repayment" }),
  );
  await waitFor(() =>
    expect(api.changeGroup).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({
        action: "settlement",
        amountMinor: 2000,
        currency: "AUD",
      }),
      expect.anything(),
    ),
  );
});
