import { expect, jest, test } from "@jest/globals";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useGroupCurrency } from "../group-currency";
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => {}),
}));
test("home currency preference is per account and a delayed read cannot override a new choice", async () => {
  let finish!: (value: string | null) => void;
  jest.mocked(AsyncStorage.getItem).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const hook = await renderHook<
    ReturnType<typeof useGroupCurrency>,
    { account: string }
  >(({ account }) => useGroupCurrency("AUD", account), {
    initialProps: { account: "alice" },
  });
  await act(async () => {
    hook.result.current.change("INR");
  });
  await act(async () => finish("USD"));
  expect(hook.result.current.home).toBe("INR");
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(
    "roamie.group-home.v1.alice",
    "INR",
  );
  await hook.rerender({ account: "bob" });
  await waitFor(() => expect(hook.result.current.home).toBe("AUD"));
});
