import type { ClientModule } from 'claude-code'

// A project's heading: its name in the project's color with ▾ or ▸, and ⇅ at
// the right end. A click on the name collapses or expands the project; ⇅ picks
// the project up to move it. While a project is picked up, a click on another
// heading puts it there, and a click on its own heading puts it back.
type Header = {
  project: string
  color: string
  isCollapsed: boolean
  // 'self' while this project is picked up, 'target' while another one is.
  moving: '' | 'self' | 'target'
}

type Pointer = { isOver: boolean }

// The panel's width last reported, shared by every header, so a width is posted once per change.
let reportedWidth = 0

const GroupHeader: ClientModule<Header, Pointer> = (header, surface) => {
  const { Box, Text } = surface.elements
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
      if (header.moving === 'self') surface.post({ cancelMove: true })
      else if (header.moving === 'target') surface.post({ placeGroup: header.project })
      else if (surface.columns - event.x <= 3) surface.post({ moveGroup: header.project })
      else surface.post({ toggle: header.project })
    }
  })

  const isSelf = header.moving === 'self'

  return (
    <Box flexDirection="row" backgroundColor={isSelf ? header.color + '33' : undefined}>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text weight="semibold" size="footnote" color={header.color} underline={isOver} wrap="truncate-end">
          {header.isCollapsed ? '▸ ' : '▾ '}
          {header.project}
          {isSelf ? '  (moving)' : ''}
        </Text>
      </Box>
      <Box width={3} flexShrink={0} justifyContent="flex-end">
        <Text dimColor={!isOver && !isSelf} color={isSelf ? header.color : undefined}>
          ⇅
        </Text>
      </Box>
    </Box>
  )
}

export default GroupHeader
