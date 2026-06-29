import React, { useEffect, useReducer, useRef } from 'react';

type Stage = 'idle' | 'signature' | 'network' | 'confirming' | 'success' | 'error';
type Status = 'idle' | 'pending' | 'success' | 'error';

type State = { stage: Stage; status: Status; message?: string };

type Action =
  | { type: 'START' }
  | { type: 'SET_STAGE'; stage: Stage; status?: Status; message?: string }
  | { type: 'SUCCESS'; message?: string }
  | { type: 'ERROR'; message?: string }
  | { type: 'RESET' };

const initialState: State = { stage: 'idle', status: 'idle', message: '' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'START':
      return { stage: 'signature', status: 'pending', message: 'Awaiting wallet signature...' };
    case 'SET_STAGE':
      return { stage: action.stage, status: action.status ?? 'pending', message: action.message ?? '' };
    case 'SUCCESS':
      return { stage: 'success', status: 'success', message: action.message ?? 'Access granted.' };
    case 'ERROR':
      return { stage: 'error', status: 'error', message: action.message ?? 'Transaction failed.' };
    case 'RESET':
      return { ...initialState };
    default:
      return state;
  }
}

type Props = {
  onClose?: () => void;
  onViewUnlocked?: () => void;
  className?: string;
};

export default function PurchaseProgress({ onClose = () => {}, onViewUnlocked = () => {}, className = '' }: Props) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      timers.current.forEach((t) => clearTimeout(t));
      timers.current = [];
    };
  }, []);

  const progressPercent = (() => {
    switch (state.stage) {
      case 'idle':
        return 0;
      case 'signature':
        return state.status === 'pending' ? 12 : 25;
      case 'network':
        return state.status === 'pending' ? 45 : 65;
      case 'confirming':
        return state.status === 'pending' ? 80 : 90;
      case 'success':
        return 100;
      case 'error':
        return 100;
      default:
        return 0;
    }
  })();

  const steps = [
    { id: 'signature', title: 'Wallet Signature', subtitle: 'Sign with your wallet' },
    { id: 'network', title: 'Broadcast Transaction', subtitle: 'Network submission' },
    { id: 'confirming', title: 'Granting Access', subtitle: 'Finalizing on-chain & unlocking' },
  ];

  const startFlow = () => {
    dispatch({ type: 'START' });

    const t1 = window.setTimeout(() => {
      const rejected = Math.random() < 0.15;
      if (rejected) {
        dispatch({ type: 'ERROR', message: 'Transaction Failed: User rejected signature.' });
        return;
      }
      dispatch({ type: 'SET_STAGE', stage: 'network', message: 'Broadcasting transaction to network...' });

      const t2 = window.setTimeout(() => {
        const networkFail = Math.random() < 0.1;
        if (networkFail) {
          dispatch({ type: 'ERROR', message: 'Transaction Failed: network error or timeout.' });
          return;
        }

        dispatch({ type: 'SET_STAGE', stage: 'confirming', message: 'Confirming transaction and granting access...' });

        const t3 = window.setTimeout(() => {
          const finalFail = Math.random() < 0.05;
          if (finalFail) {
            dispatch({ type: 'ERROR', message: 'Transaction Failed: finalization error.' });
            return;
          }

          dispatch({ type: 'SUCCESS', message: 'Access Granted! Your prompt is now unlocked.' });
        }, 1000);

        timers.current.push(t3);
      }, 1500);

      timers.current.push(t2);
    }, 1200);

    timers.current.push(t1);
  };

  const retry = () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
    dispatch({ type: 'RESET' });
    const t = window.setTimeout(() => startFlow(), 180);
    timers.current.push(t);
  };

  const close = () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
    onClose();
    dispatch({ type: 'RESET' });
  };

  useEffect(() => {
    // start automatically when mounted
    startFlow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const StepIcon: React.FC<{ stepId: string }> = ({ stepId }) => {
    const active = state.stage === (stepId as Stage) && state.status === 'pending';
    const done =
      (stepId === 'signature' && (state.stage === 'network' || state.stage === 'confirming' || state.stage === 'success')) ||
      (stepId === 'network' && (state.stage === 'confirming' || state.stage === 'success')) ||
      (stepId === 'confirming' && state.stage === 'success');

    const failed =
      state.stage === 'error' &&
      ((stepId === 'signature' && state.message?.toLowerCase().includes('signature')) ||
        (stepId === 'network' && state.message?.toLowerCase().includes('network')) ||
        (stepId === 'confirming' && (state.message?.toLowerCase().includes('finalization') || state.message?.toLowerCase().includes('granting'))));

    return (
      <div
        className={`flex items-center justify-center h-9 w-9 rounded-full flex-shrink-0
          ${active ? 'ring-2 ring-indigo-400 animate-pulse bg-indigo-600 text-white' : ''}
          ${done ? 'bg-green-600 text-white' : ''}
          ${failed ? 'bg-red-600 text-white' : ''}
          ${!active && !done && !failed ? 'bg-gray-800 text-gray-400' : ''}`}
        aria-hidden
      >
        {done ? (
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : failed ? (
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : active ? (
          <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeDasharray="31.4 31.4" />
          </svg>
        ) : (
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="3" fill="currentColor" />
          </svg>
        )}
      </div>
    );
  };

  return (
    <div className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center ${className}`} role="dialog" aria-modal="true">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={close} aria-hidden />
      <div className="relative w-full max-w-2xl sm:mx-4 sm:rounded-lg sm:shadow-xl bg-slate-900 text-slate-100 transform transition-all ease-in-out duration-200 sm:my-8 sm:max-h-[86vh] overflow-hidden" style={{ margin: 'auto' }}>
        <div className="h-1 bg-gray-800">
          <div className="h-1 bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all" style={{ width: `${progressPercent}%` }} aria-hidden />
        </div>

        <div className="p-5 sm:p-6 flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold">Complete Purchase</h3>
                <p className="mt-1 text-sm text-slate-400 max-w-xl">Follow the steps below to complete your purchase. The core prompt remains encrypted until purchase confirmed on-chain.</p>
              </div>

              <div className="ml-4 sm:ml-0">
                <button onClick={close} className="text-slate-400 hover:text-slate-200 rounded-full p-1 focus:outline-none focus:ring-2 focus:ring-indigo-600" aria-label="Close">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                    <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {steps.map((s) => {
                const active = state.stage === (s.id as Stage) && state.status === 'pending';
                const done =
                  (s.id === 'signature' && (state.stage === 'network' || state.stage === 'confirming' || state.stage === 'success')) ||
                  (s.id === 'network' && (state.stage === 'confirming' || state.stage === 'success')) ||
                  (s.id === 'confirming' && state.stage === 'success');
                const failed =
                  state.stage === 'error' &&
                  ((s.id === 'signature' && state.message?.toLowerCase().includes('signature')) ||
                    (s.id === 'network' && state.message?.toLowerCase().includes('network')) ||
                    (s.id === 'confirming' && (state.message?.toLowerCase().includes('finalization') || state.message?.toLowerCase().includes('granting'))));

                return (
                  <div key={s.id} className={`flex items-center gap-4 p-3 rounded-lg ${active ? 'ring-1 ring-indigo-500 bg-slate-800' : ''} ${failed ? 'bg-red-900/40' : ''}`} aria-current={active ? 'step' : undefined}>
                    <StepIcon stepId={s.id} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <div className="truncate">
                          <div className={`text-sm font-medium ${done ? 'text-green-300' : active ? 'text-white' : 'text-slate-200'}`}>{s.title}</div>
                          <div className="text-xs text-slate-400">{s.subtitle}</div>
                        </div>
                        <div className="ml-2 text-xs">
                          {done ? <span className="text-green-300">Completed</span> : failed ? <span className="text-red-300">Failed</span> : active ? <span className="text-indigo-300">In progress</span> : <span className="text-slate-500">Pending</span>}
                        </div>
                      </div>
                      {active && <div className="mt-2 text-xs text-slate-300 flex items-center gap-2"><svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="28 28" /></svg><span>{state.message}</span></div>}
                      {failed && <div className="mt-2 text-xs text-red-200">{state.message}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="w-full sm:w-80 flex-shrink-0">
            <div className="bg-slate-800 p-4 rounded-lg flex flex-col gap-4 items-stretch">
              {state.stage === 'idle' && state.status === 'idle' && (
                <>
                  <div className="text-sm text-slate-300">Ready to purchase?</div>
                  <button onClick={startFlow} className="mt-2 w-full inline-flex items-center justify-center px-4 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-md text-white font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-400">Submit Payment</button>
                  <button onClick={close} className="mt-2 w-full py-2 text-sm text-slate-300 bg-transparent rounded-md hover:bg-slate-700">Cancel</button>
                </>
              )}

              {(state.stage === 'signature' || state.stage === 'network' || state.stage === 'confirming') && state.status === 'pending' && (
                <>
                  <div className="flex items-center gap-3">
                    <svg className="w-10 h-10 text-indigo-400" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                      <path d="M8 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <div>
                      <div className="text-sm font-semibold">{state.message}</div>
                      <div className="text-xs text-slate-400 mt-1">This may take a few seconds — do not close your wallet.</div>
                    </div>
                  </div>

                  <div className="mt-3 text-xs text-slate-400">Progress: {progressPercent}%</div>
                  <div aria-hidden className="mt-2 h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-2 bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all" style={{ width: `${progressPercent}%` }} />
                  </div>
                  <button onClick={close} className="mt-4 w-full py-2 text-sm text-slate-300 bg-transparent rounded-md hover:bg-slate-700">Close (Minimizes UI; transaction continues)</button>
                </>
              )}

              {state.stage === 'success' && state.status === 'success' && (
                <>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center h-12 w-12 rounded-full bg-green-600 text-white">
                      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                        <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-sm font-semibold">Access Granted</div>
                      <div className="text-xs text-slate-400 mt-1">Your prompt is unlocked and available in your library.</div>
                    </div>
                  </div>

                  <button onClick={() => { onViewUnlocked(); dispatch({ type: 'RESET' }); }} className="mt-4 w-full inline-flex items-center justify-center px-4 py-3 bg-emerald-500 hover:bg-emerald-400 rounded-md text-white font-semibold">View My Unlocked Prompt</button>

                  <button onClick={close} className="mt-2 w-full py-2 text-sm text-slate-300 bg-transparent rounded-md hover:bg-slate-700">Close</button>
                </>
              )}

              {state.stage === 'error' && state.status === 'error' && (
                <>
                  <div className="flex items-start gap-3">
                    <div className="flex items-center justify-center h-12 w-12 rounded-full bg-red-600 text-white">
                      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                        <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-red-200">Transaction Failed</div>
                      <div className="text-xs text-red-200 mt-1">{state.message}</div>
                    </div>
                  </div>

                  <button onClick={retry} className="mt-4 w-full inline-flex items-center justify-center px-4 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-md text-white font-semibold">Retry Purchase</button>

                  <button onClick={close} className="mt-2 w-full py-2 text-sm text-slate-300 bg-transparent rounded-md hover:bg-slate-700">Close</button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
