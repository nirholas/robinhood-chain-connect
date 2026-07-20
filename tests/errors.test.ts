import { describe, expect, it } from 'vitest'
import { HoodConnectError, extractProviderCode, toHoodConnectError } from '../src/core/errors.js'
import { rpcError, wrappedRpcError } from './helpers/fake-provider.js'

describe('toHoodConnectError', () => {
  it.each([
    [4001, 'user-rejected'],
    [4100, 'unauthorized'],
    [4200, 'unsupported-method'],
    [-32601, 'unsupported-method'],
    [4900, 'wallet-disconnected'],
    [4901, 'wallet-disconnected'],
    [4902, 'chain-not-added'],
    [-32002, 'request-pending'],
  ])('classifies provider code %i as %s', (code, expected) => {
    const error = toHoodConnectError(rpcError(code, 'boom'))
    expect(error.code).toBe(expected)
    expect(error.providerCode).toBe(code)
    expect(error.hint).not.toBe('')
  })

  it('unwraps a -32603 that hides the real code in data.originalError', () => {
    expect(toHoodConnectError(wrappedRpcError(4902, 'Unrecognized chain')).code).toBe('chain-not-added')
    expect(toHoodConnectError(wrappedRpcError(4001, 'User rejected')).code).toBe('user-rejected')
  })

  it('unwraps a code nested under data', () => {
    expect(toHoodConnectError(rpcError(-32603, 'internal', { code: 4902 })).code).toBe('chain-not-added')
  })

  it('unwraps a code carried on cause', () => {
    const outer = new Error('wrapped') as Error & { cause?: unknown }
    outer.cause = rpcError(4001, 'User rejected the request')
    expect(toHoodConnectError(outer).code).toBe('user-rejected')
  })

  it('falls back to message matching for wallets that only signal in prose', () => {
    expect(toHoodConnectError(new Error('User denied transaction signature')).code).toBe('user-rejected')
    expect(toHoodConnectError(new Error('Request of type wallet_addEthereumChain already pending')).code).toBe('request-pending')
    expect(toHoodConnectError(new Error('Unrecognized chain ID')).code).toBe('chain-not-added')
  })

  it('uses the supplied fallback when nothing classifies', () => {
    expect(toHoodConnectError(new Error('who knows')).code).toBe('unknown')
    expect(toHoodConnectError(new Error('who knows'), 'balance-read-failed').code).toBe('balance-read-failed')
  })

  it('passes an already-normalised error through unchanged', () => {
    const original = new HoodConnectError('no-provider', 'nothing here')
    expect(toHoodConnectError(original)).toBe(original)
  })

  it('handles values that are not errors at all', () => {
    expect(toHoodConnectError('a string').message).toBe('a string')
    expect(toHoodConnectError(null).message).toBe('The wallet request failed.')
    expect(toHoodConnectError(undefined).code).toBe('unknown')
  })

  it('marks a rejection retryable and a missing wallet not', () => {
    expect(toHoodConnectError(rpcError(4001, 'no')).retryable).toBe(true)
    expect(new HoodConnectError('no-provider', 'none').retryable).toBe(false)
    expect(new HoodConnectError('unsupported-method', 'none').retryable).toBe(false)
  })

  it('keeps the original error reachable as the cause', () => {
    const source = rpcError(4001, 'nope')
    expect(toHoodConnectError(source).cause).toBe(source)
  })

  it('gives every code a non-empty recovery hint', () => {
    const codes = [
      'no-provider',
      'user-rejected',
      'request-pending',
      'chain-not-added',
      'chain-add-failed',
      'unsupported-method',
      'unauthorized',
      'wallet-disconnected',
      'wallet-locked',
      'balance-read-failed',
      'unknown',
    ] as const
    for (const code of codes) {
      expect(new HoodConnectError(code, 'x').hint.length).toBeGreaterThan(10)
    }
  })
})

describe('extractProviderCode', () => {
  it('never returns the -32603 container itself', () => {
    expect(extractProviderCode(rpcError(-32603, 'internal'))).toBeUndefined()
  })

  it('stops recursing on a cyclic error object', () => {
    const cyclic = { data: {} as Record<string, unknown> }
    cyclic.data['originalError'] = cyclic
    expect(extractProviderCode(cyclic)).toBeUndefined()
  })

  it('reads string codes some wallets use', () => {
    expect(extractProviderCode({ code: 'ACTION_REJECTED' })).toBe('ACTION_REJECTED')
  })
})
