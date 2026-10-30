import { useEffect, useSyncExternalStore } from "react";
import type { AccountQuery } from "../lib/accountClient";
export function useAccountQuery<T>(query: AccountQuery<T>) {
  const state = useSyncExternalStore(query.subscribe, query.get);
  useEffect(() => {
    void query.load();
  }, [query, state.data]);
  return state;
}
