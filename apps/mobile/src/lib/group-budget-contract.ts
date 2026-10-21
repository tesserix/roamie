// Generated from Rust group budget models; do not edit manually.
export type ShareInput = { participantId: string, value: number, };
export type Split = { participantId: string, amountMinor: number, };
export type Participant = { id: string, name: string, email: string, whatsapp: string, isSelf: boolean, hasAccount: boolean, invitedUntil: string | null, };
export type GroupExpense = { id: string, payerId: string, description: string, currency: string, amountMinor: number, occurredOn: string, method: 'equal' | 'percentage' | 'exact', shares: ShareInput[], splits: Split[], homeCurrency: string, homeMinor: number, rateAsOf: string, canEdit: boolean, };
export type Settlement = { id: string, fromId: string, toId: string, currency: string, amountMinor: number, occurredOn: string, };
export type Group = { id: string, title: string, currency: string, revision: number, isOwner: boolean, participants: Participant[], expenses: GroupExpense[], settlements: Settlement[], emails: EmailNotice[], };
export type EmailNotice = { id: string, fromId: string, toId: string, currency: string, amountMinor: number, status: 'queued' | 'accepted' | 'failed' | 'cancelled', requestedAt: string, };
export type Debt = { fromId: string, toId: string, currency: string, amountMinor: number, oldestOn: string, overdue: boolean, };
export type GroupChange = { "action": "participant", id: string | null, name: string, email: string, whatsapp: string, } | { "action": "expense", id: string | null, payerId: string, description: string, currency: string, amountMinor: number, occurredOn: string, method: 'equal' | 'percentage' | 'exact', shares: ShareInput[], homeCurrency: string, } | { "action": "voidExpense", id: string, } | { "action": "settlement", fromId: string, toId: string, currency: string, amountMinor: number, occurredOn: string, } | { "action": "voidSettlement", id: string, } | { "action": "invite", participantId: string, } | { "action": "emailReminder", fromId: string, toId: string, currency: string, } | { "action": "revokeAccess", participantId: string, } | { "action": "revokeInvite", participantId: string, };
export type GroupCommand = { requestId: string, expectedRevision: number, change: GroupChange, };
export type CreateGroup = { requestId: string, title: string, currency: string, displayName: string, };
