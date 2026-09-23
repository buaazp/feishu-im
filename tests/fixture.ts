/** Normalized messages for driver unit tests. */
export function incoming(id: string, content: string, sender = 'ou_owner') {
  return {
    type: 'im.message.receive_v1', message_id: `om_${id}`, chat_id: 'oc_private', sender_id: sender,
    sender_type: 'user', chat_type: 'p2p', message_type: 'text', content,
  }
}
