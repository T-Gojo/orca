export type KiroAccountSummary = {
  id: string
  email: string | null
  /** Kiro's own user id, read from its usage service; null when it was never readable. */
  userId: string | null
  /** odic (Builder ID, IAM Identity Center), social (Google, GitHub) or external-idp. */
  authMethod: string
  createdAt: number
  updatedAt: number
}

export type KiroAccountState = {
  accounts: KiroAccountSummary[]
  /** The saved account kiro-cli is signed in to right now. */
  activeAccountId: string | null
  selectedAccountId: string | null
  currentAccount: {
    email: string | null
    userId: string | null
    authMethod: string
    identityKnown: boolean
  } | null
}
