// Minimized Chromium windows can suspend animation frames used by Playwright's
// pointer stability checks. Activate only an existing, visible, enabled control
// through its normal DOM handler when this application's window is minimized.
export async function activateControl(control, { background = false, timeout = 5000 } = {}) {
  if (!background) return control.click({ timeout });
  await control.waitFor({ state: 'visible', timeout });
  return control.evaluate(element => {
    if (!(element instanceof HTMLElement) || element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true') {
      throw new Error('Controlul CareLink este dezactivat.');
    }
    element.click();
  }, undefined, { timeout });
}
