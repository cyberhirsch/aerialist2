/**
 * Workspace layout: a Blender-style tree of splits whose leaves are
 * panes. Each pane has a kind (its "editor type") switchable at runtime.
 */

export type PaneKind = 'editor' | 'organizer' | 'rsvp'

export const PANE_KINDS: { kind: PaneKind; label: string }[] = [
  { kind: 'editor', label: 'editor' },
  { kind: 'organizer', label: 'organizer' },
  { kind: 'rsvp', label: 'rsvp' },
]

export interface SplitNode {
  type: 'split'
  id: string
  dir: 'row' | 'col'
  /** Fraction of space given to child `a` (0..1). */
  ratio: number
  a: LayoutNode
  b: LayoutNode
}

export interface PaneNode {
  type: 'pane'
  id: string
  kind: PaneKind
}

export type LayoutNode = SplitNode | PaneNode

let counter = 0
export const paneId = (): string => `p${Date.now().toString(36)}${counter++}`

export function pane(kind: PaneKind): PaneNode {
  return { type: 'pane', id: paneId(), kind }
}

export function defaultLayout(): LayoutNode {
  return {
    type: 'split',
    id: paneId(),
    dir: 'row',
    ratio: 0.22,
    a: pane('organizer'),
    b: {
      type: 'split',
      id: paneId(),
      dir: 'row',
      ratio: 0.7,
      a: pane('editor'),
      b: pane('rsvp'),
    },
  }
}

export function listPanes(node: LayoutNode): PaneNode[] {
  if (node.type === 'pane') return [node]
  return [...listPanes(node.a), ...listPanes(node.b)]
}

export function findPane(node: LayoutNode, id: string): PaneNode | null {
  return listPanes(node).find((p) => p.id === id) ?? null
}

/** First pane of a kind, in visual (tree) order. */
export function firstPaneOfKind(node: LayoutNode, kind: PaneKind): PaneNode | null {
  return listPanes(node).find((p) => p.kind === kind) ?? null
}

export function setPaneKind(node: LayoutNode, id: string, kind: PaneKind): LayoutNode {
  if (node.type === 'pane') {
    return node.id === id ? { ...node, kind } : node
  }
  return { ...node, a: setPaneKind(node.a, id, kind), b: setPaneKind(node.b, id, kind) }
}

export function setRatio(node: LayoutNode, id: string, ratio: number): LayoutNode {
  if (node.type === 'pane') return node
  if (node.id === id) {
    return { ...node, ratio: Math.max(0.1, Math.min(0.9, ratio)) }
  }
  return { ...node, a: setRatio(node.a, id, ratio), b: setRatio(node.b, id, ratio) }
}

/** Split a pane in two; the new sibling inherits the pane's kind. */
export function splitPane(node: LayoutNode, id: string, dir: 'row' | 'col'): LayoutNode {
  if (node.type === 'pane') {
    if (node.id !== id) return node
    return {
      type: 'split',
      id: paneId(),
      dir,
      ratio: 0.5,
      a: node,
      b: pane(node.kind),
    }
  }
  return { ...node, a: splitPane(node.a, id, dir), b: splitPane(node.b, id, dir) }
}

/** Remove a pane; its sibling takes the parent split's place. */
export function closePane(node: LayoutNode, id: string): LayoutNode {
  if (node.type === 'pane') return node
  if (node.a.type === 'pane' && node.a.id === id) return closePane(node.b, id)
  if (node.b.type === 'pane' && node.b.id === id) return closePane(node.a, id)
  return { ...node, a: closePane(node.a, id), b: closePane(node.b, id) }
}

/* ── persistence ─────────────────────────────────────────────── */

const STORAGE_KEY = 'aerialist2.layout.v1'

export function saveLayout(root: LayoutNode): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(root))
  } catch {
    // storage full/unavailable — layout just won't persist
  }
}

export function loadLayout(): LayoutNode | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LayoutNode
    return isValidNode(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isValidNode(n: unknown): n is LayoutNode {
  if (typeof n !== 'object' || n === null) return false
  const node = n as Record<string, unknown>
  if (node.type === 'pane') {
    return (
      typeof node.id === 'string' &&
      PANE_KINDS.some((k) => k.kind === node.kind)
    )
  }
  if (node.type === 'split') {
    return (
      typeof node.id === 'string' &&
      (node.dir === 'row' || node.dir === 'col') &&
      typeof node.ratio === 'number' &&
      isValidNode(node.a) &&
      isValidNode(node.b)
    )
  }
  return false
}
