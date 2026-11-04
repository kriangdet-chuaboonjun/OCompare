/** Exercise a real toolbar command through its visible button or the overflow popup. */
export async function clickToolbarCommand(page, selector) {
  // Resizing and mode activation schedule measurement for the next animation frame.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const button = page.locator(selector)
  if (selector === '#theme-toggle' || selector === '#check-updates') {
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    if (!await settings.count()) await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await button.click()
    if (await settings.count()) await settings.getByRole('button', { name: 'Close settings', exact: true }).click()
    return
  }
  if (await button.isVisible()) return button.click()
  const label = await button.getAttribute('aria-label') || (await button.textContent()).trim()
  await page.getByRole('button', { name: 'More commands', exact: true }).click()
  const menu = page.getByRole('menu', { name: 'More commands' })
  await menu.getByRole('menuitem', { name: label, exact: true })
    .or(menu.getByRole('menuitemcheckbox', { name: label, exact: true })).click()
}
