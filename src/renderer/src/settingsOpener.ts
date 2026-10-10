import { createContext, useContext } from 'react'

export type SettingsSection = 'general' | 'appearance' | 'repositories' | 'gitTokens' | 'pushLog'

export type OpenSettings = (section: SettingsSection, repoId?: string) => void

export const SettingsOpenerContext = createContext<OpenSettings>(() => undefined)

export function useOpenSettings(): OpenSettings {
  return useContext(SettingsOpenerContext)
}
