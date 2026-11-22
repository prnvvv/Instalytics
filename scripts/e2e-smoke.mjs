// End-to-end smoke test against RUNNING servers (start them with scripts/dev.ps1 first).
//
//   node scripts/e2e-smoke.mjs [--web http://localhost:5173] [--api online|offline|any] [--browser <path>]
//                              [--zip <real-export.zip> [--warning yes|no|any]]
//
// With --zip a real Instagram export is imported instead of the synthetic one, and the expected figures are
// computed independently from its raw JSON. The real file is only read locally and never printed or sent anywhere.
//
// Drives a real Chromium-based browser (Edge by default on Windows, or $BROWSER) over the DevTools protocol, with
// no extra dependencies. It imports a generated, synthetic ZIP shaped like a "last year" export, and checks:
// the landing page, the Get started link, the live API indicator, the one-screen import (privacy note, then the
// file, then straight to the overview), the completeness warning, the overview figures, the category page and its
// details dialog, that the import, overview, category, History and Settings pages all fit the window without
// scrolling or clipping, the Settings backend card, and that nothing but a health check ever hits the network.
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

// With --zip <path> a REAL export is used instead: the expected figures are then computed independently from the
// archive's raw JSON (a naive count, not the app's parser). --warning yes|no|any says whether the app should flag it.
const realZip = args.zip
let exp = { followers: 120, following: 300, mutuals: 60, notFollowingBack: 240, fans: 60, warning: 'yes', ignoredFile: true }
let uploadPath = zipPath
let realNames = []

if (realZip) {
  const { unzipSync } = await import(pathToFileURL(join(here, '..', 'frontend', 'node_modules', 'fflate', 'esm', 'browser.js')).href)
  const { readFileSync } = await import('node:fs')
  const entries = unzipSync(new Uint8Array(readFileSync(realZip)))
  const usernames = pattern => {
    const names = []

    for (const [path, bytes] of Object.entries(entries)) {
      if (!pattern.test(path.split('/').pop())) continue
      let data = JSON.parse(new TextDecoder().decode(bytes).replace(/^﻿/, ''))

      if (!Array.isArray(data)) data = Object.values(data).find(Array.isArray)
      for (const entry of data) for (const item of entry.string_list_data) names.push((/instagram\.com\/(?:_u\/)?([^/?#]+)/.exec(item.href ?? '')?.[1] ?? item.value ?? entry.title).toLowerCase())
    }

    return new Set(names)
  }
  const f = usernames(/^followers(_\d+)?\.json$/i)
  const g = usernames(/^following(_\d+)?\.json$/i)
  const mutuals = [...f].filter(n => g.has(n)).length

  exp = { followers: f.size, following: g.size, mutuals, notFollowingBack: g.size - mutuals, fans: f.size - mutuals, warning: args.warning ?? 'any', ignoredFile: false }
  realNames = [...new Set([...f, ...g])].filter(name => name.length >= 6)
  uploadPath = realZip
  console.log(`real export: expecting followers=${exp.followers} following=${exp.following} mutuals=${exp.mutuals} not-following-back=${exp.notFollowingBack} fans=${exp.fans}\n`)
} else {
  writeFileSync(
    zipPath,
    zipSync({
      [`${root}/followers_1.json`]: strToU8(JSON.stringify(followers)),
      [`${root}/following.json`]: strToU8(JSON.stringify({ relationships_following: following })),
      [`${root}/recent_follow_requests.json`]: strToU8(JSON.stringify([{ timestamp: 1, media: [], label_values: [{ label: 'Username', value: 'ignored_person' }] }]))
    })
  )
}
// Synthetic expectation: followers 120, following 300; overlap u0060..u0119 = 60 mutuals, 240 not following back, 60 fans.

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

  // 4. Import the ZIP: one screen, with the privacy note accepted before the file is chosen
  const n = value => value.toLocaleString('en-US')
  const fits = () => evaluate('document.documentElement.scrollHeight <= window.innerHeight + 1')
  const overflowing = () => evaluate('`${document.documentElement.scrollHeight}px of content in a ${window.innerHeight}px window`')

  check('the import page fits the window without scrolling', await fits(), await overflowing())
  check('the file input is locked until the privacy note is accepted', await evaluate(`document.querySelector('input[type=file]')?.disabled === true`))
  await evaluate(`[...document.querySelectorAll('label.ix-check')].find(l => /i understand my export is read only/i.test(l.textContent))?.querySelector('input')?.click()`)
  check('accepting the privacy note unlocks the file input', await waitFor(`document.querySelector('input[type=file]')?.disabled === false`))

  const { result: doc } = await send('DOM.getDocument')
  const { result: input } = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' })

  await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [uploadPath] })
  check('the export opens the overview straight away, with no confirm step', await waitFor(`location.pathname === '/app/dashboard' && document.querySelector('h1')?.innerText.includes('NETWORK')`))

  const card = label => evaluate(`document.querySelector('[aria-label^="${label}"]')?.getAttribute('aria-label') ?? ''`)

  check(`dashboard: ${n(exp.followers)} followers`, (await card('Followers:')).includes(`${n(exp.followers)} followers`), await card('Followers:'))
  check(`dashboard: ${n(exp.following)} following`, (await card('Following:')).includes(`${n(exp.following)} following`), await card('Following:'))
  check(`dashboard: ${n(exp.mutuals)} mutuals`, (await card('Mutuals:')).includes(`${n(exp.mutuals)} mutual`), await card('Mutuals:'))
  check(`dashboard: ${n(exp.notFollowingBack)} not following back`, (await card('Not following back:')).includes(`${n(exp.notFollowingBack)} accounts`), await card('Not following back:'))
  check(`dashboard: ${n(exp.fans)} fans`, (await card('Fans:')).includes(`${n(exp.fans)} fans`), await card('Fans:'))
  check('the overview fits the window without scrolling', await fits(), await overflowing())
  check('nothing on the overview is cut off inside its tile', await evaluate(`[...document.querySelectorAll('.ix-tile')].every(e => e.scrollHeight <= e.clientHeight + 1)`), await evaluate(`[...document.querySelectorAll('.ix-tile')].filter(e => e.scrollHeight > e.clientHeight + 1).map(e => e.querySelector('h1,h2,h3')?.textContent).join(', ')`))

  // The import details dialog lists every file the parser looked at.
  if (exp.ignoredFile) {
    await clickByText('button', 'import details')
    check('the look-alike file is listed as ignored, not counted', await waitFor(`/recent_follow_requests\\.json/.test(document.querySelector('[role=dialog]')?.innerText ?? '') && /ignored/i.test(document.querySelector('[role=dialog]')?.innerText ?? '')`))
    await click('[role=dialog] button[aria-label=Close]')
  }

  // Optional: type the counts Instagram's own app shows, to exercise "Check against Instagram".
  const reportedFollowers = args['reported-followers'] ? Number(args['reported-followers']) : null
  const reportedFollowing = args['reported-following'] ? Number(args['reported-following']) : null

  if (reportedFollowers !== null || reportedFollowing !== null) {
    await clickByText('button', 'check against instagram')
    await waitFor(`!!document.querySelector('[role=dialog] input')`)

    const typeInto = (label, value) => evaluate(`(() => {
      const label = [...document.querySelectorAll('label')].find(l => l.textContent.includes(${JSON.stringify(label)}))
      const input = label && document.getElementById(label.htmlFor)
      if (!input) return false
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(String(value))})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    const verdict = (exported, reported) => {
      const diff = exported - reported

      if (Math.abs(diff) <= Math.max(2, Math.round(reported * 0.005))) return 'match'

      return diff > 0 ? `${n(diff)} more account` : `${n(Math.abs(diff))} fewer account`
    }

    if (reportedFollowers !== null) await typeInto('Followers in the Instagram app', reportedFollowers)
    if (reportedFollowing !== null) await typeInto('Following in the Instagram app', reportedFollowing)

    await sleep(500)

    const panel = await evaluate(`document.querySelector('[role=dialog]')?.innerText ?? ''`)

    if (reportedFollowers !== null) check(`reconcile: followers ${n(exp.followers)} vs Instagram ${n(reportedFollowers)} -> ${verdict(exp.followers, reportedFollowers)}`, verdict(exp.followers, reportedFollowers) === 'match' ? /Followers match/.test(panel) : panel.includes(verdict(exp.followers, reportedFollowers)), panel.slice(0, 200))
    if (reportedFollowing !== null) check(`reconcile: following ${n(exp.following)} vs Instagram ${n(reportedFollowing)} -> ${verdict(exp.following, reportedFollowing)}`, verdict(exp.following, reportedFollowing) === 'match' ? /Following match/.test(panel) : panel.includes(verdict(exp.following, reportedFollowing)), panel.slice(0, 200))

    console.log('\nWhat the app says in "Check against Instagram":\n' + panel.split('\n').map(line => '   | ' + line).join('\n') + '\n')
    await click('[role=dialog] button[aria-label=Close]')
  }

  const notice = /These results may not cover everyone|This export looks incomplete/.test(await text())

  if (exp.warning === 'yes') check('the overview shows the completeness warning for a date-limited export', notice)
  else if (exp.warning === 'no') check('the overview shows no completeness warning for a complete export', !notice)
  else console.log(`INFO  completeness warning shown: ${notice}`)

  // 6. A category page, History, and Settings: each one fits the window too
  await clickByText('a', 'not following back')
  check(`the not-following-back list shows how many accounts there are (${n(exp.notFollowingBack)})`, await waitFor(`new RegExp('1[-–]\\\\d+ of ${n(exp.notFollowingBack).replace(',', ',')}').test(document.body.innerText)`))
  check('the category page fits the window without scrolling', await fits(), await overflowing())
  check('the category page shows its chart and insights beside the accounts', await evaluate(`!!document.querySelector('aside[aria-label$="statistics"] .ix-columns') && /Insights/.test(document.body.innerText)`))
  check('the account cards fill the page and none is cut off', await evaluate(`(() => { const g = document.querySelector('.ix-cards'); return !!g && g.scrollHeight <= g.clientHeight + 1 && g.children.length > 0 })()`))

  await evaluate(`document.querySelector('.ix-acct-main')?.click()`)
  check('an account opens in a details dialog with a safe profile link', await waitFor(`!!document.querySelector('[role=dialog] a[href^="https://www.instagram.com/"][rel="noopener noreferrer"]')`))
  await click('[role=dialog] button[aria-label=Close]')

  await clickByText('a', 'history')
  await waitFor(`location.pathname === '/app/history'`)
  check('History fits the window without scrolling', await fits(), await overflowing())

  await send('Page.navigate', { url: web + '/app/settings' })
  await waitFor(`location.pathname === '/app/settings' && document.body.innerText.includes('YOUR')`)
  check('Settings fits the window without scrolling', await fits(), await overflowing())
  if (apiExpectation === 'online') {
    check('Settings shows the backend as online with its readiness checks', await waitFor(`document.body.innerText.includes('Online and ready.') && document.body.innerText.toLowerCase().includes('redis')`), (await text()).slice(0, 200))
  }

  // 7. Privacy and health
  const fetches = requests.filter(r => ['Fetch', 'XHR'].includes(r.type))
  const api = fetches.filter(r => new URL(r.url).pathname.startsWith('/api/'))

  check('every API request is a body-less GET to the health endpoint', api.length > 0 || apiExpectation === 'offline')
  check('no API request carries a body or any path other than health', api.every(r => r.method === 'GET' && !r.hasBody && new URL(r.url).pathname === '/api/v1/health/ready'), JSON.stringify(api.slice(0, 3)))
  check('no request leaves the app origin except font stylesheets', requests.filter(r => !r.url.startsWith(web) && !r.url.startsWith('data:') && !r.url.startsWith('blob:') && !/fonts\.(googleapis|gstatic)\.com/.test(r.url)).length === 0, JSON.stringify(requests.filter(r => !r.url.startsWith(web) && !/fonts\./.test(r.url)).slice(0, 3)))
  check('no username appears in any request URL', !requests.some(r => /u\d{4}/.test(new URL(r.url).pathname + new URL(r.url).search) || realNames.some(name => r.url.toLowerCase().includes(name))))
  check('the browser console stayed free of errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
} finally {
  ws.close()
  cleanup()
}

const failed = results.filter(r => !r.ok)

console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
