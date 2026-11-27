import { defineConfig } from 'vitest/config';

// Tests unitaires de la logique pure (modèle de projet, temps, MIDI, sauvegarde…), sans navigateur.
// La QA de bout en bout reste dans qa/run.cjs (vrai navigateur).
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/unit/setup.ts'],
  },
});
