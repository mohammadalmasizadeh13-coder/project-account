import { toolSections } from './src/workspace.js';

export async function navigateWorkspace(tool, { click, evaluate, pause }) {
  const section = toolSections[tool] || tool;
  if (await evaluate(`document.querySelector('.workspace-rail')?.getAttribute('aria-hidden') === 'true'`)) {
    await click('.workspace-menu-toggle'); await pause(260);
  }
  await click(`[data-section="${section}"]`);
  if (tool !== section) await click(`[data-tool="${tool}"]`);
}
