import { describe, expect, it } from 'vitest'
import { createBitableProvider } from '../../src/providers/bitable'

describe('Bitable provider adapter', () => {
  it('exposes base/table/view/field/record CRUD through a host request', async () => {
    const calls = []
    const provider = createBitableProvider({
      request: async (operation, input) => {
        calls.push({ operation, input })
        return { operation, input, version: 'v1' }
      },
    })

    await provider.createBase({}, { name: 'demo', idempotencyKey: 'base-1' })
    await provider.createTable({}, { baseToken: 'app-1', name: 'Table', idempotencyKey: 'table-1' })
    await provider.createView({}, { baseToken: 'app-1', tableId: 'tbl-1', name: 'Grid', viewType: 'grid', idempotencyKey: 'view-1' })
    await provider.createField({}, { baseToken: 'app-1', tableId: 'tbl-1', name: 'Status', type: 1, idempotencyKey: 'field-1' })
    await provider.createRecord({}, { baseToken: 'app-1', tableId: 'tbl-1', fields: { Status: 'todo' }, idempotencyKey: 'record-1' })

    expect(calls.map(call => call.operation)).toEqual(['createBase', 'createTable', 'createView', 'createField', 'createRecord'])
    expect(calls[4].input).toMatchObject({ baseToken: 'app-1', tableId: 'tbl-1', fields: { Status: 'todo' }, idempotencyKey: 'record-1' })
  })

  it('passes version and actor context on updates and reads', async () => {
    const calls = []
    const provider = createBitableProvider({ request: async (operation, input) => { calls.push({ operation, input }); return input } })
    await provider.updateRecord({ actorId: 'u1', tenantId: 't1' }, { baseToken: 'app-1', tableId: 'tbl-1', recordId: 'rec-1', fields: { Status: 'done' }, version: 'v2' })
    await provider.listRecords({ actorId: 'u1', tenantId: 't1' }, { baseToken: 'app-1', tableId: 'tbl-1', viewId: 'vew-1', cursor: 'c1', limit: 20 })
    expect(calls[0]).toMatchObject({ operation: 'updateRecord', input: { version: 'v2', actorId: 'u1', tenantId: 't1' } })
    expect(calls[1]).toMatchObject({ operation: 'listRecords', input: { cursor: 'c1', limit: 20, actorId: 'u1', tenantId: 't1' } })
    expect(provider.capabilities.operations).toEqual(expect.arrayContaining(['getBaseAcl', 'requestBaseAcl', 'approveBaseAcl', 'rejectBaseAcl', 'getVersion']))
  })
})
