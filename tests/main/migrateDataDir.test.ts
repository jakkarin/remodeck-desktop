import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrateDataDir } from '../../src/main/migrateDataDir'

let root: string
let from: string
let to: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'remodeck-migrate-'))
  from = path.join(root, 'regit')
  to = path.join(root, 'remodeck')
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('migrateDataDir', () => {
  it('copies the old data dir, nested files included, when the new one is missing', () => {
    fs.mkdirSync(path.join(from, 'mirrors', 'a'), { recursive: true })
    fs.writeFileSync(path.join(from, 'config.json'), '{"hosts":[1]}')
    fs.writeFileSync(path.join(from, 'mirrors', 'a', 'HEAD'), 'ref')

    expect(migrateDataDir(from, to)).toBe(true)
    expect(fs.readFileSync(path.join(to, 'config.json'), 'utf8')).toBe('{"hosts":[1]}')
    expect(fs.readFileSync(path.join(to, 'mirrors', 'a', 'HEAD'), 'utf8')).toBe('ref')
    // the old dir is left alone so an installed regit keeps working
    expect(fs.existsSync(path.join(from, 'config.json'))).toBe(true)
    expect(fs.readdirSync(root).sort()).toEqual(['regit', 'remodeck'])
  })

  it('never touches an existing new data dir', () => {
    fs.mkdirSync(from)
    fs.writeFileSync(path.join(from, 'config.json'), 'old')
    fs.mkdirSync(to)
    fs.writeFileSync(path.join(to, 'config.json'), 'new')

    expect(migrateDataDir(from, to)).toBe(false)
    expect(fs.readFileSync(path.join(to, 'config.json'), 'utf8')).toBe('new')
  })

  it('does nothing when there is no old data dir', () => {
    expect(migrateDataDir(from, to)).toBe(false)
    expect(fs.existsSync(to)).toBe(false)
  })
})
