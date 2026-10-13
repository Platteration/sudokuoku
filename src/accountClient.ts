/**
 * The account and "Support this app" in the iOS and Android apps: not configured. The website's
 * sign-in and shop are its own (accountClient.web.ts, which Metro bundles into the web build
 * alone); the apps keep their no-network posture, with INTERNET blocked in the shipped manifest,
 * and sell nothing: the App Store and Google Play require their own in-app purchase for digital
 * goods, which is a later decision. So this twin answers everything with "nothing here" and opens
 * nothing. src/__tests__/appConfig.test.ts holds it to that, and to being the module a native
 * build resolves.
 */
import { AccountClient, NO_LANDING } from './accountModel';

export const accountClient: AccountClient = {
  web: false,
  config: async () => null,
  me: async () => null,
  signIn: () => {},
  signOut: async () => false,
  deleteAccount: async () => false,
  checkout: async () => 'unavailable',
  takeLanding: () => NO_LANDING,
};
