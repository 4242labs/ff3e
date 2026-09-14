import AxeBuilder from '@axe-core/playwright'
import { chromium } from 'playwright'

const baseURL = process.env.PREVIEW_URL || 'http://127.0.0.1:4173'
const themes = ['light', 'dark']
const views = ['Outstanding & Upcoming', 'Charts', 'Reports']
const failures = []
let checks = 0

for (let attempt = 0; attempt < 50; attempt += 1) {
  try {
    const response = await fetch(baseURL)
    if (response.ok) break
  } catch {
    // Preview may still be starting.
  }
  if (attempt === 49) throw new Error(`Preview did not become ready at ${baseURL}`)
  await new Promise((resolve) => setTimeout(resolve, 200))
}

function fail(label, detail) {
  failures.push(`${label}: ${detail}`)
}

const browser = await chromium.launch({ headless: true })
try {
  for (const theme of themes) {
    for (const view of views) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      const page = await context.newPage()
      await page.addInitScript((selectedTheme) => {
        localStorage.setItem('entropy-theme', selectedTheme)
      }, theme)
      await page.goto(baseURL, { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: view, exact: true }).click()
      await page.waitForTimeout(100)

      for (const state of ['expanded', 'collapsed']) {
        if (state === 'collapsed') {
          await page.locator('[data-slot="sidebar-rail"]').click()
          await page.locator('[data-slot="sidebar"][data-state="collapsed"]').waitFor()
          await page.waitForTimeout(250)
        }

        const label = `${view} / ${theme} / ${state}`
        const axe = await new AxeBuilder({ page }).analyze()
        if (axe.violations.length) {
          const detail = axe.violations
            .map(({ id, impact, nodes }) => {
              const targets = nodes.map((node) => `${node.target.join(' ')} — ${node.failureSummary || 'no detail'}`).join(' | ')
              return `${id} (${impact}, ${nodes.length} target${nodes.length === 1 ? '' : 's'}): ${targets}`
            })
            .join(', ')
          fail(label, `axe ${detail}`)
        }

        const geometry = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          mains: document.querySelectorAll('main').length,
          asides: document.querySelectorAll('aside[aria-label="Primary navigation"]').length,
        }))
        if (geometry.scrollWidth > geometry.clientWidth) {
          fail(label, `overflow ${geometry.scrollWidth}px > ${geometry.clientWidth}px`)
        }
        if (geometry.mains !== 1) fail(label, `${geometry.mains} main landmarks`)
        if (geometry.asides !== 1) fail(label, `${geometry.asides} named navigation asides`)

        if (state === 'collapsed') {
          const mark = await page
            .locator('[data-slot="sidebar-header"] a[aria-label="Entropy for Firefly III — by 42labs"] [data-slot="brand-mark"]')
            .boundingBox()
          const switchBox = await page.locator('.theme-switch').boundingBox()
          const visibleSwitchButtons = await page.locator('.theme-switch button:visible').count()
          if (!mark || mark.width !== 24 || mark.height !== 24) {
            fail(label, `collapsed mark ${JSON.stringify(mark)} (expected 24x24)`)
          }
          if (!switchBox || switchBox.width !== 32 || switchBox.height !== 32) {
            fail(label, `collapsed theme switch ${JSON.stringify(switchBox)} (expected 32x32)`)
          }
          if (visibleSwitchButtons !== 1) {
            fail(label, `${visibleSwitchButtons} visible collapsed theme buttons (expected 1)`)
          }
        }
        checks += 1
      }
      await context.close()
    }
  }
} finally {
  await browser.close()
}

if (failures.length) {
  console.error(`Browser accessibility gate failed (${failures.length} findings across ${checks} states):`)
  for (const finding of failures) console.error(`- ${finding}`)
  process.exit(1)
}
console.log(`Browser accessibility gate passed: ${checks} expanded/collapsed view × theme states, unfiltered axe clean, no horizontal overflow, one main, one named aside, 24x24 collapsed mark, 32x32 collapsed ThemeSwitch.`)
