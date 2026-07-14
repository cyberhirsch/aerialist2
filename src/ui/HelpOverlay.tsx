import { useApp } from './store'

const ROWS: [string, string][] = [
  ['click', 'edit (auto: cell / line / paragraph)'],
  ['right-click', 'context menu (pages: organizer thumbs)'],
  ['enter / esc', 'apply / cancel edit'],
  ['ctrl+z / ctrl+y', 'undo / redo'],
  ['ctrl+o', 'open pdf'],
  ['ctrl+e', 'export pdf'],
  ['a w l p', 'mode: auto word line para'],
  ['+ - 0', 'zoom (editor) / speed (rsvp)'],
  ['pgup pgdn ← →', 'pages (editor) / seek (rsvp)'],
  ['space', 'play / pause rsvp (when focused)'],
  ['drag pdf → organizer', 'merge at drop position'],
  ['drag pdf → elsewhere', 'open as new document'],
  ['?', 'toggle this help'],
]

export function HelpOverlay() {
  const { helpOpen, toggleHelp } = useApp()
  if (!helpOpen) return null
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink-0/70"
      onClick={toggleHelp}
    >
      <div
        className="border border-ink-3 bg-ink-1 px-6 py-4 shadow-[6px_6px_0_0_#000]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 text-ink-7">── keyboard shortcuts ──</div>
        <table className="text-left">
          <tbody>
            {ROWS.map(([keys, desc]) => (
              <tr key={keys}>
                <td className="pr-6 text-ink-7">{keys}</td>
                <td className="text-ink-5">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 text-right text-ink-4">esc to close</div>
      </div>
    </div>
  )
}
