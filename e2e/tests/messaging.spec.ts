import { expect, test, type Page } from '@playwright/test';
import { createChannel, createGuild, createInvite, newUser } from './helpers';

// A valid 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function send(page: Page, text: string) {
  const box = page.locator('[data-composer]');
  await box.fill(text);
  await box.press('Enter');
}

const messages = (page: Page) => page.getByRole('article');

test('realtime messaging: markdown, mentions, replies, reactions, edit, delete, uploads, unread', async ({ browser }) => {
  const alice = await newUser(browser, 'Alice');
  await createGuild(alice.page, 'Plauderei');
  const invite = await createInvite(alice.page);
  const bob = await newUser(browser, 'Bob');
  await bob.page.goto(invite);
  await bob.page.getByRole('button', { name: 'Einladung annehmen' }).click();
  await expect(bob.page.getByTestId('channel-welcome')).toBeVisible();

  // Markdown + realtime delivery
  await send(alice.page, 'Hallo **Bob**, hier `code` und ||geheim||');
  const first = messages(bob.page).first();
  await expect(first.locator('strong')).toHaveText('Bob');
  await expect(first.locator('code')).toHaveText('code');
  await expect(first.locator('.md-spoiler')).toBeVisible();

  // Typing indicator
  await bob.page.locator('[data-composer]').fill('tippe gerade');
  await expect(alice.page.getByText('Bob schreibt …')).toBeVisible();

  // Mention via autocomplete, highlighted for the mentioned user
  const box = bob.page.locator('[data-composer]');
  await box.fill('Hi @ali');
  await expect(bob.page.getByRole('option', { name: /Alice/ })).toBeVisible();
  await box.press('Enter');
  await box.pressSequentially('kurze Frage');
  await box.press('Enter');
  const mention = messages(alice.page).filter({ hasText: 'kurze Frage' });
  await expect(mention.locator('.md-mention')).toHaveText('@Alice');
  await expect(mention).toHaveClass(/bg-idle/);

  // Reply + reaction
  await mention.click({ button: 'right' });
  await alice.page.getByRole('menuitem', { name: 'Antworten' }).click();
  await expect(alice.page.getByText('Antworten an')).toBeVisible();
  await send(alice.page, 'Klar, schieß los');
  const reply = messages(bob.page).filter({ hasText: 'Klar, schieß los' });
  await expect(reply).toContainText('@Alice kurze Frage');
  await reply.hover();
  await bob.page.getByRole('button', { name: 'Reaktion hinzufügen' }).first().click();
  await bob.page.getByRole('button', { name: 'thumbsup' }).click();
  await expect(messages(alice.page).filter({ hasText: 'Klar, schieß los' }).getByRole('button', { name: '👍 1' })).toBeVisible();

  // Edit last own message with ↑, then delete it
  await alice.page.locator('[data-composer]').click();
  await alice.page.locator('[data-composer]').press('ArrowUp');
  const editor = alice.page.getByLabel('Nachricht bearbeiten');
  await editor.fill('Klar, frag ruhig!');
  await editor.press('Enter');
  await expect(messages(bob.page).filter({ hasText: 'Klar, frag ruhig!' })).toContainText('(bearbeitet)');
  const edited = messages(alice.page).filter({ hasText: 'Klar, frag ruhig!' });
  await edited.hover();
  await alice.page.keyboard.down('Shift');
  await edited.getByRole('button', { name: /Löschen/ }).click();
  await alice.page.keyboard.up('Shift');
  await expect(messages(bob.page).filter({ hasText: 'Klar, frag ruhig!' })).toHaveCount(0);

  // Image upload is rendered for the other user
  await bob.page.setInputFiles('input[type=file]', { name: 'pixel.png', mimeType: 'image/png', buffer: PNG });
  await expect(bob.page.getByText('pixel.png')).toBeVisible();
  await send(bob.page, 'Ein Bild');
  const img = messages(alice.page).filter({ hasText: 'Ein Bild' }).locator('img[alt="pixel.png"]');
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);

  // Unread + mention badges while Alice is in another channel
  await createChannel(alice.page, 'anderswo');
  await send(bob.page, '@Alice');
  await bob.page.waitForTimeout(150);
  await bob.page.locator('[data-composer]').press('Enter');
  await expect(alice.page.getByTestId('channel-allgemein').getByLabel('1 Erwähnungen')).toBeVisible();
  await expect(alice.page).toHaveTitle('(1) dcPoint');
  await alice.page.getByTestId('channel-allgemein').click();
  await expect(alice.page.getByTestId('channel-allgemein').getByLabel('1 Erwähnungen')).toHaveCount(0);
  await expect(alice.page).toHaveTitle('dcPoint');

  await alice.context.close();
  await bob.context.close();
});

test('history pagination keeps loading older messages', async ({ page, request }) => {
  test.setTimeout(90_000);
  const { register } = await import('./helpers');
  await register(page, 'Viel');
  await createGuild(page, 'Archiv');
  const token = await page.evaluate(() => localStorage.getItem('dcpoint-token'));
  const channelId = page.url().split('/').pop()!;
  for (let i = 1; i <= 120; i++) {
    const res = await request.post(`/api/v1/channels/${channelId}/messages`, { headers: { Authorization: token! }, data: { content: `Nachricht ${i}` } });
    if (res.status() === 429) {
      await page.waitForTimeout(Number(res.headers()['retry-after'] ?? 1) * 1000);
      i--;
    }
  }
  await page.reload();
  await expect(page.getByText('Nachricht 120', { exact: true })).toBeVisible();
  const list = page.getByTestId('message-list');
  for (let i = 0; i < 12 && !(await page.getByText('Nachricht 1', { exact: true }).isVisible()); i++) {
    await list.evaluate((el) => el.scrollTo(0, 0));
    await page.waitForTimeout(300);
  }
  await expect(page.getByText('Nachricht 1', { exact: true })).toBeVisible();
  // All history loaded: the channel start (welcome header) sits above the first message.
  await list.evaluate((el) => el.scrollTo(0, 0));
  await expect(page.getByTestId('channel-welcome')).toBeVisible();
});

test('custom emojis: upload, use in messages and reactions', async ({ page }) => {
  const { register } = await import('./helpers');
  await register(page, 'Emo');
  await createGuild(page, 'Emojiland');
  await page.getByTestId('guild-header').click();
  await page.getByRole('menuitem', { name: 'Servereinstellungen' }).click();
  await page.getByRole('button', { name: 'Emoji', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Emoji hochladen' }).click();
  await (await chooser).setFiles({ name: 'party_blob.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByLabel('Emoji-Name')).toHaveValue('party_blob');
  await page.keyboard.press('Escape');

  const box = page.locator('[data-composer]');
  await box.fill('Feier :party');
  await expect(page.getByRole('option', { name: ':party_blob:' })).toBeVisible();
  await box.press('Enter');
  await box.press('Enter');
  const msg = messages(page).last();
  await expect(msg.locator('img.md-emoji[alt=":party_blob:"]')).toBeVisible();

  await msg.hover();
  await page.getByRole('button', { name: 'Reaktion hinzufügen' }).first().click();
  await page.getByLabel('Emoji suchen').fill('party');
  await page.getByRole('button', { name: 'party_blob' }).first().click();
  await expect(msg.getByRole('button', { name: /party_blob:\d+ 1/ })).toBeVisible();
});
