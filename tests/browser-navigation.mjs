/** Includes collapsed destinations so access and active-route assertions remain meaningful. */
export const navigationItem = (page, name) => page
  .getByRole("navigation", { name: "Main navigation", exact: true, includeHidden: true })
  .getByRole("button", { name, includeHidden: true });

/** Follow the same drawer/disclosure path as a user, without changing the URL directly. */
export async function navigateTo(page, name) {
  const navigation = page.getByRole("navigation", { name: "Main navigation", exact: true, includeHidden: true });
  const destination = navigationItem(page, name);
  const drawer = page.getByRole("button", { name: "Open navigation", exact: true });
  if (!await navigation.isVisible() && await drawer.isVisible()) await drawer.click();
  if (!await destination.isVisible()) {
    const group = navigation.locator(".room-nav-group").filter({ has: page.getByRole("button", { name, includeHidden: true }) });
    await group.locator(".room-nav-trigger").click();
  }
  await destination.click();
}
