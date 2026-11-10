import { expect, test } from '@playwright/test';
import { createChannel, createGuild, createInvite, newUser, register, totp } from './helpers';

test('registration, server creation, channels and keyboard navigation', async ({ page }) => {
  await register(page, 'Alice');
  await expect(page.getByText('Hier ist es noch ruhig')).toBeVisible();

  await createGuild(page, 'E2E Server');
  await expect(page.getByTestId('guild-header')).toContainText('E2E Server');
  await expect(page.getByTestId('category-Textkanäle')).toBeVisible();

  await createChannel(page, 'Neuigkeiten Und Infos');
  await expect(page).toHaveURL(/\/channels\/\d+\/\d+$/);
  await expect(page.getByTestId('channel-welcome')).toContainText('#neuigkeiten-und-infos');

  // Alt+↓ / Alt+↑ cycle through text channels in sidebar order
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.getByTestId('channel-welcome')).toContainText('#allgemein');
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page.getByTestId('channel-welcome')).toContainText('#neuigkeiten-und-infos');

  // Ctrl+K quick switcher
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Wohin möchtest du?').fill('allg');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('channel-welcome')).toContainText('#allgemein');

  // state survives a reload (snapshot comes from the gateway READY)
  await page.reload();
  await expect(page.getByTestId('channel-neuigkeiten-und-infos')).toBeVisible();
  await expect(page.getByTestId('channel-welcome')).toContainText('#allgemein');
});

test('invites, realtime fan-out and presence across two users', async ({ browser }) => {
  const alice = await newUser(browser, 'Alice');
  await createGuild(alice.page, 'Treffpunkt');
  const invitePath = await createInvite(alice.page);

  const bob = await newUser(browser, 'Bob');
  await bob.page.goto(invitePath);
  await expect(bob.page.getByRole('heading', { name: 'Treffpunkt' })).toBeVisible();
  await bob.page.getByRole('button', { name: 'Einladung annehmen' }).click();
  await expect(bob.page.getByTestId('channel-welcome')).toBeVisible();

  // Alice sees Bob join and come online without reloading
  await expect(alice.page.getByTestId(`member-${bob.username}`)).toBeVisible();
  await expect(alice.page.getByRole('heading', { name: /Online — 2/ })).toBeVisible();

  // channel created by Alice appears for Bob in real time
  await createChannel(alice.page, 'live');
  await expect(bob.page.getByTestId('channel-live')).toBeVisible();

  // Bob is not allowed to manage channels
  await bob.page.getByTestId('guild-header').click();
  await expect(bob.page.getByRole('menuitem', { name: 'Kanal erstellen' })).toBeDisabled();
  await bob.page.keyboard.press('Escape');

  // Bob goes offline -> Alice sees him in the offline group
  await bob.context.close();
  await expect(alice.page.getByRole('heading', { name: /Offline — 1/ })).toBeVisible();
  await alice.context.close();
});

test('drag & drop reorders channels persistently', async ({ page }) => {
  await register(page, 'Dora');
  await createGuild(page, 'Sortierbar');
  await page.getByRole('button', { name: 'Kanal erstellen' }).first().click();
  await page.fill('#channel-name', 'zweiter');
  await page.getByRole('dialog').getByRole('button', { name: 'Kanal erstellen' }).click();
  await expect(page.getByTestId('channel-zweiter')).toBeVisible();

  const section = page.locator('li', { has: page.getByTestId('category-Textkanäle') });
  const names = () => section.locator('[data-testid^="channel-"]').evaluateAll((els) => els.map((e) => e.textContent?.trim()));
  await expect.poll(names).toEqual(['allgemein', 'zweiter']);
  await page.getByTestId('channel-zweiter').dragTo(page.getByTestId('channel-allgemein'), { targetPosition: { x: 30, y: 3 } });
  await expect.poll(names).toEqual(['zweiter', 'allgemein']);
  await page.reload();
  await expect.poll(names).toEqual(['zweiter', 'allgemein']);
});

test('two-factor authentication: enable, then login requires a code', async ({ page }) => {
  const username = await register(page, 'Mia');
  await page.keyboard.press('Control+,');
  await page.getByRole('button', { name: 'Zwei-Faktor-Auth aktivieren' }).click();
  await page.fill('#fm-password', 'hunter2hunter2');
  await page.getByRole('button', { name: 'Weiter', exact: true }).click();
  const secret = (await page.getByTestId('totp-secret').textContent())!.trim();
  await page.fill('#totp-code', totp(secret));
  await page.getByRole('button', { name: 'Aktivieren', exact: true }).click();
  await expect(page.getByTestId('mfa-section')).toContainText('ist aktiviert');

  // log out via settings
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Abmelden' }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.fill('#login', username);
  await page.fill('#password', 'hunter2hunter2');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByText('Zwei-Faktor-Authentifizierung')).toBeVisible();
  await page.fill('#code', '000000');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByText('Ungültiger Authentifizierungscode.')).toBeVisible();
  // the confirmation used the current step; the next step is still inside the ±1 window
  await page.fill('#code', totp(secret, 1));
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByTestId('user-panel')).toBeVisible();
});

test('profile, status and theme settings', async ({ page }) => {
  await register(page, 'Theo');
  await page.getByTestId('user-panel').click();
  await page.getByRole('button', { name: /Bitte nicht stören/ }).click();
  await expect(page.getByTestId('user-panel')).toContainText('Bitte nicht stören');

  await page.getByTestId('user-panel').click();
  await page.getByRole('button', { name: 'Benutzerdefinierten Status festlegen' }).click();
  await page.fill('#cs-text', 'Am Programmieren');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByTestId('user-panel')).toContainText('Am Programmieren');

  await page.keyboard.press('Control+,');
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.fill('#p-bio', 'Hallo aus dem E2E-Test');
  await page.getByRole('button', { name: 'Änderungen speichern' }).click();
  await expect(page.getByText('Achtung – du hast ungespeicherte Änderungen!')).toBeHidden();

  await page.getByRole('button', { name: 'Darstellung' }).click();
  await page.getByRole('button', { name: 'Hell' }).click();
  await expect(page.locator('html')).toHaveClass('theme-light');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('html')).toHaveClass('theme-light');
});
