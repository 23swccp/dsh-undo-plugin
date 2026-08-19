/** Compare fold and composer card boundaries. */

import puppeteer from 'puppeteer-core'

const URL = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:3080'
const CHROME = process.env.CHROME
  ?? (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : '/usr/bin/google-chrome')
const WIDTH = Number(process.env.VIEW_W ?? 1280)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  defaultViewport: { width: WIDTH, height: 720 },
  args: ['--no-first-run', '--disable-infobars'],
})
const page = await browser.newPage()

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90_000 })
await sleep(6_000)

await page.click('textarea')
await page.keyboard.type('hello')
await page.keyboard.press('Enter')
await sleep(90_000)

const info = await page.evaluate(() => {
  const fold = [...document.querySelectorAll('[role="group"]')]
    .find(g => g.getAttribute('aria-label') === '可撤回的最近消息')
  const ta = document.querySelector('textarea')
  if (fold === undefined || ta === null) return { error: 'missing fold or textarea' }
  const foldRect = fold.getBoundingClientRect()
  let card = ta.parentElement
  for (let d = 0; card && d < 20; d++) {
    const s = window.getComputedStyle(card)
    const r = card.getBoundingClientRect()
    const hasPad = parseFloat(s.paddingLeft) > 0 || parseFloat(s.paddingRight) > 0
    if (hasPad && r.width > 200 && r.height > 30) break
    card = card.parentElement
  }
  const cardRect = card?.getBoundingClientRect() ?? null
  return {
    viewport: window.innerWidth,
    fold: { left: Math.round(foldRect.left), right: Math.round(foldRect.right), width: Math.round(foldRect.width) },
    card: cardRect ? { left: Math.round(cardRect.left), right: Math.round(cardRect.right), width: Math.round(cardRect.width) } : null,
    gap: cardRect ? { left: Math.round(foldRect.left - cardRect.left), right: Math.round(cardRect.right - foldRect.right) } : null,
  }
})
console.log(JSON.stringify(info, null, 2))

await browser.close()
