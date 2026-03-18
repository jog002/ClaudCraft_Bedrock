import { Action, ActionResult } from './types';

export async function executeWait(action: Action): Promise<ActionResult> {
  if (action.type !== 'wait') {
    return { success: false, message: 'Invalid action type', actionType: 'wait' };
  }

  const seconds = Math.min(action.seconds ?? 5, 30); // Cap at 30s
  await new Promise((r) => setTimeout(r, seconds * 1000));
  return { success: true, message: `Waited ${seconds}s`, actionType: 'wait' };
}
