// @ts-check
// What Sudokuoku's website sells through server/kit (sign in with Google, Stripe Checkout and
// its signed webhook): one "Support this app" payment, once, and nothing else. It changes
// nothing in the game: every puzzle, shift, preset, colour pack and assist stays the same for
// everyone. A paid checkout grants the entitlement `supporter`, which `GET api/me` then reports,
// and the web build's About card thanks a supporter for it (src/accountModel.ts,
// src/components/SettingsSheet.tsx). Its Stripe Price id is STRIPE_PRICE_SUPPORTER. The iOS and
// Android apps sell nothing and never reach this file.
//
// The kit checks this at start-up and throws on a malformed one (an unknown field included), and
// server/api.test.mjs holds it to what the page asks for.

export default {
  app: 'sudokuoku',
  name: 'Sudokuoku',
  products: [
    {
      id: 'supporter',
      name: 'Support this app',
      description: 'A one-time payment towards Sudokuoku. It changes nothing in the game: every puzzle, shift and setting stays the same for everyone.',
      mode: 'payment',
      grants: 'supporter',
    },
  ],
};
