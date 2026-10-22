import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CURRENCIES } from "@/data/currencies";
const supported = new Set(CURRENCIES.map((c) => c.value));
export function useGroupCurrency(initial: string, accountId?: string) {
  const account = accountId ?? "";
  const [selection, setSelection] = useState({ account, currency: initial });
  const [error, setError] = useState<{
    account: string;
    message: string;
  } | null>(null);
  const generation = useRef(0),
    current = useRef(account),
    mounted = useRef(true),
    writes = useRef(Promise.resolve());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const version = ++generation.current;
    current.current = account;
    if (!account) return;
    AsyncStorage.getItem(`roamie.group-home.v1.${encodeURIComponent(account)}`)
      .then((value) => {
        if (
          mounted.current &&
          current.current === account &&
          generation.current === version
        )
          setSelection({
            account,
            currency: value && supported.has(value) ? value : initial,
          });
      })
      .catch(() => {
        if (mounted.current && current.current === account)
          setError({
            account,
            message: "Could not load your preferred group display currency.",
          });
      });
  }, [account, initial]);
  const change = useCallback(
    (currency: string) => {
      if (!supported.has(currency)) return;
      generation.current++;
      setSelection({ account, currency });
      setError(null);
      if (!account) return;
      const operation = writes.current
        .catch(() => {})
        .then(() =>
          AsyncStorage.setItem(
            `roamie.group-home.v1.${encodeURIComponent(account)}`,
            currency,
          ),
        );
      writes.current = operation;
      operation.catch(() => {
        if (mounted.current && current.current === account)
          setError({
            account,
            message:
              "Your currency choice is active, but could not be saved for next time.",
          });
      });
    },
    [account],
  );
  return {
    home: selection.account === account ? selection.currency : initial,
    change,
    error: error?.account === account ? error.message : null,
  };
}
