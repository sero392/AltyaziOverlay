import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppState } from '../shared/types';
import { api } from './api';
import { HomeScreen } from './HomeScreen';
import { SetupWizard } from './SetupWizard';
import { Spinner } from './ui';

function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [wizard, setWizard] = useState(false);

  useEffect(() => {
    api.getState().then(s => {
      setState(s);
      setWizard(!s.setupDone);
    });
    return api.onState(setState);
  }, []);

  if (!state) {
    return (
      <div className="shell" style={{ justifyContent: 'center' }}>
        <Spinner />
      </div>
    );
  }
  return (
    <div className="shell">
      {wizard ? (
        <SetupWizard
          state={state}
          onDone={() => {
            api.setSetupDone(true);
            setWizard(false);
          }}
        />
      ) : (
        <HomeScreen state={state} onOpenWizard={() => setWizard(true)} />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
