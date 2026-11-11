import { devices, expect, test } from '@playwright/test';
import { register } from './helpers';

test.use({ ...devices['Pixel 7'] });

test('phone layout: navigation, chat panel, member drawer and settings', async ({ page }) => {
  await register(page, 'Handy');

  // Navigation (server rail + list) is in front, the chat peeks in from the right.
  await expect(page.getByRole('button', { name: 'Freunde' })).toBeInViewport();
  await page.getByRole('button', { name: 'Freunde' }).tap();
  await expect(page.getByText('Hier ist es noch ruhig')).toBeInViewport();

  await page.getByRole('button', { name: 'Server und Kanäle anzeigen' }).tap();
  await page.getByTestId('add-guild').tap();
  await page.getByTestId('create-own-guild').tap();
  await page.fill('#guild-name', 'Unterwegs');
  await page.getByRole('dialog').getByRole('button', { name: 'Erstellen', exact: true }).tap();
  await expect(page.getByTestId('guild-header')).toContainText('Unterwegs');

  // Tapping a channel brings the chat to the front.
  await page.getByTestId('channel-allgemein').tap();
  const welcome = page.getByTestId('channel-welcome');
  await expect(welcome).toContainText('Willkommen in #allgemein!');
  await expect(page.getByRole('button', { name: 'Zurück zum Chat' })).toHaveCount(0);

  // Member list opens as a drawer.
  await page.getByRole('button', { name: 'Mitgliederliste anzeigen' }).tap();
  await expect(page.getByRole('heading', { name: /Online — 1/ })).toBeInViewport();
  await page.mouse.click(20, 400);
  await expect(page.getByRole('heading', { name: /Online — 1/ })).toHaveCount(0);

  // Back to the navigation via the menu button.
  await page.getByRole('button', { name: 'Kanäle anzeigen' }).tap();
  await expect(page.getByRole('button', { name: 'Zurück zum Chat' })).toBeVisible();

  // Settings: section list first, then the section with a back button.
  await page.getByRole('button', { name: 'Benutzereinstellungen' }).tap();
  await page.getByRole('button', { name: 'Profile' }).tap();
  await expect(page.locator('#p-display')).toBeVisible();
  await page.getByRole('button', { name: 'Zurück', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Darstellung' })).toBeVisible();

  // No horizontal overflow anywhere.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
