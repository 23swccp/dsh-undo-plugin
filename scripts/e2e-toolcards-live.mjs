/**
 * Live-session e2e for the toolcards plugin (requires DEEPSEEK_API_KEY on the
 * server). Sends one prompt that drives several tool types, waits for the turn
 * to settle, then expands every tool row and reports the computed card colors.
 *
 * Usage: node scripts/e2e-toolcards-live.mjs
 */

import puppeteer from 'puppeteer-core'

const URL = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:3080'
const CHROME = process.env.CHROME
  ?? (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : '/usr/bin/google-chrome')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  defaultViewport: { width: 1440, height: 900 },
  args: ['--no-first-run', '--disable-infobars'],
})
const page = await browser.newPage()
const client = await page.createCDPSession()
await client.send('Network.setCacheDisabled', { cacheDisabled: true })
page.on('pageerror', err => console.log(`[pageerror] ${err.message}`))

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90_000 })
await sleep(6_000)

// New session via the sidebar new-chat button (falls back to current session).
const opened = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')]
    .find(b => (b.getAttribute('aria-label') ?? '').includes('新会话') || (b.getAttribute('aria-label') ?? '').toLowerCase().includes('new chat'))
  if (btn !== undefined) { btn.click(); return 'new' }
  return 'current'
})
console.log('session:', opened)
await sleep(4_000)

// One prompt, several tool types: pwsh (dir), write (fs), read (fs), glob (search).
await page.click('textarea')
await page.keyboard.type('请依次完成:1) 用 PowerShell 运行 Get-Child士命令列出当前目录;2) 创建文件 toolcards-e2e.txt 内容为 hello-colors;3) 读取 toolcards-e2e.txt 内容;4) 用 glob 搜索 *.txt。完成后回复"done"。'.replace('Get-Child士', 'Get-ChildItem'))
await page.keyboard.press('Enter')
console.log('prompt sent; waiting for turn to settle...')

const toolRowCount = () => page.evaluate(() =>
  document.querySelectorAll('[data-tool], [data-sample="bash"]').length)
const runningRows = () => page.evaluate(() =>
  document.querySelectorAll('[data-state="running"]').length)

let settled = false
for (let i = 0; i < 90; i++) {
  await sleep(5_000)
  const rows = await toolRowCount()
  const running = await runningRows()
  if (i % 4 === 0) console.log(`  t=${(i + 1) * 5}s rows=${rows} running=${running}`)
  if (rows >= 4 && running === 0) { settled = true; break }
}
console.log('settled:', settled, 'rows:', await toolRowCount())

// Expand every expandable row, then read each card's computed style.
const report = await page.evaluate(async () => {
  const rows = [...document.querySelectorAll('[data-tool], [data-sample="bash"]')]
  const seen = []
  for (const row of rows) {
    const clickTarget = row.matches('[data-sample="bash"]') ? row : row.querySelector('[aria-expanded]')
    if (clickTarget) {
      clickTarget.click()
      await new Promise(r => setTimeout(r, 150))
    }
  }
  for (const row of rows) {
    const card = row.querySelector('[data-terminal], [data-diff], [data-read], [data-search], [data-web]')
    if (card === null) continue
    const kind = card.hasAttribute('data-terminal') ? 'terminal'
      : card.hasAttribute('data-diff') ? 'diff'
        : card.hasAttribute('data-read') ? 'read'
          : card.hasAttribute('data-search') ? 'search' : 'web'
    const cs = getComputedStyle(card)
    seen.push({
      tool: row.getAttribute('data-tool') ?? row.getAttribute('data-sample'),
      variant: row.getAttribute('data-variant'),
      kind,
      bg: cs.backgroundColor,
      labelVar: cs.getPropertyValue('--dsw-alias-label-primary').trim(),
    })
  }
  const pluginTag = document.querySelector('style[data-plugin="@dsh-undo/client-rollback-toolcards"]')
  return { pluginStyleLoaded: pluginTag !== null, cards: seen }
})
console.log('plugin style tag loaded:', report.pluginStyleLoaded)
console.log('=== LIVE CARDS ===')
for (const c of report.cards) console.log(JSON.stringify(c))

await browser.close()
