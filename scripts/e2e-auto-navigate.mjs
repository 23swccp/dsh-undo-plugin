/** Final loop: fresh message on current session -> /rollback -> assert auto-navigation to child. */

import puppeteer from 'puppeteer-core'

const URL = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:3080'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  defaultViewport: { width: 1440, height: 900 },
  args: ['--no-first-run', '--disable-infobars'],
})
const page = await browser.newPage()
page.on('console', msg => {
  const text = msg.text()
  if (text.includes('Failed to load') || msg.type() === 'error') console.log(`[console.${msg.type()}] ${text}`)
})
page.on('pageerror', err => console.log(`[pageerror] ${err.message}`))

const currentId = () => page.evaluate(() => {
  try {
    const raw = localStorage.getItem('dsh.sessions.current')
    if (raw === null) return null
    const v = JSON.parse(raw)
    return v.sessionId ?? null
  } catch {
    return null
  }
})

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90_000 })
await sleep(6_000)
const idBefore = await currentId()
console.log('current session before:', idBefore)
const selected = await page.evaluate(() => {
  const sel = document.querySelector('div[role="treeitem"][aria-selected="true"]')
  return sel?.textContent?.trim().slice(0, 50) ?? null
})
console.log('selected row:', JSON.stringify(selected))

const sendText = async text => {
  await page.click('textarea')
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}
await sendText(`请只回复“ok”两个字。turn=${Date.now() % 1000000}`)
console.log('prompt sent, waiting for reply…')
await sleep(90_000)

const tail = await page.evaluate(() => document.body.innerText.slice(-300))
console.log('after reply tail:', JSON.stringify(tail.slice(-120)))

await sendText('/rollback')
console.log('rollback sent, watching navigation…')

let navigated = false
for (let i = 0; i < 24; i++) {
  await sleep(5_000)
  const now = await currentId()
  if (now !== null && now !== idBefore) {
    console.log(`t+${(i + 1) * 5}s current changed: ${idBefore} -> ${now}`)
    navigated = true
    break
  }
}
console.log('auto-navigated:', navigated)
const idAfter = await currentId()
console.log('current session after:', idAfter)
const selAfter = await page.evaluate(() => {
  const sel = document.querySelector('div[role="treeitem"][aria-selected="true"]')
  return sel?.textContent?.trim().slice(0, 50) ?? null
})
console.log('selected row after:', JSON.stringify(selAfter))

await browser.close()
