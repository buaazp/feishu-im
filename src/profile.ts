/** Read and update the plugin-owned row without replacing unrelated profile configuration. */
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isMap, isSeq, parseDocument, YAMLMap, type Document } from 'yaml'
import { Config, validateConfig } from './config.ts'

/** Application-driver row audited by dsh at startup. */
export const RUNNER_ID = 'feishu-im'
/** The installable dsh bundle managed by this command. */
export const PACKAGE_NAME = 'dsh-feishu-im'

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function readPatch(directory: string): Promise<string> {
  const path = join(directory, 'cordis.patch.yml')
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error('The profile patch is a symlink; edit its target manually.')
    return await readFile(path, 'utf8')
  } catch (error: unknown) {
    if (isMissing(error)) return ''
    throw error
  }
}

/** Validate that management is running inside a installed dsh profile. */
export async function assertProfile(directory: string): Promise<void> {
  let manifest: unknown
  try {
    manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  } catch (error: unknown) {
    throw new Error('Run through dsh plugin --profile NAME exec feishu-im after installing the bundle.', { cause: error })
  }
  if (manifest === null || typeof manifest !== 'object' || !('dsh' in manifest)) {
    throw new Error('This directory is not a dsh profile.')
  }
  const dsh = manifest.dsh
  const profile = dsh !== null && typeof dsh === 'object' && 'profile' in dsh ? dsh.profile : undefined
  const bundles: unknown = profile !== null && typeof profile === 'object' && 'bundles' in profile ? profile.bundles : undefined
  if (!Array.isArray(bundles) || !bundles.includes(PACKAGE_NAME)) {
    throw new Error('Install dsh-feishu-im into this profile before configuring it.')
  }

}

function parsePatch(source: string) {
  const document: Document = parseDocument(source.trim() === '' ? '[]\n' : source, {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }],
  })
  if (document.errors.length > 0 || !isSeq(document.contents)) {
    throw new Error('cordis.patch.yml must be a valid YAML patch list. Fix it before running setup.')
  }
  const rows = document.contents.items.filter(item => isMap(item) && item.get('id') === RUNNER_ID)
  if (rows.length > 1) throw new Error('Multiple feishu-im overrides exist. Consolidate them before running setup.')
  const row = rows[0]
  if (isMap(row) && row.has('name') && row.get('name') !== PACKAGE_NAME) {
    throw new Error('The profile overrides feishu-im with another plugin.')
  }
  return { document, rows: document.contents, row: isMap(row) ? row : undefined }
}

/** Read the configured channel settings; expressions must be managed manually. */
export async function readConfiguration(directory: string): Promise<Config> {
  await assertProfile(directory)
  const { row } = parsePatch(await readPatch(directory))
  if (row === undefined || row.get('disabled') === true) throw new Error('The Feishu channel is not configured or is disabled. Run feishu-im setup.')
  const node = row.get('config', true)
  if (!isMap(node)) throw new Error('Channel config must be a mapping. Run feishu-im setup.')
  const config: Config = Config(node.toJSON().account as Partial<Config>)
  validateConfig(config)
  return config
}

async function update(directory: string, mutate: (patch: ReturnType<typeof parsePatch>) => void): Promise<void> {
  await assertProfile(directory)
  const lock = join(directory, '.feishu-im-setup.lock')
  try {
    await mkdir(lock)
  } catch (error: unknown) {
    throw new Error('Another configuration command may be running. Retry after it finishes; see troubleshooting for stale locks.', { cause: error })
  }
  const temporary = join(directory, `.feishu-im-${randomUUID()}.tmp`)
  try {
    const before = await readPatch(directory)
    const patch = parsePatch(before)
    mutate(patch)
    await writeFile(temporary, patch.document.toString(), { flag: 'wx', mode: 0o600 })
    if (await readPatch(directory) !== before) throw new Error('The profile changed during setup. Retry with the latest configuration.')
    await rename(temporary, join(directory, 'cordis.patch.yml'))
  } finally {
    try {
      await rm(temporary, { force: true })
    } finally {
      await rm(lock, { recursive: true })
    }
  }
}

/** Atomically merge plugin settings into its one profile row, preserving other fields. */
export async function writeConfiguration(directory: string, config: Partial<Config>): Promise<void> {
  await update(directory, (patch) => {
    const row = patch.row ?? new YAMLMap()
    const existing = row.get('config', true)
    if (existing !== undefined && !isMap(existing)) throw new Error('Channel config must be a mapping; edit the profile manually.')
    const settings = existing ?? new YAMLMap()
    const account = settings.get('account', true) ?? new YAMLMap()
    if (!isMap(account)) throw new Error('Channel account must be a mapping; edit the profile manually.')
    for (const [key, value] of Object.entries(config)) account.set(key, value)
    validateConfig(Config(account.toJSON() as Partial<Config>))
    settings.set('account', account)
    row.set('id', RUNNER_ID)
    row.set('name', PACKAGE_NAME)
    row.set('disabled', false)
    row.set('config', settings)
    if (patch.row === undefined) patch.rows.add(row)
  })
}

/** Remove only the plugin's own configured row, retaining Session data and all other rows. */
export async function resetConfiguration(directory: string): Promise<void> {
  await update(directory, (patch) => {
    if (patch.row === undefined) return
    if (patch.row.get('name') !== PACKAGE_NAME) throw new Error('The channel row is not owned by feishu-im; edit it manually.')
    patch.rows.items = patch.rows.items.filter(item => item !== patch.row)
  })
}
