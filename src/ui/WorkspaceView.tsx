import { useCallback, useRef } from 'react'
import { EditorPane } from './EditorPane'
import { OrganizerPane } from './OrganizerPane'
import { RsvpPane } from './RsvpPane'
import { useApp } from './store'
import { PANE_KINDS, type LayoutNode, type PaneKind, type PaneNode, type SplitNode } from './workspace'

export function WorkspaceView() {
  const layout = useApp((s) => s.layout)
  return (
    <div className="min-h-0 min-w-0 flex-1">
      <NodeView node={layout} />
    </div>
  )
}

function NodeView({ node }: { node: LayoutNode }) {
  if (node.type === 'pane') return <PaneFrame pane={node} />
  return <SplitView split={node} />
}

function SplitView({ split }: { split: SplitNode }) {
  const setPaneRatio = useApp((s) => s.setPaneRatio)
  const boxRef = useRef<HTMLDivElement>(null)
  const isRow = split.dir === 'row'

  const onDividerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      const box = boxRef.current
      if (!box) return
      const target = e.currentTarget as HTMLElement
      target.setPointerCapture(e.pointerId)
      const rect = box.getBoundingClientRect()
      const onMove = (ev: PointerEvent) => {
        const frac = isRow
          ? (ev.clientX - rect.left) / rect.width
          : (ev.clientY - rect.top) / rect.height
        setPaneRatio(split.id, frac)
      }
      const onUp = () => {
        target.removeEventListener('pointermove', onMove)
        target.removeEventListener('pointerup', onUp)
      }
      target.addEventListener('pointermove', onMove)
      target.addEventListener('pointerup', onUp)
    },
    [isRow, setPaneRatio, split.id],
  )

  return (
    <div
      ref={boxRef}
      className={`flex h-full w-full min-h-0 min-w-0 ${isRow ? 'flex-row' : 'flex-col'}`}
    >
      <div
        className="min-h-0 min-w-0 shrink-0 grow-0"
        style={{ flexBasis: `${split.ratio * 100}%` }}
      >
        <NodeView node={split.a} />
      </div>
      <div
        onPointerDown={onDividerDown}
        className={`shrink-0 grow-0 bg-ink-3 hover:bg-ink-4 ${
          isRow ? 'w-px cursor-col-resize px-[1.5px]' : 'h-px cursor-row-resize py-[1.5px]'
        } box-content bg-clip-content`}
      />
      <div className="min-h-0 min-w-0 flex-1">
        <NodeView node={split.b} />
      </div>
    </div>
  )
}

function PaneFrame({ pane }: { pane: PaneNode }) {
  const focusedPaneId = useApp((s) => s.focusedPaneId)
  const { focusPane, splitPaneAction, closePaneAction, setPaneKindAction, layout } = useApp()
  const focused = focusedPaneId === pane.id
  const isOnlyPane = layout.type === 'pane'

  return (
    <section
      onMouseDownCapture={() => focusPane(pane.id)}
      className={`flex h-full w-full min-h-0 min-w-0 flex-col border ${
        focused ? 'border-ink-5' : 'border-ink-3'
      }`}
    >
      <header className="flex h-6 shrink-0 items-center gap-1 border-b border-ink-3 bg-ink-1 px-1 select-none">
        <select
          value={pane.kind}
          onChange={(e) => setPaneKindAction(pane.id, e.target.value as PaneKind)}
          className="border-0 bg-ink-1 text-ink-6 outline-none hover:bg-ink-2"
        >
          {PANE_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label} ▾
            </option>
          ))}
        </select>
        <span className="flex-1" />
        <button
          title="split side by side"
          onClick={() => splitPaneAction(pane.id, 'row')}
          className="px-1 text-ink-4 hover:bg-ink-2 hover:text-ink-6"
        >
          ││
        </button>
        <button
          title="split stacked"
          onClick={() => splitPaneAction(pane.id, 'col')}
          className="px-1 text-ink-4 hover:bg-ink-2 hover:text-ink-6"
        >
          ══
        </button>
        <button
          title="close pane"
          onClick={() => closePaneAction(pane.id)}
          disabled={isOnlyPane}
          className="px-1 text-ink-4 hover:bg-ink-2 hover:text-ink-6 disabled:opacity-30"
        >
          ×
        </button>
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <PaneBody pane={pane} />
      </div>
    </section>
  )
}

function PaneBody({ pane }: { pane: PaneNode }) {
  switch (pane.kind) {
    case 'editor':
      return <EditorPane paneId={pane.id} />
    case 'organizer':
      return <OrganizerPane paneId={pane.id} />
    case 'rsvp':
      return <RsvpPane paneId={pane.id} />
  }
}
