import { test, expect } from '@playwright/test';

const quoteURL = 'https://api.coinbase.com/v2/prices/SOL-USD/spot';
const quote = { data: { amount: '100', base: 'SOL', currency: 'USD' } };

test('one currency choice converts the phone, both leaderboards, and their details', async ({ page }) => {
  await page.route(quoteURL, route => route.fulfill({ json: quote }));
  await page.goto('./');
  const phone = page.locator('moltivate-demo');
  const board = page.locator('club-board');
  const peek = page.locator('club-peek');
  await phone.getByRole('button', { name: 'Show amounts in US dollars', exact: true }).click();
  await expect(phone.locator('[data-sol-value="0.2"]')).toHaveText('$20.00');
  await expect(phone.locator('[data-sol-value="0.05"]')).toHaveText('$5.00');
  await expect(phone.locator('currency-switch')).toContainText('1 SOL ≈ $100.00');
  await expect(board.getByRole('button', { name: 'Show amounts in US dollars', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(peek.locator('.compact-demo')).toHaveText('USD est.');
  await phone.getByRole('tab', { name: 'Your progress', exact: true }).click();
  await expect(phone.locator('.reward [data-sol-value="0.075"]')).toHaveText('$7.50');
  await phone.getByRole('button', { name: 'Try claiming your reward' }).click();
  await expect(phone.getByRole('dialog')).toContainText('$7.50');
  await expect(phone.getByRole('dialog')).toContainText('$5.00 principal + $2.50 bonus');
  await page.keyboard.press('Escape');

  await board.getByRole('searchbox').fill('early');
  await board.locator('[name="period"]').selectOption('month');
  const amount = board.locator('rolling-amount');
  await expect.poll(() => amount.evaluate(node => node.dataset.value === `+$${(Number(node.getAttribute('value')) * 100).toFixed(2)}`)).toBe(true);
  const displayed = await amount.getAttribute('data-value');
  await board.getByRole('button', { name: 'View The Early Birds demo details' }).click();
  await expect(board.getByRole('dialog')).toContainText(displayed);
  await expect(board.getByRole('dialog')).toContainText('USD est.');
  await page.keyboard.press('Escape');
  await board.getByRole('button', { name: 'Reset filters' }).click();
  await expect(board.locator('[data-reward="after"] rolling-amount')).toHaveAttribute('data-value', /^−\$/);
  await board.getByRole('button', { name: 'Show amounts in SOL', exact: true }).click();
  await expect(phone.getByRole('button', { name: 'Show amounts in SOL', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(phone.locator('.reward [data-sol-value="0.075"]')).toHaveText('0.075');
  await expect(amount.first()).toHaveAttribute('data-value', /^\+0\.\d{3}$/);

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await peek.getByRole('button', { name: 'Open leaderboard', exact: true }).click();
  await peek.getByRole('button', { name: 'Show amounts in US dollars', exact: true }).click();
  await expect(peek.locator('.drawer [data-amount="after"] rolling-amount')).toHaveAttribute('data-value', /^−\$/);
  await expect(board.getByRole('button', { name: 'Show amounts in US dollars', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await peek.locator('.drawer').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test('unavailable or invalid quotes keep SOL visible and allow a retry', async ({ page }) => {
  let calls = 0;
  await page.route(quoteURL, route => {
    calls += 1;
    return route.fulfill({ json: calls === 1 ? { data: { amount: '-20', base: 'SOL', currency: 'USD' } } : quote });
  });
  await page.goto('./');
  const phone = page.locator('moltivate-demo');
  await phone.getByRole('button', { name: 'Show amounts in US dollars', exact: true }).click();
  await expect(phone.locator('currency-switch')).toContainText('Price unavailable');
  await expect(phone.locator('currency-switch')).toContainText('Showing SOL for now');
  await expect(phone.locator('[data-sol-value="0.2"]')).toHaveText('0.20');
  await phone.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(phone.locator('[data-sol-value="0.2"]')).toHaveText('$20.00');
  expect(calls).toBe(2);
});

test.describe('USD digit reels', () => {
  test.use({ reducedMotion: 'no-preference' });
  test('keeps animating and settles on the exact converted value', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Currency layouts run at all three widths.');
    await page.route(quoteURL, route => route.fulfill({ json: quote }));
    await page.goto('./');
    const peek = page.locator('club-peek');
    await peek.getByRole('button', { name: 'Open leaderboard', exact: true }).click();
    await peek.getByRole('button', { name: 'Show amounts in US dollars', exact: true }).click();
    const amount = peek.locator('.drawer [data-amount="early"] rolling-amount');
    await expect(amount).toHaveAttribute('data-rolling', 'true');
    await expect(amount).toHaveAttribute('data-rolling', 'false');
    const first = await amount.getAttribute('data-value');
    expect(await amount.locator('.amount').textContent()).toBe(first);
    await expect.poll(() => amount.getAttribute('data-value')).not.toBe(first);
    await expect(amount).toHaveAttribute('data-rolling', 'false');
    const native = Number(await amount.getAttribute('value'));
    await expect(amount).toHaveAttribute('data-value', `+$${(native * 100).toFixed(2)}`);
  });
});
