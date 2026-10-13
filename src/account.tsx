import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { accountClient } from './accountClient';
import {
  ACCOUNT_NOTES,
  AccountClient,
  AccountState,
  OFF_STATE,
  SIGNED_OUT,
  SUPPORTER_PRODUCT,
  checkoutNote,
  loadAccount,
} from './accountModel';

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

  const signOut = useCallback(async () => {
    if (!(await client.signOut())) return ACCOUNT_NOTES.signOutFailed;
    await refresh();
    return null;
  }, [client, refresh]);

  const deleteAccount = useCallback(async () => {
    if (!(await client.deleteAccount())) return ACCOUNT_NOTES.deleteFailed;
    await refresh();
    return null;
  }, [client, refresh]);

  const buySupport = useCallback(async () => {
    const result = await client.checkout(SUPPORTER_PRODUCT);
    // Signed out meanwhile, or already a supporter: what the sheet shows is stale.
    if (result === 'signin' || result === 'owned') await refresh();
    return checkoutNote(result);
  }, [client, refresh]);

  const api = useMemo<AccountApi>(
    () =>
      state.on
        ? {
            state,
            dismissNotice: () => setState((s) => ({ ...s, notice: null })),
            signIn: () => client.signIn(),
            signOut,
            deleteAccount,
            buySupport,
          }
        : OFF,
    [state, client, signOut, deleteAccount, buySupport],
  );
  return <AccountContext.Provider value={api}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountApi {
  return useContext(AccountContext);
}
