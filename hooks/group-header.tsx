import type { ClientModule } from 'claude-code'

// A project's heading: its name in the project's color with ▾ or ▸.
// A click collapses or expands the project.
type Header = {
  project: string
  color: string
  isCollapsed: boolean
}

type Pointer = { isOver: boolean }

// The panel's width last reported, shared by every header, so a width is posted once per change.
let reportedWidth = 0

const GroupHeader: ClientModule<Header, Pointer> = (header, surface) => {
  const { Text } = surface.elements
  const isOver = surface.state?.isOver ?? false

  // The header spans the panel, so its width is the panel's. The hooks module keeps it
  // and asks for it when the panel opens in another chat.
  if (surface.columns > 0 && surface.columns !== reportedWidth) {
    reportedWidth = surface.columns
    surface.post({ width: surface.columns })
  }

  surface.onPointer(event => {
    if (event.type === 'enter' || (event.type === 'move' && !isOver)) {
      surface.setState({ isOver: true })
    } else if (event.type === 'leave') {
      surface.setState({ isOver: false })
    } else if (event.type === 'up' && event.button === 'left') {
      surface.post({ toggle: header.project })
    }
  })

  return (
    <Text weight="semibold" size="footnote" color={header.color} underline={isOver}>
      {header.isCollapsed ? '▸ ' : '▾ '}
      {header.project}
    </Text>
  )
}

export default GroupHeader
