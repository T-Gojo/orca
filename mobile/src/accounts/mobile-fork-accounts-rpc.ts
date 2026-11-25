import * as z from 'zod'
import { defineRpcOperation } from '../transport/rpc/rpc-operation'
import { rpcResultVariant } from '../transport/rpc/rpc-operation-result-reader'

// Fork: typed RPC operations for mobile Kiro, Antigravity, and Mistral Vibe accounts (FORK.md §15).

const KiroAccountSummarySchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  userId: z.string().nullable(),
  authMethod: z.string()
})

const KiroAccountStateSchema = z.object({
  accounts: z.array(KiroAccountSummarySchema),
  activeAccountId: z.string().nullable(),
  selectedAccountId: z.string().nullable()
})

const AntigravityAccountSummarySchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  subject: z.string().nullable(),
  authMethod: z.string()
})

const AntigravityAccountStateSchema = z.object({
  accounts: z.array(AntigravityAccountSummarySchema),
  activeAccountId: z.string().nullable(),
  selectedAccountId: z.string().nullable()
})

const MistralAccountSummarySchema = z.object({
  id: z.string(),
  customer: z.string(),
  planName: z.string().nullable(),
  organizationId: z.string().nullable(),
  keyFingerprint: z.string()
})

const MistralAccountStateSchema = z.object({
  accounts: z.array(MistralAccountSummarySchema),
  currentAccount: z
    .object({
      customer: z.string(),
      planName: z.string().nullable(),
      keyFingerprint: z.string()
    })
    .nullable()
})

export type MobileKiroAccountState = z.infer<typeof KiroAccountStateSchema>
export type MobileAntigravityAccountState = z.infer<typeof AntigravityAccountStateSchema>
export type MobileMistralAccountState = z.infer<typeof MistralAccountStateSchema>

export const kiroListOp = defineRpcOperation({
  name: 'fork.mobile-kiro-accounts-list',
  method: 'accounts.kiroList',
  acceptance: 'object-result-or-null',
  barrier: 'on-settle',
  read: rpcResultVariant('kiro-list', KiroAccountStateSchema)
})

export const kiroSelectOp = defineRpcOperation({
  name: 'fork.mobile-kiro-accounts-select',
  method: 'accounts.kiroSelect',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read: rpcResultVariant('kiro-select', KiroAccountStateSchema)
})

export const antigravityListOp = defineRpcOperation({
  name: 'fork.mobile-antigravity-accounts-list',
  method: 'accounts.antigravityList',
  acceptance: 'object-result-or-null',
  barrier: 'on-settle',
  read: rpcResultVariant('antigravity-list', AntigravityAccountStateSchema)
})

export const antigravitySelectOp = defineRpcOperation({
  name: 'fork.mobile-antigravity-accounts-select',
  method: 'accounts.antigravitySelect',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read: rpcResultVariant('antigravity-select', AntigravityAccountStateSchema)
})

export const mistralListOp = defineRpcOperation({
  name: 'fork.mobile-mistral-accounts-list',
  method: 'accounts.mistralList',
  acceptance: 'object-result-or-null',
  barrier: 'on-settle',
  read: rpcResultVariant('mistral-list', MistralAccountStateSchema)
})
