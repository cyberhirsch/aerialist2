// Publishes the Chrome extension via the Chrome Web Store Publish API:
//  1. builds dist-extension/ (unless --skip-build)
//  2. zips it in memory (no external `zip` binary — portable across CI/local)
//  3. exchanges the refresh token for a short-lived access token
//  4. uploads the zip as a new draft version
//  5. submits it for review and auto-publishes once approved, unless
//     --upload-only is passed (then it's left as a draft in the dashboard)
//
// Required env vars — see docs/publishing-the-extension.md for how to get them:
//   CHROME_EXTENSION_ID     the store item id (from the dashboard/listing URL)
//   CHROME_CLIENT_ID        OAuth client id (Google Cloud Console)
//   CHROME_CLIENT_SECRET    OAuth client secret
//   CHROME_REFRESH_TOKEN    long-lived refresh token for the publishing account
//
// Usage:
//   node scripts/publish-extension.mjs                       # build, upload, publish
//   node scripts/publish-extension.mjs --upload-only         # build, upload, leave as draft
//   node scripts/publish-extension.mjs --skip-build          # zip the existing dist-extension/
//   node scripts/publish-extension.mjs --target=trustedTesters
//   node scripts/publish-extension.mjs --zip-only=out.zip    # just build+zip, no credentials needed

import { existsSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const args = new Set(process.argv.slice(2))
const targetArg = process.argv.find((a) => a.startsWith('--target='))
const publishTarget = targetArg ? targetArg.split('=')[1] : 'default'

const distDir = fileURLToPath(new URL('../dist-extension/', import.meta.url))

function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    console.error(`missing required env var: ${name}`)
    process.exit(1)
  }
  return value
}

// ---- zip (STORE + DEFLATE, no external dependency) -------------------

function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function dosDateTime(date) {
  const time =
    ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff
  const dosDate =
    (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff
  return { time, dosDate }
}

function collectFiles(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) collectFiles(full, base, out)
    else out.push(path.relative(base, full).split(path.sep).join('/'))
  }
  return out
}

/** Zips a directory's contents into a Buffer. Pure Node, no shell-out. */
function zipDirectory(dir) {
  const files = collectFiles(dir).sort()
  const localParts = []
  const central = []
  let offset = 0

  for (const rel of files) {
    const data = readFileSync(path.join(dir, rel))
    const compressed = deflateRawSync(data)
    const useDeflate = compressed.length < data.length
    const payload = useDeflate ? compressed : data
    const method = useDeflate ? 8 : 0
    const crc = crc32(data)
    const { time, dosDate } = dosDateTime(statSync(path.join(dir, rel)).mtime)
    const nameBuf = Buffer.from(rel, 'utf8')

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 filename flag
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, nameBuf, payload)

    const centralEntry = Buffer.alloc(46)
    centralEntry.writeUInt32LE(0x02014b50, 0)
    centralEntry.writeUInt16LE(20, 4)
    centralEntry.writeUInt16LE(20, 6)
    centralEntry.writeUInt16LE(0x0800, 8)
    centralEntry.writeUInt16LE(method, 10)
    centralEntry.writeUInt16LE(time, 12)
    centralEntry.writeUInt16LE(dosDate, 14)
    centralEntry.writeUInt32LE(crc, 16)
    centralEntry.writeUInt32LE(payload.length, 20)
    centralEntry.writeUInt32LE(data.length, 24)
    centralEntry.writeUInt16LE(nameBuf.length, 28)
    centralEntry.writeUInt16LE(0, 30)
    centralEntry.writeUInt16LE(0, 32)
    centralEntry.writeUInt16LE(0, 34)
    centralEntry.writeUInt16LE(0, 36)
    centralEntry.writeUInt32LE(0, 38)
    centralEntry.writeUInt32LE(offset, 42)
    central.push(centralEntry, nameBuf)

    offset += local.length + nameBuf.length + payload.length
  }

  const centralBuf = Buffer.concat(central)
  const localBuf = Buffer.concat(localParts)

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(localBuf.length, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([localBuf, centralBuf, eocd])
}

// ---- Chrome Web Store API ---------------------------------------------

async function getAccessToken({ clientId, clientSecret, refreshToken }) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`token refresh failed: ${JSON.stringify(body)}`)
  return body.access_token
}

async function uploadPackage({ extensionId, accessToken, zipBuffer }) {
  const res = await fetch(
    `https://www.googleapis.com/upload/chromewebstore/v1.1/items/${extensionId}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'x-goog-api-version': '2',
      },
      body: zipBuffer,
    },
  )
  const body = await res.json()
  if (!res.ok || body.uploadState === 'FAILURE') {
    throw new Error(`upload failed: ${JSON.stringify(body, null, 2)}`)
  }
  return body
}

async function publishItem({ extensionId, accessToken, target }) {
  const res = await fetch(
    `https://www.googleapis.com/chromewebstore/v1.1/items/${extensionId}/publish?publishTarget=${target}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'x-goog-api-version': '2',
        'Content-Length': '0',
      },
    },
  )
  const body = await res.json()
  if (!res.ok) throw new Error(`publish failed: ${JSON.stringify(body, null, 2)}`)
  return body
}

// ---- main --------------------------------------------------------------

async function main() {
  const zipOnlyArg = process.argv.find((a) => a.startsWith('--zip-only='))

  // credentials aren't needed just to produce the zip
  const extensionId = zipOnlyArg ? null : requireEnv('CHROME_EXTENSION_ID')
  const clientId = zipOnlyArg ? null : requireEnv('CHROME_CLIENT_ID')
  const clientSecret = zipOnlyArg ? null : requireEnv('CHROME_CLIENT_SECRET')
  const refreshToken = zipOnlyArg ? null : requireEnv('CHROME_REFRESH_TOKEN')

  if (!args.has('--skip-build')) {
    console.log('building extension (typecheck + build)…')
    const { execFileSync } = await import('node:child_process')
    // goes through the npm script, not build-extension.mjs directly, so a
    // typecheck failure blocks publishing rather than shipping stale JS
    // shell:true is needed on Windows to resolve npm.cmd; the command is a
    // fixed literal (no interpolated input), so there's nothing to escape
    execFileSync('npm run build:extension', {
      stdio: 'inherit',
      shell: true,
    })
  }

  if (!existsSync(distDir)) {
    console.error(`${distDir} does not exist — build the extension first`)
    process.exit(1)
  }

  console.log('zipping dist-extension/ …')
  const zipBuffer = zipDirectory(distDir)
  console.log(`  ${(zipBuffer.length / 1e6).toFixed(2)} MB`)

  if (zipOnlyArg) {
    const outPath = zipOnlyArg.split('=')[1]
    writeFileSync(outPath, zipBuffer)
    console.log(`wrote ${outPath} — no upload, no credentials used`)
    return
  }

  console.log('refreshing access token…')
  const accessToken = await getAccessToken({ clientId, clientSecret, refreshToken })

  console.log(`uploading to item ${extensionId} …`)
  const uploadResult = await uploadPackage({ extensionId, accessToken, zipBuffer })
  console.log(`  uploadState: ${uploadResult.uploadState}`)

  if (args.has('--upload-only')) {
    console.log('--upload-only set: leaving as a draft. Publish manually from the dashboard when ready.')
    return
  }

  console.log(`submitting for review (target: ${publishTarget}) …`)
  const publishResult = await publishItem({ extensionId, accessToken, target: publishTarget })
  console.log(`  status: ${JSON.stringify(publishResult.status)}`)
  if (publishResult.statusDetail) console.log(`  detail: ${publishResult.statusDetail}`)
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
