import type { Analyzer } from './types';

const list: Analyzer[] = [];
/** Chaque analyse s'inscrit ici depuis son propre fichier (voir `src/analysis/index.ts`). */
export function registerAnalyzer(a: Analyzer) { if (!list.some(x => x.id === a.id)) list.push(a); list.sort((x, y) => x.order - y.order); }
export const analyzers = () => list;
/** QA : retire les analyses factices (identifiant commençant par « qa- »). */
export function dropTestAnalyzers() { for (let i = list.length - 1; i >= 0; i--) if (list[i].id.startsWith('qa-')) list.splice(i, 1); }
