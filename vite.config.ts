import { defineConfig, Plugin } from 'vite';

/**
 * Règle de contenu (Content-Security-Policy) de la version construite : site web et version bureau.
 * Elle limite ce que la page peut charger : son propre code, les sons et worklets créés en mémoire (blob:), et, pour les
 * plugins web venus d'un autre site (accord explicite de l'utilisateur), leur code et leurs fichiers en https.
 * Ni eval, ni objets intégrés, ni cadres, ni envoi de formulaire. Pas pendant le développement (rechargement à chaud de Vite).
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' blob: https: 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  "font-src 'self' data: https:",
  "connect-src 'self' blob: data: https:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-src 'none'",
].join('; ');

const csp = (): Plugin => ({
  name: 'kh-csp',
  apply: 'build',
  transformIndexHtml: html => html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n  <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

// Chemins relatifs : la version construite fonctionne à la racine d'un site comme dans un sous-dossier (GitHub Pages).
export default defineConfig({ base: './', plugins: [csp()] });
