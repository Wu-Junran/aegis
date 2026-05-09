// AEGIS SHIM — useEffectEvent polyfill for React < 19.
// Matches the "stable identity with always-fresh closure" semantics of the
// real hook. Safe drop-in; delete this file when React 19+ is adopted.
import { useCallback, useLayoutEffect, useRef } from 'react';

export function useEffectEvent<T extends (...args: never[]) => unknown>(fn: T): T {
  const ref = useRef<T>(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  }, [fn]);
  return useCallback<T>(((...args: Parameters<T>) => ref.current(...args)) as T, []);
}
