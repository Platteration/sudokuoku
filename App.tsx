import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AccountProvider } from './src/account';
import GameScreen from './src/screens/GameScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      {/* The website's sign-in and "Support this app"; inert in the iOS and Android apps. */}
      <AccountProvider>
        <GameScreen />
      </AccountProvider>
    </SafeAreaProvider>
  );
}
