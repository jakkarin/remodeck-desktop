import { describe, it, expect } from 'vitest'
import { logsCommand, shellCommand, composeCommand, buildHostSshArgs } from '../../../src/main/docker/hostCommands'
import type { ComposeAction } from '../../../src/shared/containers'

describe('hostCommands', () => {
  it('logs and shell commands quote the id', () => {
    const id = 'a'.repeat(12)
    expect(logsCommand(id)).toBe(`docker logs -f --tail 500 '${id}'`)
    expect(shellCommand(id)).toBe(
      `docker exec -it '${id}' sh -c 'command -v bash >/dev/null && exec bash || exec sh'`
    )
  })
  it('rejects ids that are not container ids', () => {
    for (const bad of ['abc', 'A'.repeat(12), 'a'.repeat(12) + ';rm', '--help'])
      expect(() => logsCommand(bad)).toThrow('container id ไม่ถูกต้อง')
  })
  it('compose command with dir and files, up adds -d', () => {
    expect(
      composeCommand({ name: 'shop', workingDir: '/srv/my app', configFiles: ["/srv/my app/it's.yml", '/srv/my app/b.yml'] }, 'up')
    ).toBe(
      `docker compose -p 'shop' --project-directory '/srv/my app' -f '/srv/my app/it'\\''s.yml' -f '/srv/my app/b.yml' up -d`
    )
  })
  it('compose up/pull/restart without dir or files throws the Thai path error', () => {
    expect(() => composeCommand({ name: 'shop', workingDir: '', configFiles: [] }, 'up')).toThrow(
      'ไม่พบ path ของ compose project นี้ จึงสั่ง up ไม่ได้'
    )
    expect(() => composeCommand({ name: 'shop', workingDir: '', configFiles: [] }, 'pull')).toThrow('จึงสั่ง pull ไม่ได้')
  })
  it('compose omits missing dir and files', () => {
    expect(composeCommand({ name: 'shop', workingDir: '', configFiles: [] }, 'down')).toBe(`docker compose -p 'shop' down`)
  })
  it('compose rejects bad project names and relative paths', () => {
    expect(() => composeCommand({ name: 'My.App', workingDir: '', configFiles: [] }, 'pull')).toThrow('ชื่อ compose project ไม่ถูกต้อง')
    expect(() => composeCommand({ name: 'ok', workingDir: 'rel/dir', configFiles: [] }, 'pull')).toThrow()
    expect(() => composeCommand({ name: 'ok', workingDir: '/srv', configFiles: ['x.yml'] }, 'pull')).toThrow()
  })
  it('rejects an unknown compose action', () => {
    expect(() => composeCommand({ name: 'ok', workingDir: '/srv', configFiles: [] }, 'rm' as ComposeAction)).toThrow()
  })
  it('buildHostSshArgs', () => {
    expect(buildHostSshArgs('box1', 'docker ps')).toEqual(['-t', 'box1', 'docker ps'])
  })
})
