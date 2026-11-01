// Reason codes for a patient's dispute of a document (J7). Shared by the route (zod), the server module and the portal UI.
export const DISPUTE_REASONS = ['not_mine', 'details_wrong', 'duplicate', 'other'] as const
export type DisputeReason = (typeof DISPUTE_REASONS)[number]
