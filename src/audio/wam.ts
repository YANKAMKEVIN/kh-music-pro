/**
 * Hôte de plugins web (Web Audio Modules). Un plugin est un module JavaScript dont l'export par défaut
 * fournit `createInstance(groupId, audioContext)` ; l'instance expose `audioNode` (à insérer dans la chaîne),
 * et le plus souvent `createGui()` et `audioNode.getState()/setState()`.
 */
import { initializeWamHost } from '@webaudiomodules/sdk';

export interface WamInstance {
  audioNode: AudioNode & { getState?: () => Promise<unknown>; setState?: (s: unknown) => Promise<void>; destroy?: () => void };
  createGui?: () => Promise<HTMLElement>;
  descriptor?: { name?: string; vendor?: string };
}

const hosts = new WeakMap<BaseAudioContext, Promise<string>>();
function host(ctx: BaseAudioContext): Promise<string> {
  let h = hosts.get(ctx);
  if (!h) { h = initializeWamHost(ctx).then(([groupId]) => groupId); hosts.set(ctx, h); }
  return h;
}

export const wamUrl = (url: string) => new URL(url, document.baseURI).href;

/** Charge le plugin et en crée une instance sur ce contexte audio (temps réel ou rendu hors-ligne). */
export async function createWam(ctx: BaseAudioContext, url: string, state?: unknown): Promise<WamInstance> {
  const groupId = await host(ctx);
  const mod = await import(/* @vite-ignore */ wamUrl(url));
  const W = mod.default;
  if (!W || typeof W.createInstance !== 'function') throw new Error('not a web audio module');
  const inst: WamInstance = await W.createInstance(groupId, ctx);
  if (!inst?.audioNode) throw new Error('no audio node');
  if (state !== undefined && state !== null && inst.audioNode.setState) await inst.audioNode.setState(state);
  return inst;
}

/** Instances en service dans le mixeur temps réel, par « piste:effet ». */
export const liveWams = new Map<string, WamInstance>();
export const wamKey = (trackId: string, insertId: string) => trackId + ':' + insertId;
