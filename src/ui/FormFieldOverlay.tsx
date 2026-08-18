import { useEffect, useState } from 'react'
import type { FormField } from '../model/document'
import { useApp } from './store'

// Text/textarea/dropdown fields sit on document content, not app chrome — a
// dark box here reads as a redaction bar on a white page. Inverted from the
// app's own greyscale tokens (ink-7/ink-0) rather than introducing a new
// color, so a filled-in field looks like paper, not app UI.
const FIELD_CLASS =
  'border border-ink-3 bg-ink-7 px-0.5 text-ink-0 outline-none focus:border-ink-5'

/** One AcroForm field widget, rendered as a real interactive input. */
export function FormFieldOverlay({ field, css, fontSize, pageIndex }: {
  field: FormField
  css: { left: number; top: number; width: number; height: number }
  fontSize: number
  pageIndex: number
}) {
  const setFormFieldAction = useApp((s) => s.setFormFieldAction)
  const busy = useApp((s) => s.busy)
  const [value, setValue] = useState(field.value)

  // keep local state in sync when the field changes from outside
  // (undo/redo, or another widget of the same radio group)
  useEffect(() => setValue(field.value), [field.value])

  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  const disabled = field.readOnly || busy

  const style: React.CSSProperties = {
    position: 'absolute',
    left: css.left,
    top: css.top,
    width: css.width,
    height: css.height,
    fontSize,
  }

  // The app forces a dark UA color-scheme globally (index.html), which an
  // unstyled native checkbox/radio inherits — against a white PDF page that
  // renders as a solid dark blob with no visible box or checkmark. These sit
  // on document content, not app chrome, so they render with the light
  // scheme regardless of the app's own theme.
  const controlStyle: React.CSSProperties = { ...style, colorScheme: 'light' }

  if (field.kind === 'checkbox') {
    return (
      <input
        type="checkbox"
        checked={!!field.checked}
        disabled={disabled}
        onClick={stop}
        onContextMenu={stop}
        onChange={(e) => void setFormFieldAction(pageIndex, field.name, e.target.checked)}
        style={controlStyle}
        title={field.name}
      />
    )
  }

  if (field.kind === 'radio') {
    return (
      <input
        type="radio"
        name={field.name}
        checked={field.value === field.optionValue}
        disabled={disabled}
        onClick={stop}
        onContextMenu={stop}
        onChange={() => void setFormFieldAction(pageIndex, field.name, field.optionValue ?? '')}
        style={controlStyle}
        title={field.name}
      />
    )
  }

  if (field.kind === 'dropdown') {
    return (
      <select
        value={value}
        disabled={disabled}
        onClick={stop}
        onContextMenu={stop}
        onChange={(e) => {
          setValue(e.target.value)
          void setFormFieldAction(pageIndex, field.name, e.target.value)
        }}
        className={FIELD_CLASS}
        style={style}
        title={field.name}
      >
        {value && !field.options?.includes(value) && <option value={value}>{value}</option>}
        {field.options?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  }

  const commit = (el: HTMLInputElement | HTMLTextAreaElement) => {
    if (value !== field.value) void setFormFieldAction(pageIndex, field.name, value)
    else el.blur()
  }

  const shared = {
    value,
    disabled,
    onClick: stop,
    onContextMenu: stop,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue(e.target.value),
    onBlur: () => {
      if (value !== field.value) void setFormFieldAction(pageIndex, field.name, value)
    },
    className: FIELD_CLASS,
    title: field.name,
  }

  if (field.multiline) {
    return (
      <textarea
        {...shared}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setValue(field.value)
            e.currentTarget.blur()
          }
        }}
        style={{ ...style, resize: 'none' }}
      />
    )
  }

  return (
    <input
      {...shared}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit(e.currentTarget)
        } else if (e.key === 'Escape') {
          setValue(field.value)
          e.currentTarget.blur()
        }
      }}
      style={style}
    />
  )
}
