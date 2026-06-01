// Self-update check for `setup`/`status`. Hits the PUBLIC GET {api}/cli/latest (no token -
// it's the one server call that works without auth) to learn the latest published version
// and the server-set support floor. Never throws: an unreachable endpoint = 'unknown'.

export const INSTALL_HINT = 'npm i -g @agentage/cli@latest';

export interface CliLatest {
  version: string | null;
  minSupported: string;
  message: string | null;
}

export type UpdateStatus =
  | { kind: 'current' }
  | { kind: 'update-available'; latest: string }
  | { kind: 'unsupported'; latest: string | null; minSupported: string }
  | { kind: 'unknown' }; // couldn't reach the endpoint

export interface UpdateInfo {
  status: UpdateStatus;
  message: string | null; // server notice, verbatim
}

// Compare dotted numeric versions (major.minor.patch); prerelease/build suffixes are
// ignored - good enough for an update hint. Returns -1 / 0 / 1.
export const compareVersions = (a: string, b: string): number => {
  const parts = (v: string): number[] =>
    v
      .split('-')[0]
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
};

export const fetchCliLatest = async (
  apiUrl: string,
  timeoutMs = 3000
): Promise<CliLatest | null> => {
  try {
    const res = await fetch(`${apiUrl}/cli/latest`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { data?: Partial<CliLatest> } | null;
    const d = body?.data;
    if (!d) return null;
    return {
      version: typeof d.version === 'string' ? d.version : null,
      minSupported: typeof d.minSupported === 'string' ? d.minSupported : '0.0.0',
      message: typeof d.message === 'string' ? d.message : null,
    };
  } catch {
    return null;
  }
};

export const evaluateUpdate = (installed: string, latest: CliLatest | null): UpdateInfo => {
  if (!latest) return { status: { kind: 'unknown' }, message: null };
  const message = latest.message;
  if (compareVersions(installed, latest.minSupported) < 0) {
    return {
      status: { kind: 'unsupported', latest: latest.version, minSupported: latest.minSupported },
      message,
    };
  }
  if (latest.version && compareVersions(installed, latest.version) < 0) {
    return { status: { kind: 'update-available', latest: latest.version }, message };
  }
  return { status: { kind: 'current' }, message };
};

export const checkForUpdate = async (apiUrl: string, installed: string): Promise<UpdateInfo> =>
  evaluateUpdate(installed, await fetchCliLatest(apiUrl));
