import { useCallback, useSyncExternalStore } from "react";
import { accountHash, parseAccountRoute, type AccountRoute } from "../lib/accountRoute";
const subscribe = (listener: () => void) => {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
};
export function useAccountRoute() {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  const navigate = useCallback((route: AccountRoute) => {
    window.location.hash = accountHash(route);
  }, []);
  return { route: parseAccountRoute(hash), navigate };
}
