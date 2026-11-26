import { useSyncExternalStore } from 'react'

/** Fork: lightweight open/close store for the Desktop OpenClaw & Hermes workspace page (§16). */

let isOpen = false
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function openEcosystemPage(): void {
  if (!isOpen) {
    isOpen = true
    emit()
  }
}

export function closeEcosystemPage(): void {
  if (isOpen) {
    isOpen = false
    emit()
  }
}

export function toggleEcosystemPage(): void {
  isOpen = !isOpen
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): boolean {
  return isOpen
}

export function useEcosystemPageOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
