import { useCallback, useRef, useState } from 'react'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { EditorPane } from './EditorPane'
import { Icon } from './icons'
import { OrganizerPane } from './OrganizerPane'
import { RsvpPane } from './RsvpPane'
import { useApp, type EditMode } from './store'
import { PANE_KINDS, type LayoutNode, type PaneKind, type PaneNode, type SplitNode } from './workspace'

const EDIT_MODES = ['auto', 'word', 'line', 'block'] as const
const EDIT_MODE_LABEL: Record<EditMode, string> = { auto: 'auto', word: 'word', line: 'line', block: 'para' }
const EDIT_MODE_TITLE: Record<EditMode, string> = {
  auto: 'auto: paragraphs reflow, tables edit per cell, other text per line',
  word: 'edit granularity: word',
  line: 'edit granularity: line',
  block: 'edit granularity: paragraph',
}

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
  const model = useApp((s) => s.model)
  const busy = useApp((s) => s.busy)
  const commentPlacementActive = useApp((s) => s.commentPlacementActive)
  const redactPlacementActive = useApp((s) => s.redactPlacementActive)
  const view = useApp((s) => s.paneViews[pane.id])
  const {
    focusPane, splitPaneAction, closePaneAction, setPaneKindAction, layout,
    setEditMode, openSignatureDialog, openFillDialog, startPlacingComment,
    startRedaction, cancelRedaction, setFitMode, setPage, setZoom,
  } = useApp()
  const focused = focusedPaneId === pane.id
  const isOnlyPane = layout.type === 'pane'
  const { pageIndex, zoom, fitMode, editMode } = view ?? { pageIndex: 0, zoom: 1, fitMode: null, editMode: 'auto' }

  const modeMenuBtn = useRef<HTMLButtonElement>(null)
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [editToolOpen, setEditToolOpen] = useState(false)
  const [fillToolOpen, setFillToolOpen] = useState(false)
  const modeMenuItems: MenuItem[] = EDIT_MODES.map((m) => ({
    label: `${m === editMode ? '› ' : '  '}${EDIT_MODE_LABEL[m]}`,
    action: () => setEditMode(pane.id, m),
  }))
  const modeMenuPos = modeMenuBtn.current?.getBoundingClientRect()
  const navDisabled = !model

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
              {k.label}
            </option>
          ))}
        </select>
        {pane.kind === 'editor' && (
          <>
            <span className="mx-1 text-ink-3">│</span>

            {/* edit: granularity picker only shows while this tool is enabled */}
            <button
              onClick={() => setEditToolOpen((v) => !v)}
              disabled={!model}
              title="edit"
              className={
                'px-1 disabled:opacity-30 ' +
                (editToolOpen ? 'bg-ink-2 text-ink-6' : 'text-ink-4 hover:bg-ink-2 hover:text-ink-6')
              }
            >
              <Icon name="edit" size={14} />
            </button>
            {editToolOpen && (
              <>
                <button
                  ref={modeMenuBtn}
                  onClick={() => setModeMenuOpen((v) => !v)}
                  disabled={!model}
                  title={EDIT_MODE_TITLE[editMode]}
                  className={
                    'px-1.5 text-xs disabled:opacity-30 ' +
                    (modeMenuOpen ? 'bg-ink-2 text-ink-6' : 'text-ink-4 hover:bg-ink-2 hover:text-ink-6')
                  }
                >
                  {EDIT_MODE_LABEL[editMode]} ▾
                </button>
                {modeMenuOpen && modeMenuPos && (
                  <ContextMenu
                    x={modeMenuPos.left}
                    y={modeMenuPos.bottom + 2}
                    items={modeMenuItems}
                    onClose={() => setModeMenuOpen(false)}
                  />
                )}
              </>
            )}

            {/* fill: sign is a sub-option that only shows while this tool is enabled */}
            <button
              onClick={() => {
                const next = !fillToolOpen
                setFillToolOpen(next)
                if (next) openFillDialog()
              }}
              disabled={!model || busy}
              title="fill — place text anywhere on the page"
              className={
                'px-1 disabled:opacity-30 ' +
                (fillToolOpen ? 'bg-ink-2 text-ink-6' : 'text-ink-4 hover:bg-ink-2 hover:text-ink-6')
              }
            >
              <Icon name="border-color" size={14} />
            </button>
            {fillToolOpen && (
              <button
                onClick={openSignatureDialog}
                disabled={!model || busy}
                title="sign"
                className="px-1 text-ink-4 hover:bg-ink-2 hover:text-ink-6 disabled:opacity-30"
              >
                <Icon name="sign" size={14} />
              </button>
            )}

            <button
              onClick={startPlacingComment}
              disabled={!model || busy}
              title="comment — click a spot on the page to add a note"
              className={
                'px-1 hover:bg-ink-2 hover:text-ink-6 disabled:opacity-30 ' +
                (commentPlacementActive ? 'bg-ink-2 text-ink-6' : 'text-ink-4')
              }
            >
              <Icon name="comment" size={14} />
            </button>

            <button
              onClick={() => (redactPlacementActive ? cancelRedaction() : startRedaction())}
              disabled={!model || busy}
              title="redact — drag a box; text under it is removed from the file and the area is covered"
              className={
                'px-1 hover:bg-ink-2 hover:text-ink-6 disabled:opacity-30 ' +
                (redactPlacementActive ? 'bg-ink-2 text-ink-6' : 'text-ink-4')
              }
            >
              <Icon name="visibility-off" size={14} />
            </button>
          </>
        )}
        <span className="flex-1" />
        {pane.kind === 'editor' && (
          <>
            <span className="flex items-center gap-1 text-ink-5">
              <button
                onClick={() => setPage(pane.id, pageIndex - 1)}
                disabled={navDisabled || pageIndex === 0}
                title="previous page"
                className="px-1 text-ink-5 hover:bg-ink-2 hover:text-ink-6 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <Icon name="page-prev" size={14} />
              </button>
              <span className="tabular-nums">
                {model ? `${pageIndex + 1}/${model.pages.length}` : '–/–'}
              </span>
              <button
                onClick={() => setPage(pane.id, pageIndex + 1)}
                disabled={navDisabled || pageIndex >= (model?.pages.length ?? 1) - 1}
                title="next page"
                className="px-1 text-ink-5 hover:bg-ink-2 hover:text-ink-6 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <Icon name="page-next" size={14} />
              </button>
            </span>
            <span className="mx-1 text-ink-3">│</span>
            <button
              onClick={() => setFitMode(pane.id, fitMode === 'page' ? null : 'page')}
              disabled={!model}
              title="fit page — whole page visible"
              className={
                'px-1 disabled:opacity-30 ' +
                (fitMode === 'page' ? 'bg-ink-2 text-ink-6' : 'text-ink-4 hover:bg-ink-2 hover:text-ink-6')
              }
            >
              <Icon name="fit-page" size={14} />
            </button>
            <button
              onClick={() => setFitMode(pane.id, fitMode === 'width' ? null : 'width')}
              disabled={!model}
              title="fit width — horizontal fit"
              className={
                'px-1 disabled:opacity-30 ' +
                (fitMode === 'width' ? 'bg-ink-2 text-ink-6' : 'text-ink-4 hover:bg-ink-2 hover:text-ink-6')
              }
            >
              <Icon name="fit-width" size={14} />
            </button>
            <span className="mx-1 text-ink-3">│</span>
            <span className="flex items-center gap-1 text-ink-5">
              <button
                onClick={() => setZoom(pane.id, zoom - 0.25)}
                disabled={navDisabled}
                title="zoom out"
                className="px-1 text-ink-5 hover:bg-ink-2 hover:text-ink-6 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <Icon name="zoom-out" size={14} />
              </button>
              <span className="w-11 text-center tabular-nums">
                {model ? `${Math.round(zoom * 100)}%` : '–'}
              </span>
              <button
                onClick={() => setZoom(pane.id, zoom + 0.25)}
                disabled={navDisabled}
                title="zoom in"
                className="px-1 text-ink-5 hover:bg-ink-2 hover:text-ink-6 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <Icon name="zoom-in" size={14} />
              </button>
            </span>
            <span className="mx-1 text-ink-3">│</span>
          </>
        )}
        <button
          title="split side by side"
          onClick={() => splitPaneAction(pane.id, 'row')}
          className="px-1 text-ink-4 hover:bg-ink-2 hover:text-ink-6"
        >
          <Icon name="split-row" size={14} />
        </button>
        <button
          title="split stacked"
          onClick={() => splitPaneAction(pane.id, 'col')}
          className="px-1 text-ink-4 hover:bg-ink-2 hover:text-ink-6"
        >
          <Icon name="split-col" size={14} />
        </button>
        <button
          title="close pane"
          onClick={() => closePaneAction(pane.id)}
          disabled={isOnlyPane}
          className="px-1 text-ink-4 hover:bg-ink-2 hover:text-ink-6 disabled:opacity-30"
        >
          <Icon name="close" size={14} />
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
    case 'pages':
      return <OrganizerPane paneId={pane.id} />
    case 'rsvp':
      return <RsvpPane paneId={pane.id} />
  }
}
