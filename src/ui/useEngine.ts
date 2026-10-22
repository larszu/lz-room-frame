import { useSyncExternalStore } from 'react';
import { engine } from '../engine/engine';

/** Re-renders whenever the engine changes (settings, status once per second). */
export function useEngine() {
  useSyncExternalStore(engine.subscribe, engine.getVersion);
  return engine;
}
