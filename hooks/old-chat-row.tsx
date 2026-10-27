import type { ClientModule } from 'claude-code'

// One older chat as a compact row: a thin strip in its project's color, the
// chat name, and the date it was last active. A click opens the chat.
type Row = {
  hostId: string
  color: string
  title: string
  date: string
}

type Pointer = { isOver: boolean }

const OldChatRow: ClientModule<Row, Pointer> = (row, surface) => {
  const { Box, Text } = surface.elements
  const isOver = surface.state?.isOver ?? false

  surface.onPointer(event => {
    if (event.type === 'enter' || (event.type === 'move' && !isOver)) {
      surface.setState({ isOver: true })
    } else if (event.type === 'leave') {
      surface.setState({ isOver: false })
    } else if (event.type === 'up' && event.button === 'left' && row.hostId) {
      surface.post({ open: row.hostId })
    }
  })

  return (
    <Box flexDirection="row" backgroundColor={isOver ? row.color + '33' : undefined}>
      <Box width={1} flexShrink={0} backgroundColor={row.color + '88'} />
      <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden" paddingLeft={1}>
        <Text underline={isOver} wrap="truncate-end">
          {row.title}
        </Text>
      </Box>
      <Box flexShrink={0} paddingLeft={1}>
        <Text dimColor size="footnote">
          {row.date}
        </Text>
      </Box>
    </Box>
  )
}

export default OldChatRow
