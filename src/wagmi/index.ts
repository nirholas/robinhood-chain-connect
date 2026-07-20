import { createConfig, createConnector, http, type Config, type CreateConfigParameters, type CreateConnectorFn, type Transport } from '@wagmi/core'
import { robinhood, robinhoodTestnet } from 'viem/chains'
import type { Address, Chain } from 'viem'
import { hoodMainnet, hoodTestnet, resolveHoodChain, type HoodChainId, type HoodNetwork } from '../core/chains.js'
import { HoodConnectError, toHoodConnectError } from '../core/errors.js'
import { createProviderStore } from '../core/eip6963.js'
import { isEip1193Provider, type Eip1193Provider } from '../core/provider.js'
import { addChain, getAccounts, getChainId, requestAccounts, switchChain as switchChainRpc } from '../core/wallet.js'

/**
 * `hood-connect/wagmi` is the wagmi surface Robinhood Chain was missing.
 *
 * wagmi ships no Robinhood Chain connector kit, so every dApp writes the same
 * three things by hand: the chain entry, a transport, and a connector whose
 * `switchChain` knows to add the network before switching to it. This module
 * is all three, correct, in one import.
 *
 * `wagmi` and `@wagmi/core` are optional peer dependencies. Importing this
 * subpath is what pulls them in, so the base package installs without them.
 *
 * @packageDocumentation
 */

/** viem's official Robinhood Chain mainnet definition (chain 4663). */
export const robinhoodChain: Chain = robinhood
/** viem's official Robinhood Chain testnet definition (chain 46630). */
export const robinhoodChainTestnet: Chain = robinhoodTestnet

/** Both chains as the non-empty tuple `createConfig` requires. */
export const hoodWagmiChains: readonly [Chain, Chain] = [robinhood, robinhoodTestnet]

/** Default HTTP transports, keyed by chain ID. */
export const hoodTransports: Record<number, Transport> = {
  [hoodMainnet.id]: http(hoodMainnet.rpcUrl),
  [hoodTestnet.id]: http(hoodTestnet.rpcUrl),
}

/** Options for {@link hoodConnector}. */
export interface HoodConnectorParameters {
  /**
   * Pick a specific wallet by its EIP-6963 rdns (`io.metamask`) or UUID.
   * Omit to use the first wallet that announces itself, falling back to a
   * legacy `window.ethereum`.
   */
  target?: string
  /** Connector id reported to wagmi. @defaultValue `'hood'` */
  id?: string
  /** Connector name shown in wallet pickers. @defaultValue `'Robinhood Chain'` */
  name?: string
  /**
   * Remember a manual disconnect, so `reconnect()` does not immediately
   * reconnect a user who chose to leave.
   * @defaultValue `true`
   */
  shimDisconnect?: boolean
}

type ConnectorStorageItem = { 'hood.disconnected': true }

/**
 * A wagmi connector for Robinhood Chain, built on EIP-6963 discovery.
 *
 * What it does that a generic injected connector does not: `switchChain`
 * routes through the add-then-switch fallback with the exact
 * `wallet_addEthereumChain` parameters for chain 4663 and 46630, so a
 * first-time visitor whose wallet has never seen Robinhood Chain gets the
 * network added and selected in one action instead of a 4902 error.
 *
 * @example
 * ```ts
 * import { createConfig } from 'wagmi'
 * import { hoodConnector, hoodWagmiChains, hoodTransports } from 'hood-connect/wagmi'
 *
 * export const config = createConfig({
 *   chains: hoodWagmiChains,
 *   transports: hoodTransports,
 *   connectors: [hoodConnector()],
 * })
 * ```
 */
export function hoodConnector(parameters: HoodConnectorParameters = {}): CreateConnectorFn<
  Eip1193Provider,
  Record<string, unknown>,
  ConnectorStorageItem
> {
  const shimDisconnect = parameters.shimDisconnect ?? true

  return createConnector<Eip1193Provider, Record<string, unknown>, ConnectorStorageItem>((config) => {
    const store = createProviderStore()
    let started = false
    let accountsChanged: ((accounts: string[]) => void) | undefined
    let chainChanged: ((chainId: string) => void) | undefined
    let disconnected: ((error?: Error) => void) | undefined

    function findProvider(): Eip1193Provider | null {
      if (!started) {
        store.start()
        started = true
      } else {
        store.refresh()
      }
      if (parameters.target) {
        const match = store.getByRdns(parameters.target) ?? store.getByUuid(parameters.target)
        if (match) return match.provider
      }
      const first = store.getSnapshot()[0]
      if (first) return first.provider
      const legacy = typeof window === 'undefined' ? null : (window as { ethereum?: unknown }).ethereum
      return isEip1193Provider(legacy) ? legacy : null
    }

    async function provider(): Promise<Eip1193Provider> {
      const found = findProvider()
      if (!found) {
        throw new HoodConnectError('no-provider', 'No injected wallet was found in this browser.')
      }
      return found
    }

    function bind(target: Eip1193Provider): void {
      if (!accountsChanged || typeof target.on !== 'function') return
      target.on('accountsChanged', accountsChanged as (payload: never) => void)
      if (chainChanged) target.on('chainChanged', chainChanged as (payload: never) => void)
      if (disconnected) target.on('disconnect', disconnected as (payload: never) => void)
    }

    function unbind(target: Eip1193Provider): void {
      const remove = target.removeListener ?? target.off
      if (!remove) return
      if (accountsChanged) remove.call(target, 'accountsChanged', accountsChanged as (payload: never) => void)
      if (chainChanged) remove.call(target, 'chainChanged', chainChanged as (payload: never) => void)
      if (disconnected) remove.call(target, 'disconnect', disconnected as (payload: never) => void)
    }

    return {
      id: parameters.id ?? 'hood',
      name: parameters.name ?? 'Robinhood Chain',
      type: 'hood',

      async connect(options = {}) {
        const target = await provider()
        const accounts = options.isReconnecting
          ? await getAccounts(target)
          : await requestAccounts(target)

        if (accounts.length === 0) {
          throw new HoodConnectError('wallet-locked', 'The wallet authorised no accounts for this site.')
        }

        accountsChanged ??= (next) => this.onAccountsChanged(next)
        chainChanged ??= (next) => this.onChainChanged(next)
        disconnected ??= (error) => this.onDisconnect(error)
        unbind(target)
        bind(target)

        let chainId = await getChainId(target)
        const requested = options.chainId
        if (requested !== undefined && requested !== chainId) {
          const chain = await this.switchChain?.({ chainId: requested })
          chainId = chain?.id ?? chainId
        }

        if (shimDisconnect) await config.storage?.removeItem('hood.disconnected')

        return { accounts: accounts as readonly Address[], chainId } as never
      },

      async disconnect() {
        const target = findProvider()
        if (target) unbind(target)
        if (shimDisconnect) await config.storage?.setItem('hood.disconnected', true)
      },

      async getAccounts() {
        return getAccounts(await provider()) as Promise<readonly Address[]>
      },

      async getChainId() {
        return getChainId(await provider())
      },

      getProvider: () => provider(),

      async isAuthorized() {
        try {
          if (shimDisconnect && (await config.storage?.getItem('hood.disconnected'))) return false
          const target = findProvider()
          if (!target) return false
          return (await getAccounts(target)).length > 0
        } catch {
          return false
        }
      },

      async switchChain({ chainId }) {
        const chain = config.chains.find((candidate) => candidate.id === chainId)
        if (!chain) {
          throw new HoodConnectError(
            'unknown',
            `Chain ${String(chainId)} is not in this wagmi config. Add it to createConfig({ chains }).`,
          )
        }
        const target = await provider()

        try {
          if (chainId === hoodMainnet.id || chainId === hoodTestnet.id) {
            // The whole reason this connector exists: exact add parameters and
            // the 4902 add-then-switch fallback for Robinhood Chain.
            await switchChainRpc(target, resolveHoodChain(chainId as HoodChainId))
          } else {
            await target.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: `0x${chainId.toString(16)}` }],
            })
          }
        } catch (error) {
          throw toHoodConnectError(error)
        }

        config.emitter.emit('change', { chainId })
        return chain
      },

      onAccountsChanged(accounts) {
        if (accounts.length === 0) config.emitter.emit('disconnect')
        else config.emitter.emit('change', { accounts: accounts as readonly Address[] })
      },

      onChainChanged(chainId) {
        config.emitter.emit('change', { chainId: Number.parseInt(chainId, 16) })
      },

      onDisconnect() {
        config.emitter.emit('disconnect')
      },
    }
  })
}

/** Options for {@link createHoodConfig}. */
export interface CreateHoodConfigParameters {
  /**
   * Which networks to include.
   * @defaultValue both
   */
  networks?: readonly HoodNetwork[]
  /** Extra connectors alongside {@link hoodConnector}. */
  connectors?: CreateConfigParameters['connectors']
  /** Override the HTTP transports, keyed by chain ID. */
  transports?: Record<number, Transport>
  /** Set `true` in a server-rendered app so wagmi hydrates from cookies. */
  ssr?: boolean
}

/**
 * A ready-to-use wagmi config for Robinhood Chain, in one call.
 *
 * @example
 * ```ts
 * import { createHoodConfig } from 'hood-connect/wagmi'
 *
 * export const config = createHoodConfig({ networks: ['mainnet'], ssr: true })
 * ```
 */
export function createHoodConfig(parameters: CreateHoodConfigParameters = {}): Config {
  const networks = parameters.networks ?? ['mainnet', 'testnet']
  const selected = networks.map((network) => (network === 'mainnet' ? robinhood : robinhoodTestnet))
  const first = selected[0]
  if (!first) {
    throw new HoodConnectError('unknown', 'createHoodConfig needs at least one network.')
  }

  const chains = [first, ...selected.slice(1)] as [Chain, ...Chain[]]
  const transports = parameters.transports ?? hoodTransports

  return createConfig({
    chains,
    transports,
    connectors: parameters.connectors ?? [hoodConnector()],
    ...(parameters.ssr === undefined ? {} : { ssr: parameters.ssr }),
  })
}

export { addChain, hoodMainnet, hoodTestnet, resolveHoodChain }
export type { HoodChainId, HoodNetwork }
