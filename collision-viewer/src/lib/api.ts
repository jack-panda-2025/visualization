/**
 * Backend API client.
 * BASE_URL defaults to same origin (after deployment) but can be overridden
 * via VITE_API_BASE_URL env var for local dev (e.g. http://localhost:8000).
 */
const BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export interface SimulationItem {
  id: string;
  name: string;
  size: number;
  last_modified: string;
}

export async function fetchSimulations(): Promise<SimulationItem[]> {
  const res = await fetch(`${BASE}/api/simulations`);
  if (!res.ok) throw new Error(`Failed to list simulations: HTTP ${res.status}`);
  return res.json();
}

export async function fetchSignedUrl(simId: string): Promise<string> {
  const res = await fetch(`${BASE}/api/simulations/${encodeURIComponent(simId)}/signed-url`);
  if (!res.ok) throw new Error(`Failed to get signed URL: HTTP ${res.status}`);
  const { url } = await res.json();
  return url;
}
