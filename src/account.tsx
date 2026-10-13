import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { accountClient } from './accountClient';
import { AccountActions, AccountClient, AccountState, OFF_STATE, SIGNED_OUT, accountActions, loadAccount } from './accountModel';

/**
 * The website's account and "Support this app", for the screens. In the iOS and Android apps the
 * platform's client is the inert twin, so this is off from the first frame and stays off: nothing
 * is asked and nothing is drawn. On the web it asks the site's `api/config` once (loadAccount in
 * accountModel.ts, where every decision is, so a test can drive it without a renderer).
 */
export interface AccountApi {
  state: AccountState;
  dismissNotice: () => void;
  /** Leaves for Google, and comes back to this page. */
  signIn: () => void;
  /** Each returns what to tell the visitor when it did not work, or null. */
  signOut: () => Promise<string | null>;
  deleteAccount: () => Promise<string | null>;
  /** Leaves for Stripe's Checkout when it can; otherwise says why it did not. */
  buySupport: () => Promise<string | null>;
}

const OFF: AccountApi = {
  state: OFF_STATE,
  dismissNotice: () => {},
  signIn: () => {},
  signOut: async () => null,
  deleteAccount: async () => null,
  buySupport: async () => null,
};

const AccountContext = createContext<AccountApi>(OFF);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function AccountProvider({ children, client = accountClient }: { children: React.ReactNode; client?: AccountClient }) {
  const [state, setState] = useState<AccountState>(OFF_STATE);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void loadAccount(client, { wait: sleep, alive: () => alive.current, update: setState });
    return () => {
      alive.current = false;
    };
  }, [client]);

  /** What `api/me` says now: after signing out or deleting, or a Buy the page was behind on. */
  const refresh = useCallback(async () => {
    const me = await client.me();
    if (alive.current) setState((s) => ({ ...s, me: me ?? SIGNED_OUT }));
  }, [client]);

  /** Sign out, Delete account or Buy, and whether it asks api/me again after (accountActions). */
  const act = useCallback((name: keyof AccountActions) => accountActions(client, refresh)[name](), [client, refresh]);

  const api = useMemo<AccountApi>(
    () =>
      state.on
        ? {
            state,
            dismissNotice: () => setState((s) => ({ ...s, notice: null })),
            signIn: () => client.signIn(),
            signOut: () => act('signOut'),
            deleteAccount: () => act('deleteAccount'),
            buySupport: () => act('buySupport'),
          }
        : OFF,
    [state, client, act],
  );
  return <AccountContext.Provider value={api}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountApi {
  return useContext(AccountContext);
}
