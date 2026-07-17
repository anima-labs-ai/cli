/**
 * Shared human-format rendering for a draft resource. The draft shape is
 * typed by the contract (EmailDraftOutput) — commands pass the typed
 * result straight through.
 */
interface DraftLike {
  id: string;
  agentId: string;
  fromIdentityId: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string | null;
  body: string | null;
  bodyHtml: string | null;
  inReplyTo: string | null;
  references: string[];
  createdAt: string;
  updatedAt: string;
}

export function formatDraftDetails(draft: DraftLike): Array<[string, string]> {
  return [
    ['ID', draft.id],
    ['Agent ID', draft.agentId],
    ['From Identity', draft.fromIdentityId ?? '- (agent primary at send time)'],
    ['To', draft.to.length > 0 ? draft.to.join(', ') : '-'],
    ['CC', draft.cc.length > 0 ? draft.cc.join(', ') : '-'],
    ['BCC', draft.bcc.length > 0 ? draft.bcc.join(', ') : '-'],
    ['Subject', draft.subject ?? '-'],
    ['Body', draft.body ?? '-'],
    ['HTML Body', draft.bodyHtml ? '(set)' : '-'],
    ['In Reply To', draft.inReplyTo ?? '-'],
    ['References', draft.references.length > 0 ? draft.references.join(', ') : '-'],
    ['Created At', draft.createdAt],
    ['Updated At', draft.updatedAt],
  ];
}
