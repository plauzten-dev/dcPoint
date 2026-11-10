import { createHmac } from 'node:crypto';
import { expect, type Browser, type Page } from '@playwright/test';

let counter = 0;

export function uniqueName(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

export async function register(page: Page, displayName: string): Promise<string> {
  const username = uniqueName(displayName.toLowerCase());
  await page.goto('/register');
  await page.fill('#email', `${username}@example.com`);
  await page.fill('#display_name', displayName);
  await page.fill('#username', username);
  await page.fill('#password', 'hunter2hunter2');
  await page.getByRole('button', { name: 'Weiter', exact: true }).click();
  await expect(page.getByTestId('user-panel')).toBeVisible();
  return username;
}

export async function newUser(browser: Browser, displayName: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const username = await register(page, displayName);
  return { context, page, username };
}

export async function createGuild(page: Page, name: string) {
  await page.getByTestId('add-guild').click();
  await page.getByTestId('create-own-guild').click();
  await page.fill('#guild-name', name);
  await page.getByRole('dialog').getByRole('button', { name: 'Erstellen', exact: true }).click();
  await expect(page.getByTestId('channel-welcome')).toContainText('Willkommen in #allgemein!');
}

export async function createChannel(page: Page, name: string) {
  await page.getByTestId('guild-header').click();
  await page.getByRole('menuitem', { name: 'Kanal erstellen' }).click();
  await page.fill('#channel-name', name);
  await page.getByRole('dialog').getByRole('button', { name: 'Kanal erstellen' }).click();
}

export async function createInvite(page: Page): Promise<string> {
  await page.getByTestId('guild-header').click();
  await page.getByRole('menuitem', { name: 'Leute einladen' }).click();
  const input = page.getByTestId('invite-url');
  await expect(input).toHaveValue(/\/invite\/[A-Za-z0-9]{8}$/);
  const url = await input.inputValue();
  await page.keyboard.press('Escape');
  return new URL(url).pathname;
}

function base32Decode(s: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of s.replace(/=+$/, '')) {
    value = (value << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 6238 code for `secret`, offset by `stepOffset` periods. */
export function totp(secret: string, stepOffset = 0): string {
  const step = Math.floor(Date.now() / 1000 / 30) + stepOffset;
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}
