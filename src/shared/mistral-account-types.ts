export type MistralAccountSummary = {
  id: string
  /** Display label; Mistral's whoami returns no email, so this is the customer id's short form. */
  customer: string
  /** whoami `plan_name`; null when it was never readable. */
  planName: string | null
  /** whoami `customer_id`. */
  organizationId: string | null
  /** First 32 hex chars of sha256 of the saved API key; the raw key never leaves the main process. */
  keyFingerprint: string
  createdAt: number
  updatedAt: number
}

export type MistralAccountState = {
  accounts: MistralAccountSummary[]
  /** The account whose API key mistral-vibe is serving right now, matched by key fingerprint. */
  currentAccount: {
    customer: string
    planName: string | null
    organizationId: string | null
    keyFingerprint: string
    identityKnown: boolean
  } | null
}
