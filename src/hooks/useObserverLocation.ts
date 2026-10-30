import { useMemo, useState } from "react";
import { useAccountLocation } from "./useAccountLocation";
import { useLocalControls } from "../lib/localControls";
import {
  loadSavedLocation,
  loadLocationCleared,
  saveLocation,
  clearSavedLocation,
} from "../lib/observerLocation";
import type { ObserverLocation } from "../lib/satellites";

interface DishCoordinates {
  lat?: number;
  lon?: number;
  alt?: number;
}

/**
 * Where the dish is, best source first: the dish itself (priority customers),
 * then the app's saved observer, then the account's location.
 */
export function useObserverLocation(dishCoordinates: DishCoordinates | undefined) {
  const { terminalId } = useLocalControls();
  const [savedObserver, setSavedObserver] = useState<ObserverLocation | null>(() =>
    loadSavedLocation(terminalId),
  );
  // Tracked apart from `savedObserver === null`, which cannot tell "never set
  // one" from "cleared it on purpose". Only the former may be filled in
  // automatically.
  const [locationCleared, setLocationCleared] = useState(() => loadLocationCleared(terminalId));
  const hasDishGps = dishCoordinates?.lat !== undefined && dishCoordinates?.lon !== undefined;
  const accountObserver = useAccountLocation(
    !hasDishGps && savedObserver === null && !locationCleared,
  );
  const observerLocation = useMemo<ObserverLocation | null>(() => {
    if (dishCoordinates?.lat !== undefined && dishCoordinates?.lon !== undefined) {
      return {
        latitudeDeg: dishCoordinates.lat,
        longitudeDeg: dishCoordinates.lon,
        altitudeM: dishCoordinates.alt ?? 0,
      };
    }
    return savedObserver ?? accountObserver;
  }, [dishCoordinates, savedObserver, accountObserver]);

  const onLocationSaved = (location: ObserverLocation) => {
    saveLocation(location, terminalId);
    setSavedObserver(location);
    setLocationCleared(false);
  };
  const onClearLocation = () => {
    clearSavedLocation(terminalId);
    setSavedObserver(null);
    setLocationCleared(true);
  };

  return { observerLocation, onLocationSaved, onClearLocation };
}
