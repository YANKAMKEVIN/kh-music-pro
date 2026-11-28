// Ouverture et enregistrement des fichiers de projet (.khm), y compris dans la version bureau.
import { engine } from '../audio/engine';
import { t } from '../i18n';
import { ProjectError } from '../persist';
import { linkFile, loadProjectFile, pidOfFile, S, serializeProject, setDirty } from '../store';
import { toast } from '../ui/dom';
import { saveWamStates } from './fx';
import { download, safeName } from './export';

/** Version bureau (electron/preload.cjs) : fichiers de projet sur le disque. Absent dans le navigateur. */
export interface DeskFile { path: string; name: string; text?: string }
export interface DeskFiles {
  open(): Promise<DeskFile | null>; openRecent(path: string): Promise<DeskFile>;
  save(path: string, text: string): Promise<DeskFile>; saveAs(name: string, text: string): Promise<DeskFile | null>;
  recent(): Promise<DeskFile[]>; clearRecent(): Promise<boolean>; onOpen(fn: (f: DeskFile) => void): void; edited(on: boolean): void;
}
export const deskFiles = (): DeskFiles | null => (window as unknown as { khFiles?: DeskFiles }).khFiles ?? null;
/** Enregistrer : dans la version bureau, réécrit le fichier du projet (ou demande où l'enregistrer la première fois) ; dans le navigateur, télécharge le .khm. */
export async function saveFile(): Promise<void> {
  const d = deskFiles();
  if (d && S.file.path) {
    await saveWamStates();
    try { linkFile(await d.save(S.file.path, serializeProject())); setDirty(false); toast(t('file.saved', S.file.name)); }
    catch { toast(t('file.saveFail'), 'error'); }
    return;
  }
  if (d) return saveFileAs();
  await saveWamStates();
  download(new Blob([serializeProject()], { type: 'application/json' }), safeName() + '.khm');
  toast(t('toast.saved'));
}
/** Enregistrer sous : fenêtre du système, dossier et nom au choix (version bureau). Dans le navigateur : comme Enregistrer. */
export async function saveFileAs(): Promise<void> {
  const d = deskFiles();
  if (!d) return saveFile();
  await saveWamStates();
  try {
    const f = await d.saveAs(S.project.name || 'Projet', serializeProject());
    if (!f) return;
    linkFile(f); setDirty(false); toast(t('file.saved', f.name));
  } catch { toast(t('file.saveFail'), 'error'); }
}
/** Fichier projet refusé : créé par une version plus récente, ou illisible. */
const badProject = (e: unknown) => toast(t(e instanceof ProjectError && e.code === 'newer' ? 'toast.newerProject' : 'toast.badProject'), 'error');
function openText(f: DeskFile) {
  engine.stop(); loadProjectFile(f.text ?? '', pidOfFile(f.path)); linkFile(f); setDirty(false);
  toast(t('file.opened', f.name)); engine.prepare();
}
/** Ouvrir : fenêtre du système dans la version bureau, sélecteur de fichier dans le navigateur. */
export async function openProjectFile() {
  const d = deskFiles();
  if (!d) { document.getElementById('fProj')?.click(); return; }
  try { const f = await d.open(); if (f) openText(f); }
  catch (e) { badProject(e); }
}
export async function openRecentFile(path: string, name: string) {
  const d = deskFiles(); if (!d) return;
  let f: DeskFile;
  try { f = await d.openRecent(path); } catch { toast(t('file.missing', name), 'error'); return; }
  try { openText(f); } catch (e) { badProject(e); }
}
/** Fichier .khm ouvert depuis le Finder (double-clic, glisser sur le Dock). */
export function listenSystemOpen() {
  deskFiles()?.onOpen(f => { try { openText(f); } catch (e) { badProject(e); } });
}
export async function openFile(f: File) {
  try { engine.stop(); loadProjectFile(await f.text()); toast(t('toast.opened')); engine.prepare(); }
  catch (e) { badProject(e); }
}
