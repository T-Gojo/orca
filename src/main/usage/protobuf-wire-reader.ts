/** A protobuf field as read off the wire, without a schema. */
export type ProtoField =
  | { field: number; kind: 'varint'; value: number }
  | { field: number; kind: 'bytes'; value: Uint8Array }
  | { field: number; kind: 'fixed' }

function readVarint(bytes: Uint8Array, start: number): { value: number; next: number } | null {
  let value = 0
  let scale = 1
  for (let index = start; index < bytes.length && index < start + 10; index += 1) {
    const byte = bytes[index]
    value += (byte & 0x7f) * scale
    scale *= 128
    if (byte < 0x80) {
      return { value, next: index + 1 }
    }
  }
  return null
}

/** Top-level fields of one message; nested messages stay as bytes until a caller descends. */
export function readProtoFields(bytes: Uint8Array): ProtoField[] | null {
  const fields: ProtoField[] = []
  let index = 0
  while (index < bytes.length) {
    const key = readVarint(bytes, index)
    if (!key) {
      return null
    }
    const field = Math.floor(key.value / 8)
    const wireType = key.value % 8
    index = key.next
    if (field === 0) {
      return null
    }
    if (wireType === 0) {
      const value = readVarint(bytes, index)
      if (!value) {
        return null
      }
      fields.push({ field, kind: 'varint', value: value.value })
      index = value.next
    } else if (wireType === 2) {
      const length = readVarint(bytes, index)
      if (!length || length.next + length.value > bytes.length) {
        return null
      }
      fields.push({
        field,
        kind: 'bytes',
        value: bytes.subarray(length.next, length.next + length.value)
      })
      index = length.next + length.value
    } else if (wireType === 1 || wireType === 5) {
      index += wireType === 1 ? 8 : 4
      fields.push({ field, kind: 'fixed' })
    } else {
      return null
    }
  }
  return index === bytes.length ? fields : null
}

export function protoVarint(fields: readonly ProtoField[], field: number): number | null {
  const found = fields.find((entry) => entry.field === field && entry.kind === 'varint')
  return found?.kind === 'varint' ? found.value : null
}

export function protoMessage(fields: readonly ProtoField[], field: number): ProtoField[] | null {
  const found = fields.find((entry) => entry.field === field && entry.kind === 'bytes')
  return found?.kind === 'bytes' ? readProtoFields(found.value) : null
}

export function protoString(fields: readonly ProtoField[], field: number): string | null {
  const found = fields.find((entry) => entry.field === field && entry.kind === 'bytes')
  return found?.kind === 'bytes' ? new TextDecoder().decode(found.value) : null
}
