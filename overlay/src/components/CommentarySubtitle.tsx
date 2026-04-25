import type { CommentaryState } from '../hooks/useCommentary'

interface Props {
  commentary: CommentaryState
}

export function CommentarySubtitle({ commentary }: Props) {
  const visible = commentary.text.length > 0
  return (
    <div className={`commentary-subtitle${visible ? ' visible' : ''}`}>
      <div className="commentary-subtitle-bar">
        <span className="commentary-subtitle-tag">SHADOW</span>
        <span
          key={commentary.id}
          className={`commentary-subtitle-text${commentary.active ? ' active' : ''}`}
        >
          {commentary.text}
          {commentary.active && <span className="commentary-cursor">▍</span>}
        </span>
      </div>
    </div>
  )
}
