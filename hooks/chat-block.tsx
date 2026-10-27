import type { ClientModule } from 'claude-code'

// One chat's card in the panel: a strip in its project's color, the chat name,
// where it left off, and a red action line only when Claude asked for something.
// A click anywhere on it asks the hooks module to open the chat.
type Card = {
  id: string
  hostId: string
  color: string
  title: string
  now: string
  isWorking: boolean
  action: string
  isPinned: boolean
}

type Pointer = { isOver: boolean }

const ChatBlock: ClientModule<Card, Pointer> = (card, surface) => {
  const { Box, Text } = surface.elements
  const isOver = surface.state?.isOver ?? false

  // Shade the card while the mouse is over it, so it reads as clickable.
  surface.onPointer(event => {
    if (event.type === 'enter' || (event.type === 'move' && !surface.state?.isOver)) {
      surface.setState({ isOver: true })
    } else if (event.type === 'leave') {
      surface.setState({ isOver: false })
    } else if (event.type === 'up' && event.button === 'left') {
      // The top row ends in "✎ ☆ ✕", 3 columns each: hide, pin, then rename.
      // Anywhere else opens the chat.
      const fromEnd = surface.columns - event.x
      if (event.y === 0 && fromEnd <= 3) surface.post({ hide: card.id })
      else if (event.y === 0 && fromEnd <= 6) surface.post({ pin: card.hostId })
      else if (event.y === 0 && fromEnd <= 9) surface.post({ rename: card.hostId })
      else if (card.hostId) surface.post({ open: card.hostId })
    }
  })

  return (
    <Box flexDirection="row" backgroundColor={isOver ? card.color + '33' : undefined}>
      <Box width={1} flexShrink={0} backgroundColor={card.color} />
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} paddingLeft={1}>
        <Box flexDirection="row">
          <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
            <Text weight="bold" size="footnote" underline={isOver} wrap="truncate-end">
              {card.title}
            </Text>
          </Box>
          <Box width={3} flexShrink={0} justifyContent="center">
            <Text dimColor={!isOver}>✎</Text>
          </Box>
          <Box width={3} flexShrink={0} justifyContent="center">
            <Text dimColor={!isOver && !card.isPinned} color={card.isPinned ? '#BA7517' : undefined}>
              {card.isPinned ? '★' : '☆'}
            </Text>
          </Box>
          <Box width={3} flexShrink={0} justifyContent="flex-end">
            <Text dimColor={!isOver}>✕</Text>
          </Box>
        </Box>
        {card.now !== '' &&
          (card.isWorking ? (
            <Text italic dimColor>
              Working on: {card.now}
            </Text>
          ) : (
            <Text>{card.now}</Text>
          ))}
        {card.action !== '' && (
          <Text weight="semibold" color="#A32D2D">
            → {card.action}
          </Text>
        )}
      </Box>
    </Box>
  )
}

export default ChatBlock
