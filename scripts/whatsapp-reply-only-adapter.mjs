import { REPLY_ONLY_MODES, sendTextGuard } from './whatsapp-reply-only-core.mjs'

export const createSendTextAdapter = ({ transport, mode, allowlisted, authenticated, eventAcquired, fromMe, rateAllowed }) => {
  if (typeof transport !== 'function') throw new TypeError('sendText transport is required')
  return async ({ to, text }) => {
    const decision = sendTextGuard({ mode, allowlisted, authenticated, eventAcquired, fromMe, rateAllowed, reply: text })
    if (!decision.allowed) return { sent: false, reason: decision.reason, reply: decision.reply }
    await transport({ to, text: decision.reply })
    return { sent: true, reply: decision.reply }
  }
}

export const createMockSendTextAdapter = ({ calls = [] } = {}) => {
  const sent = calls
  return {
    calls: sent,
    adapter: createSendTextAdapter({
      mode: REPLY_ONLY_MODES.REPLY_ONLY,
      allowlisted: true,
      authenticated: true,
      eventAcquired: true,
      fromMe: false,
      rateAllowed: true,
      transport: async (payload) => { sent.push(payload) },
    }),
  }
}
