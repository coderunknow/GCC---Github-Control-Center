// Helpers shared by route handlers and server components.

import { fetchViewer, type Viewer } from './queries';
import { githubConfigured } from './github';
import { getStore } from './db';

/** The signed-in GitHub account, or null when unavailable. Never throws. */
export async function safeViewer(): Promise<Viewer | null> {
  if (!githubConfigured()) return null;
  try {
    return await fetchViewer();
  } catch {
    return null;
  }
}

export function databaseStatus(): { available: boolean; detail: string } {
  const store = getStore();
  return { available: store.available, detail: store.status.detail };
}

/** Parses a positive integer query parameter with a bounded fallback. */
export function intParam(value: string | string[] | undefined, fallback: number, max: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export function strParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? '').trim().slice(0, 200);
}

export function enumParam<T extends string>(
  value: string | string[] | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = Array.isArray(value) ? value[0] : value;
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}
