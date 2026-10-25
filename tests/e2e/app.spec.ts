import { test, expect, type Page } from '@playwright/test';
const legacy = {
  profiles: [
    {
      id: 'p',
      name: 'Test assistant',
      type: 'chat',
      apiUrl: 'https://example.com/v1',
      apiKey: 'FAKE_TEST_KEY',
      model: 'mock-model',
      reasoningMode: 'default',
    },
  ],
  topics: [
    {
      id: 't',
      name: 'Imported conversation',
      prompt: '',
      historyCount: 12,
      temperature: 0,
      activeProfileId: 'p',
    },
  ],
  messagesByTopic: { t: [] },
  activeTopicId: 't',
  activeProfileId: 'p',
  settings: { theme: 'light' },
};
async function seed(page: Page, input = legacy) {
  await page.addInitScript((value) => {
    if (!localStorage.getItem('seeded')) {
      localStorage.setItem('chatbutte_state_v1', JSON.stringify(value));
      localStorage.setItem('seeded', '1');
    }
  }, input);
}
async function settings(page: Page) {
  if (test.info().project.name === 'mobile')
    await page.getByRole('button', { name: '打开会话列表', exact: true }).click();
  await page.getByRole('button', { name: /设置与模型/ }).click();
}
async function reply(page: Page, content = 'Hello **Chatbutte**.') {
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ type: 'delta', content, reasoning: 'Think carefully' })}\n\ndata: {"type":"done","reason":"stop"}\n\n`,
    }),
  );
}
test('empty onboarding and responsive layout', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '让想法，继续生长。' })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /连接你的第一个模型/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: `test-results/onboarding-${test.info().project.name}.png` });
});
test('configure model from scratch, send, render and reload persisted data', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /连接你的第一个模型/ }).click();
  await page.getByLabel('显示名称', { exact: true }).fill('My assistant');
  await page.getByLabel('模型 ID', { exact: true }).fill('test-model');
  await page.getByLabel('API 地址', { exact: true }).fill('https://example.com/v1');
  await page.getByLabel('API 密钥', { exact: true }).fill('FAKE_TEST_KEY');
  await page.getByRole('button', { name: '保存模型', exact: true }).click();
  await expect(page.getByText('模型已保存', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await reply(
    page,
    '# A useful answer\n\n```js\nconst answer = 42;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |',
  );
  await page.getByRole('textbox', { name: '消息输入框' }).fill('Hello');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A useful answer' })).toBeVisible();
  await expect(page.locator('pre')).toContainText('const answer = 42');
  await expect(page.locator('table')).toBeVisible();
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'A useful answer' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '选择模型' })).toHaveValue(/.+/);
  await page.screenshot({ path: `test-results/conversation-${test.info().project.name}.png` });
});
test('migrates legacy state and preserves theme and zero temperature', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Imported conversation', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '会话设置', exact: true }).click();
  await expect(page.getByLabel('温度', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('历史消息条数', { exact: true })).toHaveValue('12');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('chatbutte_state_v1')!).profiles[0].apiKey,
    ),
  ).toBe('FAKE_TEST_KEY');
});
test('Shift+Enter and composition never send; mobile Enter inserts newline', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  const input = page.getByRole('textbox', { name: '消息输入框' });
  await input.fill('hello');
  await input.press('Shift+Enter');
  await expect(input).toHaveValue('hello\n');
  if (test.info().project.name === 'mobile') {
    await input.press('Enter');
    await expect(input).toHaveValue('hello\n\n');
  }
  await input.evaluate((el) => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
    );
  });
  await expect(page.locator('.message-user')).toHaveCount(0);
});
test('text and image attachments survive reload without truncation', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles([
      {
        name: 'long-note.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('full text '.repeat(1000)),
      },
      {
        name: 'tiny.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5e0AAAAASUVORK5CYII=',
          'base64',
        ),
      },
    ]);
  await expect(page.locator('.draft-file')).toHaveCount(2);
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator('.draft-file')).toHaveCount(2);
  let received: unknown;
  await page.route('**/api/chat', (route) => {
    received = route.request().postDataJSON();
    return route.fulfill({
      contentType: 'text/event-stream',
      body: 'data: {"type":"delta","content":"read"}\n\ndata: {"type":"done"}\n\n',
    });
  });
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.message-assistant')).toContainText('read');
  expect(JSON.stringify(received)).toContain('full text '.repeat(1000));
  expect(JSON.stringify(received)).toContain('data:image/png;base64,');
});
test('safe Markdown does not execute imported model HTML', async ({ page }) => {
  await seed(page);
  await reply(
    page,
    '<img src=x onerror="window.PWNED=true">\n\n[bad](javascript:alert(1))\n\n**safe**',
  );
  await page.goto('/');
  await page.getByRole('textbox', { name: '消息输入框' }).fill('test');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.message-assistant strong').last()).toHaveText('safe');
  expect(await page.evaluate(() => 'PWNED' in window)).toBe(false);
  expect(await page.locator('.message-assistant a').getAttribute('href')).not.toContain(
    'javascript:',
  );
});
test('settings are usable, theme and language persist', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await settings(page);
  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  await page.getByLabel('外观', { exact: true }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('语言', { exact: true }).selectOption('en');
  await expect(page.getByRole('heading', { name: 'Make it feel like yours' })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
});
test('default exports exclude API keys and tokens', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await settings(page);
  await page.getByRole('button', { name: '数据与备份', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  const file = await download;
  const stream = await file.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString();
  expect(text).not.toContain('FAKE_TEST_KEY');
  expect(JSON.parse(text).version).toBe(2);
});
test('invalid imports leave the workspace untouched', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await settings(page);
  await page.getByRole('button', { name: '数据与备份', exact: true }).click();
  await page.locator('.settings-content input[type=file]').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"topics":[]}'),
  });
  await expect(page.getByRole('status').last()).toContainText('不是有效');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Imported conversation', exact: true }),
  ).toBeVisible();
});
test('new conversation and drawer selection close correctly', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  if (test.info().project.name === 'mobile')
    await page.getByRole('button', { name: '打开会话列表', exact: true }).click();
  await page.getByRole('button', { name: '新对话', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '新对话', exact: true })).toBeVisible();
  if (test.info().project.name === 'mobile') {
    await page.getByRole('button', { name: '打开会话列表', exact: true }).click();
    await page.getByRole('button', { name: 'Imported conversation', exact: true }).click();
    await expect(page.locator('.sidebar-backdrop')).toHaveCount(0);
  } else {
    await page.getByRole('button', { name: 'Imported conversation', exact: true }).click();
  }
  await expect(
    page.getByRole('heading', { name: 'Imported conversation', exact: true }),
  ).toBeVisible();
});
test('model editor never overwrites another model when switching', async ({ page }) => {
  const data = structuredClone(legacy);
  data.profiles.push({ ...data.profiles[0], id: 'p2', name: 'Second model', model: 'second' });
  await seed(page, data);
  await page.goto('/');
  await settings(page);
  await page.getByLabel('显示名称', { exact: true }).fill('Unsaved change');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Second model', exact: true }).click();
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('Second model');
  await expect(page.getByLabel('模型 ID', { exact: true })).toHaveValue('second');
});
test('error response remains visible and can be regenerated', async ({ page }) => {
  await seed(page);
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Fixture provider unavailable' }),
    }),
  );
  await page.goto('/');
  await page.getByRole('textbox', { name: '消息输入框' }).fill('hello');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('alert').last()).toContainText('Fixture provider unavailable');
  await page.unroute('**/api/chat');
  await reply(page, 'Recovered');
  await page.getByRole('button', { name: '重新生成', exact: true }).click();
  await expect(page.locator('.message-assistant')).toContainText('Recovered');
  await expect(page.locator('.message-user')).toHaveCount(1);
});
