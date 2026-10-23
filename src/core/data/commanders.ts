import { editorConfig, findCommanderById, getCommanderDisplayName } from './config'

export function getCommander(id: number) {
  return findCommanderById(id)
}

export function getCommanderName(id: number): string {
  if (id <= 0) return ''
  const name = getCommanderDisplayName(id)
  return name || `#${id}`
}

export function getAllCommanders() {
  return editorConfig.value.commanders
}