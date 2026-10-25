import { test, expect, type Page } from '@playwright/test';
const legacy = {
  profiles: [
    {
      id: 'p',
      name: 'Test assistant',
      type: 'chat',
      apiUrl: 'https://example.com/v1',
      apiKey: 'FAKE_TEST_KEY',
      model: 'mock',
    },
  ],
  topics: [
    {
      id: 't',
      name: 'Keep this conversation',
      prompt: '',
      historyCount: 12,
      temperature: 0.7,
      activeProfileId: 'p',
    },
  ],
  messagesByTopic: {
    t: [
      { id: 'u', role: 'user', content: 'hello', time: 1 },
      { id: 'a', role: 'assistant', content: 'Original reply', time: 2 },
    ],
  },
  activeTopicId: 't',
  activeProfileId: 'p',
  settings: { theme: 'light' },
  gistToken: 'FAKE_GIST_TOKEN',
  gistId: '',
};
async function seed(page: Page, data = legacy) {
  await page.addInitScript((value) => {
    if (!localStorage.getItem('seeded')) {
      localStorage.setItem('chatbutte_state_v1', JSON.stringify(value));
      localStorage.setItem('seeded', '1');
    }
  }, data);
}
async function openSettings(page: Page) {
  if (test.info().project.name === 'mobile')
    await page.getByRole('button', { name: '打开会话列表', exact: true }).click();
  await page.getByRole('button', { name: /设置与模型/ }).click();
}
async function readCurrent(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('chatbutte-v2');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return new Promise<any>((resolve, reject) => {
      const r = db.transaction('workspace').objectStore('workspace').get('current');
      r.onsuccess = () => {
        db.close();
        resolve(r.result);
      };
      r.onerror = () => reject(r.error);
    });
  });
}
test('second tab is read-only and cannot issue a model retry', async ({ page, context }) => {
  await seed(page);
  await page.goto('/');
  await expect(page.locator('.message-assistant')).toContainText('Original reply');
  const second = await context.newPage();
  let requests = 0;
  await second.route('**/api/chat', (route) => {
    requests++;
    return route.abort();
  });
  await second.goto('/');
  await expect(second.getByRole('alert').first()).toContainText('另一个标签页');
  await expect(second.getByRole('button', { name: '重新生成', exact: true })).toBeDisabled();
  await expect(second.getByRole('textbox', { name: '消息输入框' })).toBeDisabled();
  expect(requests).toBe(0);
  expect((await readCurrent(page)).conversations[0].messages[1].content).toBe('Original reply');
  await second.close();
});
test('corrupt legacy primary recovers from backup without touching either source', async ({
  page,
}) => {
  await page.addInitScript((value) => {
    localStorage.setItem('chatbutte_state_v1', '{broken');
    localStorage.setItem('chatbutte_state_v1_backup', JSON.stringify(value));
  }, legacy);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Keep this conversation', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('chatbutte_state_v1'))).toBe('{broken');
});
test('failed initialization never overwrites corrupted records with an empty workspace', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: '消息输入框' })).toBeVisible();
  await page.waitForTimeout(400);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('chatbutte-v2');
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('workspace', 'readwrite');
      tx.objectStore('workspace').put({ version: 2, damaged: 'preserve me' }, 'current');
      tx.objectStore('workspace').put({ version: 2, damaged: 'preserve backup' }, 'backup');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await expect(page.getByRole('button', { name: '打开数据恢复', exact: true })).toBeVisible();
  await page.waitForTimeout(700);
  expect(await readCurrent(page)).toEqual({ version: 2, damaged: 'preserve me' });
});
test('draft limits match persisted schema', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  const input = page.getByRole('textbox', { name: '消息输入框' });
  await expect(input).toHaveAttribute('maxlength', '100000');
  await input.fill('x'.repeat(100000));
  await page.waitForTimeout(400);
  await page.reload();
  await expect(input).toHaveValue('x'.repeat(100000));
});
test('failed import never reports success or changes current data', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await openSettings(page);
  await page.getByRole('button', { name: '数据与备份', exact: true }).click();
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (key === 'current')
        throw new DOMException('Fixture storage quota exceeded', 'QuotaExceededError');
      return original.call(this, value, key);
    };
  });
  page.once('dialog', (d) => d.accept());
  const next = structuredClone(legacy);
  next.topics[0].name = 'Should not replace';
  await page.locator('.settings-content input[type=file]').setInputFiles({
    name: 'valid.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(next)),
  });
  await expect(page.getByRole('status').last()).toContainText('Fixture storage quota exceeded');
  expect((await readCurrent(page)).conversations[0].title).toBe('Keep this conversation');
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Keep this conversation', exact: true }),
  ).toBeVisible();
});
test('continuous streams checkpoint and stop preserves partial answer', async ({ page }) => {
  await seed(page);
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch = async (input, options) => {
      if (!String(input).endsWith('/api/chat')) return original(input, options);
      let timer: ReturnType<typeof setInterval>;
      return new Response(
        new ReadableStream({
          start(controller) {
            let n = 0;
            timer = setInterval(() => {
              controller.enqueue(
                new TextEncoder().encode(
                  `data: ${JSON.stringify({ type: 'delta', content: `word${n++} ` })}\n\n`,
                ),
              );
              if (n === 300) {
                clearInterval(timer);
                controller.enqueue(new TextEncoder().encode('data: {"type":"done"}\n\n'));
                controller.close();
              }
            }, 20);
            options?.signal?.addEventListener('abort', () => {
              clearInterval(timer);
              controller.error(new DOMException('Aborted', 'AbortError'));
            });
          },
          cancel() {
            clearInterval(timer);
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    };
  });
  await page.goto('/');
  await page.getByRole('textbox', { name: '消息输入框' }).fill('stream');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible();
  await expect
    .poll(
      async () => {
        const state = await readCurrent(page);
        return state.conversations[0].messages.at(-1).content.length;
      },
      { timeout: 5000 },
    )
    .toBeGreaterThan(10);
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await expect(page.getByText('已停止 · 已保留生成内容', { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await readCurrent(page)).conversations[0].messages.at(-1).status)
    .toBe('stopped');
  await page.reload();
  await expect(page.getByText('已停止 · 已保留生成内容', { exact: true })).toBeVisible();
  await expect(page.locator('.message-assistant').last()).toContainText('word');
});
test('Gist upload is globally guarded and never includes keys or tokens', async ({ page }) => {
  await seed(page);
  let calls = 0;
  let uploaded = '';
  await page.route('https://api.github.com/gists', async (route) => {
    calls++;
    uploaded = JSON.stringify(route.request().postDataJSON());
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ id: 'fixture123', history: [{ version: 'v1' }] }),
    });
  });
  await page.goto('/');
  await openSettings(page);
  await page.getByRole('button', { name: '云端同步', exact: true }).click();
  await page.getByRole('button', { name: '上传本机备份', exact: true }).click();
  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '在设备之间，手动接力', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('操作完成', { exact: true })).toBeVisible();
  expect(calls).toBe(1);
  expect(uploaded).not.toContain('FAKE_TEST_KEY');
  expect(uploaded).not.toContain('FAKE_GIST_TOKEN');
  await expect(page.getByLabel('Gist ID', { exact: true })).toHaveValue('fixture123');
});
test('cancelled remote replacement is explicitly cancelled', async ({ page }) => {
  const data = structuredClone(legacy);
  data.gistId = 'fixture123';
  await seed(page, data);
  await page.route('https://api.github.com/gists/fixture123', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        history: [{ version: 'v2' }],
        files: { 'chatbutte-data.json': { content: JSON.stringify(legacy) } },
      }),
    }),
  );
  await page.goto('/');
  await openSettings(page);
  await page.getByRole('button', { name: '云端同步', exact: true }).click();
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: '下载云端备份', exact: true }).click();
  await expect(page.getByText('已取消，未改动数据', { exact: true })).toBeVisible();
  expect((await readCurrent(page)).conversations[0].title).toBe('Keep this conversation');
});
test('sidebar remains operable after desktop/mobile viewport changes', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await page.setViewportSize({ width: 360, height: 780 });
  await page.getByRole('button', { name: '打开会话列表', exact: true }).click();
  await expect(page.getByRole('button', { name: /设置与模型/ })).toBeVisible();
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.getByRole('button', { name: /设置与模型/ }).click();
  await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
});
test('long conversations render in batches rather than all historical code blocks', async ({
  page,
}) => {
  const data = structuredClone(legacy);
  data.messagesByTopic.t = Array.from({ length: 240 }, (_, i) => ({
    id: `m${i}`,
    role: i % 2 ? 'assistant' : 'user',
    content: `Message ${i}\n\n\`\`\`js\nconst a = ${i};\n\`\`\``,
    time: i + 1,
  }));
  await seed(page, data);
  await page.goto('/');
  await expect(page.locator('.message')).toHaveCount(80);
  await page.getByRole('button', { name: /加载更早的消息/ }).click();
  await expect(page.locator('.message')).toHaveCount(160);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
});
test('all target widths fit and settings save stays reachable', async ({ page }) => {
  await page.goto('/');
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.getByRole('textbox', { name: '消息输入框' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const box = await page.getByRole('button', { name: '发送消息', exact: true }).boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(800);
  }
  await page.getByRole('button', { name: /连接你的第一个模型/ }).click();
  await expect(page.getByRole('button', { name: '保存模型', exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/settings-${test.info().project.name}.png` });
});
