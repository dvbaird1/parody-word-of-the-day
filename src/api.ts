import { useCallback, useEffect, useState } from 'react';

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch('/api' + path, {
    ...options,
    headers: options?.body ? {'Content-Type': 'application/json'} : undefined,
  });
  if (!response.ok) {
    const body = await response.json<{error?: string}>().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${response.status}).`);
  }
  return response.status === 204 ? undefined as T : response.json();
}

export const send = <T,>(path: string, method: string, data?: unknown) =>
  api<T>(path, {method, body: data === undefined ? undefined : JSON.stringify(data)});

export function useResource<T>(path: string | null) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{path: string | null; revision: number; data?: T; error?: string}>();
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    api<T>(path, {signal: controller.signal}).then(
      data => { if (!controller.signal.aborted) setResult({path, revision, data}); },
      error => { if (!controller.signal.aborted) setResult({path, revision, error: error.message}); },
    );
    return () => controller.abort();
  }, [path, revision]);
  const current = result && result.path === path && result.revision === revision ? result : undefined;
  return {data: current?.data, error: current?.error, loading: Boolean(path && !current), refresh};
}

export function useAction() {
  const [notice, setNotice] = useState<{message: string; error?: boolean}>();
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<void>, message?: string) {
    setBusy(true);
    setNotice(undefined);
    try {
      await action();
      if (message) setNotice({message});
    } catch (error) {
      setNotice({message: error instanceof Error ? error.message : 'Something went wrong.', error: true});
    } finally {
      setBusy(false);
    }
  }
  return {notice, busy, run};
}
