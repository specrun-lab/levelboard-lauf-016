import { expect, test } from '@playwright/test';

const LIVE_URL = process.env.LIVE_URL ?? '';

function formatBuild(seconds: number): string {
  const value = Math.max(0, Math.round(seconds));
  if (value < 60) return `${value} s`;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')} min`;
}

test.describe('live-bericht', () => {
  test.setTimeout(120_000);

  test('Live-Seite zeigt den gemeldeten Abschlussbericht', async ({ page, request }) => {
    const response = await request.get(`${LIVE_URL}/api/levels`);
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.levels).toHaveLength(10);
    for (const level of data.levels) {
      expect(level.status, `Level ${level.level}`).toBe('bestanden');
      expect(level.metrics.build, `Bauzeit Level ${level.level}`).toBeTruthy();
    }
    const byLevel = (n: number) => data.levels.find((level: { level: number }) => level.level === n);
    expect(byLevel(6).metrics.pipeline).toBeTruthy();
    expect(byLevel(7).metrics.images).toBeTruthy();
    expect(byLevel(9).metrics.loadtest).toBeTruthy();

    const total = data.levels.reduce(
      (sum: number, level: any) => sum + (level.metrics.build.buildS ?? 0),
      0,
    );

    await page.goto(`${LIVE_URL}/`);
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok');
    await expect(page.getByTestId('report')).toHaveAttribute('data-complete', 'true');
    await expect(page.getByTestId('summary-reached')).toHaveText('10 / 10');
    await expect(page.getByTestId('report-score')).toHaveText('100 / 100');
    await expect(page.getByTestId('report-commit')).toHaveText(data.run.commit.slice(0, 7));
    await expect(page.getByTestId('report-build-time')).toHaveText(formatBuild(total));
    await expect(page.getByTestId('report-p95')).toHaveText(
      `${Math.round(byLevel(9).metrics.loadtest.p95Ms)} ms`,
    );
    await expect(page.getByTestId('report-image-backend')).toHaveText(
      `${byLevel(7).metrics.images.backendMB.toFixed(1).replace('.', ',')} MB`,
    );
    await expect(page.getByTestId('report-pipeline-total')).toHaveText(
      `${Math.round(byLevel(6).metrics.pipeline.totalS)} s`,
    );
    const rows = page.getByTestId('report-level');
    await expect(rows).toHaveCount(10);
    for (let index = 0; index < 10; index += 1) {
      await expect(rows.nth(index)).toHaveAttribute('data-status', 'bestanden');
    }
  });
});
