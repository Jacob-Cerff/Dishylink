import { createContext, useContext } from "react";
export const LocalControlContext = createContext<{ writes: boolean; terminalId?: string }>({
  writes: true,
});
export function useLocalControls() {
  return useContext(LocalControlContext);
}
