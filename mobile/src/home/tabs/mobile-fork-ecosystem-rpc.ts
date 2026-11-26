import * as z from 'zod'
import {
  EcosystemAskResultSchema,
  EcosystemLearnResultSchema,
  EcosystemStatusSnapshotSchema
} from '../../../../src/shared/ecosystem/ecosystem-types'
import { defineRpcOperation } from '../../transport/rpc/rpc-operation'
import { rpcResultVariant } from '../../transport/rpc/rpc-operation-result-reader'

// Fork: paired-desktop RPC operations for Mobile Unified Ecosystem & Ask-Mac controls (FORK.md §16).

export const ecosystemStatusReadOp = defineRpcOperation({
  name: 'fork.mobile-ecosystem-status-read',
  method: 'delegation.ecosystemStatus',
  acceptance: 'object-result-or-null',
  barrier: 'on-settle',
  read: rpcResultVariant('ecosystem-status', EcosystemStatusSnapshotSchema)
})

const EcosystemControlReplySchema = z.object({
  ok: z.boolean(),
  detail: z.string(),
  status: EcosystemStatusSnapshotSchema
})

export const ecosystemControlOp = defineRpcOperation({
  name: 'fork.mobile-ecosystem-control',
  method: 'delegation.ecosystemControl',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read: rpcResultVariant('ecosystem-control', EcosystemControlReplySchema)
})

export const ecosystemAskOp = defineRpcOperation({
  name: 'fork.mobile-ecosystem-ask',
  method: 'delegation.ecosystemAsk',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read: rpcResultVariant('ecosystem-ask', EcosystemAskResultSchema)
})

export const ecosystemLearnOp = defineRpcOperation({
  name: 'fork.mobile-ecosystem-learn',
  method: 'delegation.ecosystemLearn',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read: rpcResultVariant('ecosystem-learn', EcosystemLearnResultSchema)
})
