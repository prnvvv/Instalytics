// End-to-end smoke test against RUNNING servers (start them with scripts/dev.ps1 first).
//
//   node scripts/e2e-smoke.mjs [--web http://localhost:5173] [--api online|offline|any] [--browser <path>]
//
// Drives a real Chromium-based browser (Edge by default on Windows, or $BROWSER) over the DevTools protocol, with
// no extra dependencies. It imports a generated, synthetic ZIP shaped like a "last year" export, and checks:
// the landing page, the Get started link, the live API indicator, the import preview and its warning, analysis,
// the dashboard figures, the Settings backend card, and that nothing but a health check ever hits the network.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []))
const web = (args.web ?? 'http://localhost:5173').replace(/\/$/, '')
const apiExpectation = args.api ?? 'online'
const browserPath = args.browser ?? process.env.BROWSER ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const port = 9555 + Math.floor(Math.random() * 200)

const here = fileURLToPath(new URL('.', import.meta.url))
const { zipSync, strToU8 } = await import(pathToFileURL(join(here, '..', 'frontend', 'node_modules', 'fflate', 'esm', 'browser.js')).href)

// --- a synthetic export: followers limited to the last year, following reaching back four years -----------------
const DAY = 86_400
const exportDate = Date.UTC(2026, 10, 22) / 1000
const name = i => `u${String(i).padStart(4, '0')}`
const followers = Array.from({ length: 120 }, (_, i) => ({
  title: '',
  media_list_data: [],
  string_list_data: [{ href: `https://www.instagram.com/${name(i)}`, value: name(i), timestamp: Math.floor(exportDate - (360 - i * 2.8) * DAY) }]
}))
const following = Array.from({ length: 300 }, (_, i) => ({
  title: name(i + 60),
  media_list_data: [],
  string_list_data: [{ href: `https://www.instagram.com/_u/${name(i + 60)}`, timestamp: Math.floor(exportDate - (1600 - i * 5) * DAY) }]
}))
const root = 'instagram-e2e-2026-11-22-AbCdEf/connections/followers_and_following'
const workDir = mkdtempSync(join(tmpdir(), 'inyx-e2e-'))
const zipPath = join(workDir, 'e2e-export.zip')

writeFileSync(
  zipPath,
  zipSync({
    [`${root}/followers_1.json`]: strToU8(JSON.stringify(followers)),
    [`${root}/following.json`]: strToU8(JSON.stringify({ relationships_following: following })),
    [`${root}/recent_follow_requests.json`]: strToU8(JSON.stringify([{ timestamp: 1, media: [], label_values: [{ label: 'Username', value: 'ignored_person' }] }]))
  })
)
// Expected: followers 120, following 300; overlap u0060..u0119 = 60 mutuals, 240 not following back, 60 fans.

// --- assertions -------------------------------------------------------------------------------------------------
const results = []
const check = (label, ok, detail = '') => {
  results.push({ label, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  -> ${detail}`}`)
}

// --- browser plumbing -------------------------------------------------------------------------------------------
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const profile = join(workDir, 'profile')

mkdirSync(profile, { recursive: true })

const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
const cleanup = () => {
  browser.kill()
  try { rmSync(workDir, { recursive: true, force: true }) } catch { /* the browser may still hold the profile */ }
}

process.on('exit', cleanup)

let target
for (let i = 0; i < 60 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page') } catch { await sleep(250) }
}
if (!target) { console.error('Could not start the browser at', browserPath); process.exit(2) }

const ws = new WebSocket(target.webSocketDebuggerUrl)

await new Promise(resolve => (ws.onopen = resolve))

let nextId = 0
const waiting = new Map()
const consoleErrors = []
const requests = []

ws.onmessage = event => {
  const message = JSON.parse(event.data)

  if (message.id && waiting.has(message.id)) { waiting.get(message.id)(message); waiting.delete(message.id); return }
  if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails.exception?.description?.split('\n')[0] ?? message.params.exceptionDetails.text)
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') consoleErrors.push(message.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200))
  if (message.method === 'Network.requestWillBeSent') requests.push({ url: message.params.request.url, method: message.params.request.method, hasBody: Boolean(message.params.request.postData || message.params.request.hasPostData), type: message.params.type })
}

const send = (method, params = {}) => new Promise(resolve => { const id = ++nextId; waiting.set(id, resolve); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async expression => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value
const waitFor = async (expression, timeout = 15000) => {
  const end = Date.now() + timeout

  while (Date.now() < end) {
    if (await evaluate(expression)) return true
    await sleep(200)
  }

  return false
}
const text = () => evaluate('document.body.innerText')
const click = selector => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true })()`)
const clickByText = (tag, needle) => evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(tag)})].find(e => e.textContent.toLowerCase().includes(${JSON.stringify(needle.toLowerCase())})); if (!el) return false; el.click(); return true })()`)

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await send('DOM.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

try {
  // 1. Landing page
  await send('Page.navigate', { url: web + '/' })
  check('landing page renders its headline', await waitFor(`document.querySelector('h1') && document.body.innerText.includes('INSTAGRAM')`))
  const getStarted = await evaluate(`[...document.querySelectorAll('a')].find(a => /get started/i.test(a.textContent))?.getAttribute('href')`)

  check('"Get started" links to the app', getStarted === '/app', `href was ${getStarted}`)

  // 2. Into the app, with no login step
  await clickByText('a', 'get started')
  check('Get started opens the import page directly (no login)', await waitFor(`location.pathname === '/app/import' && document.body.innerText.includes('BRING IN YOUR')`))
  check('the page has no password or login fields', !(await evaluate(`!!document.querySelector('input[type=password], input[type=email], form')`)))

  // 3. Backend wiring
  const header = () => evaluate(`document.querySelector('header')?.innerText ?? ''`)

  if (apiExpectation === 'online') check('header shows "API online"', await waitFor(`document.querySelector('header')?.innerText.includes('API online')`), await header())
  else if (apiExpectation === 'offline') check('header shows "API offline"', await waitFor(`document.querySelector('header')?.innerText.includes('API offline')`), await header())

  const proxied = await evaluate(`fetch('/api/v1/health/ready').then(r => r.json()).then(j => j.status).catch(() => 'unreachable')`)

  if (apiExpectation === 'online') check('the dev proxy reaches the backend readiness endpoint', proxied === 'ok', String(proxied))

  // 4. Import the ZIP
  const { result: doc } = await send('DOM.getDocument')
  const { result: input } = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' })

  await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [zipPath] })
  check('the import preview appears', await waitFor(`document.body.innerText.includes('WHAT WAS DETECTED')`))

  const preview = await text()

  check('the preview counts 120 followers and 300 following', /Followers found/.test(preview) && (await evaluate(`!!document.querySelector('[aria-label="120 followers found"]') && !!document.querySelector('[aria-label="300 following found"]')`)))
  check('the look-alike file is listed as ignored, not counted', /recent_follow_requests\.json/.test(preview) && /ignored/i.test(preview))
  check('the date-limited export is flagged', /may be limited to a date range/i.test(preview))
  check('Analyse is blocked until the warning is acknowledged', await evaluate(`[...document.querySelectorAll('button')].find(b => /analyse this export/i.test(b.textContent))?.disabled === true`))

  // 5. Acknowledge, analyse
  await evaluate(`[...document.querySelectorAll('label.ix-check')].find(l => /i understand/i.test(l.textContent))?.querySelector('input')?.click()`)
  await clickByText('button', 'analyse this export')
  check('analysis opens the dashboard', await waitFor(`location.pathname === '/app/dashboard' && document.querySelector('h1')?.innerText.includes('NETWORK')`))

  const card = label => evaluate(`document.querySelector('[aria-label^="${label}"]')?.getAttribute('aria-label') ?? ''`)

  check('dashboard: 120 followers', /120 followers/.test(await card('Followers:')), await card('Followers:'))
  check('dashboard: 300 following', /300 following/.test(await card('Following:')), await card('Following:'))
  check('dashboard: 60 mutuals', /60 mutual/.test(await card('Mutuals:')), await card('Mutuals:'))
  check('dashboard: 240 not following back', /240 accounts/.test(await card('Not following back:')), await card('Not following back:'))
  check('dashboard: 60 fans', /60 fans/.test(await card('Fans:')), await card('Fans:'))
  check('dashboard keeps the completeness warning visible', /These results may not cover everyone/.test(await text()))

  // 6. A list, and Settings
  await clickByText('a', 'not following back')
  check('the not-following-back list shows 1-25 of 240', await waitFor(`document.body.innerText.includes('1–25 of 240') || document.body.innerText.includes('1-25 of 240')`))

  await send('Page.navigate', { url: web + '/app/settings' })
  if (apiExpectation === 'online') {
    check('Settings shows the backend as online with its readiness checks', await waitFor(`document.body.innerText.includes('Online and ready.') && document.body.innerText.toLowerCase().includes('redis')`), (await text()).slice(0, 200))
  }

  // 7. Privacy and health
  const fetches = requests.filter(r => ['Fetch', 'XHR'].includes(r.type))
  const api = fetches.filter(r => new URL(r.url).pathname.startsWith('/api/'))

  check('every API request is a body-less GET to the health endpoint', api.length > 0 || apiExpectation === 'offline')
  check('no API request carries a body or any path other than health', api.every(r => r.method === 'GET' && !r.hasBody && new URL(r.url).pathname === '/api/v1/health/ready'), JSON.stringify(api.slice(0, 3)))
  check('no request leaves the app origin except font stylesheets', requests.filter(r => !r.url.startsWith(web) && !r.url.startsWith('data:') && !r.url.startsWith('blob:') && !/fonts\.(googleapis|gstatic)\.com/.test(r.url)).length === 0, JSON.stringify(requests.filter(r => !r.url.startsWith(web) && !/fonts\./.test(r.url)).slice(0, 3)))
  check('no username appears in any request URL', !requests.some(r => /u\d{4}/.test(new URL(r.url).pathname + new URL(r.url).search)))
  check('the browser console stayed free of errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
} finally {
  ws.close()
  cleanup()
}

const failed = results.filter(r => !r.ok)

console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
