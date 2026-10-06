import { describe, it, expect, beforeEach } from 'vitest'
import type { Host, Workspace } from '../../src/shared/types'
import {
  pickHost,
  pickWorkspace,
  readActiveHost,
  saveActiveHost,
  readLastWorkspaces,
  saveLastWorkspace,
  readActiveModule,
  saveActiveModule
} from '../../src/renderer/src/hostContext'

const h = (id: string): Host => ({ id, sshHost: id, label: id, protected: false })
const w = (id: string, hostId: string): Workspace => ({
  id,
  repoId: 'r',
  hostId,
  sandboxPath: `~/${id}`
})

beforeEach(() => localStorage.clear())

describe('pickHost', () => {
  it('returns the preferred host when it exists', () => {
    expect(pickHost([h('a'), h('b')], 'b')).toBe('b')
  })
  it('falls back to the first host when preferred is missing', () => {
    expect(pickHost([h('a'), h('b')], 'zzz')).toBe('a')
    expect(pickHost([h('a'), h('b')], null)).toBe('a')
  })
  it('returns null with no hosts', () => {
    expect(pickHost([], 'a')).toBeNull()
  })
})

describe('pickWorkspace', () => {
  const ws = [w('w1', 'a'), w('w2', 'b'), w('w3', 'b')]
  it('returns the last workspace of the host when it still belongs to it', () => {
    expect(pickWorkspace('b', ws, { b: 'w3' })).toBe('w3')
  })
  it('falls back to the first workspace of the host when last belongs elsewhere', () => {
    expect(pickWorkspace('b', ws, { b: 'w1' })).toBe('w2')
  })
  it('returns null when the host has no workspaces or is null', () => {
    expect(pickWorkspace('c', ws, {})).toBeNull()
    expect(pickWorkspace(null, ws, {})).toBeNull()
  })
})

describe('storage helpers', () => {
  it('round-trips the active host', () => {
    expect(readActiveHost()).toBeNull()
    saveActiveHost('h2')
    expect(readActiveHost()).toBe('h2')
    saveActiveHost(null)
    expect(readActiveHost()).toBeNull()
  })
  it('round-trips last workspaces per host', () => {
    expect(readLastWorkspaces()).toEqual({})
    saveLastWorkspace('a', 'w1')
    saveLastWorkspace('b', 'w2')
    expect(readLastWorkspaces()).toEqual({ a: 'w1', b: 'w2' })
  })
})

describe('active module', () => {
  it('defaults to git and round-trips', () => {
    expect(readActiveModule()).toBe('git')
    saveActiveModule('containers')
    expect(readActiveModule()).toBe('containers')
    expect(localStorage.getItem('remodeck.activeModule')).toBe('"containers"')
  })
  it('falls back to git on an invalid stored value', () => {
    localStorage.setItem('remodeck.activeModule', '"nope"')
    expect(readActiveModule()).toBe('git')
    localStorage.setItem('remodeck.activeModule', '{bad')
    expect(readActiveModule()).toBe('git')
  })
})
