export const CHAT_BOTTOM_THRESHOLD = 80

export function isNearBottom({ scrollTop, scrollHeight, clientHeight }, threshold = CHAT_BOTTOM_THRESHOLD) {
  return scrollHeight - scrollTop - clientHeight <= threshold
}

export function shouldFollowNewMessages({ wasAtBottom, ownMessage = false }) {
  return Boolean(ownMessage || wasAtBottom)
}
