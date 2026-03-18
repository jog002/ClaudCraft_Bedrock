import { Action, ActionResult, SkillContext } from './types';

export async function executeChat(action: Action, ctx: SkillContext): Promise<ActionResult> {
  if (action.type !== 'chat') {
    return { success: false, message: 'Invalid action type', actionType: 'chat' };
  }

  ctx.connection.sendChat(action.message);
  return { success: true, message: `Sent: "${action.message}"`, actionType: 'chat' };
}
