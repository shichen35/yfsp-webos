/*
 * App-wide confirm dialog. A centered opaque card on its own "confirm" focus
 * layer — no translucent backdrop (the focus layer already blocks input to
 * whatever is behind it). Buttons are full-width and stacked, addressed by row;
 * focus defaults to Cancel, and the back key acts as Cancel.
 *
 * `cancelLabel={null}` makes it a single-button notice: the confirm button is
 * the only row, holds focus, and Back acts as it. `confirmKind` 'default' drops
 * the destructive accent for a non-destructive action (去登录, 知道了).
 */
import { useFocusable, useFocusFrame } from '../hooks/useFocus.js'

const LAYER = 'confirm'

function DialogButton({ row, label, kind, onSelect }) {
  const { props } = useFocusable({ layer: LAYER, group: 'content', row, col: 0, onSelect })
  return (
    <button
      className={`focusable tile-btn w-full bg-elev-2 ${kind === 'danger' ? 'text-uhd' : 'text-fg'}`}
      {...props}
    >
      {label}
    </button>
  )
}

export default function ConfirmDialog({
  title,
  description,
  confirmLabel = '确定',
  cancelLabel = '取消',
  confirmKind = 'danger',
  onConfirm,
  onCancel,
}) {
  const single = cancelLabel == null

  useFocusFrame({
    layer: LAYER,
    focus: `${LAYER}/content-0-0`, // default focus = Cancel (row 0), or the only button
    onBack: () => (single ? onConfirm() : onCancel()),
  })

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center">
      {/* Centered opaque alert card, no scrim. */}
      <div className="w-[640px] rounded-surface border border-elev-2 bg-elev px-10 pt-11 pb-8">
        <div className="mb-4 text-title text-fg">{title}</div>
        {description && <div className="mb-8 text-body leading-normal text-fg-2">{description}</div>}
        <div className="flex flex-col gap-3.5">
          {single ? (
            <DialogButton row={0} label={confirmLabel} kind={confirmKind} onSelect={onConfirm} />
          ) : (
            <>
              <DialogButton row={0} label={cancelLabel} onSelect={onCancel} />
              <DialogButton row={1} label={confirmLabel} kind={confirmKind} onSelect={onConfirm} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
