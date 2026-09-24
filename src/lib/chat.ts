import { supabase } from './supabase';

/**
 * Conversation storage.
 *
 * History is persisted because a chatbot that forgets is one you re-explain
 * yourself to, and re-explaining is the friction this whole app exists to
 * remove. It also means "what did it tell me on Tuesday" is answerable, which
 * matters when the answer was about a deadline.
 */

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  proposed_action: Record<string, unknown> | null;
  action_taken: boolean;
  referenced_ids: string[] | null;
  /** A reason the question went unanswered, not an answer. Drawn as a note. */
  failed: boolean;
  created_at: string;
}

/** Oldest first, so the transcript reads top to bottom. */
export async function loadChat(limit = 50): Promise<ChatMessage[]> {
  const { data } = await supabase
    .from('chat_messages')
    .select('id, role, content, proposed_action, action_taken, referenced_ids, failed, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  return ((data ?? []) as ChatMessage[]).reverse();
}

export async function saveMessage(
  userId: string,
  message: {
    role: 'user' | 'assistant';
    content: string;
    proposed_action?: Record<string, unknown> | null;
    referenced_ids?: string[] | null;
    failed?: boolean;
  },
): Promise<ChatMessage | null> {
  const { data } = await supabase
    .from('chat_messages')
    .insert({
      user_id: userId,
      role: message.role,
      content: message.content,
      proposed_action: message.proposed_action ?? null,
      referenced_ids: message.referenced_ids ?? null,
      failed: message.failed ?? false,
    })
    .select('id, role, content, proposed_action, action_taken, referenced_ids, failed, created_at')
    .single();

  return (data as ChatMessage) ?? null;
}

/**
 * Records that a proposal was carried out.
 *
 * The proposal itself stays on the message either way. A declined suggestion
 * is part of the conversation, and deleting it would make the transcript read
 * as though the model never offered.
 */
export async function markActionTaken(messageId: string): Promise<void> {
  await supabase.from('chat_messages').update({ action_taken: true }).eq('id', messageId);
}

export async function clearChat(): Promise<void> {
  await supabase.from('chat_messages').delete().neq('id', '00000000-0000-0000-0000-000000000000');
}
