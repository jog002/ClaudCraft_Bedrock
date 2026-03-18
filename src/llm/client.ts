import Anthropic from '@anthropic-ai/sdk';
import { LLMConfig } from '../config';
import { ActionRequest, getActionToolDefinition } from '../skills/types';

export class LLMClient {
  private anthropic: Anthropic;
  private config: LLMConfig;
  private toolDefinition: ReturnType<typeof getActionToolDefinition>;

  private lastReasoningCall = 0;
  private readonly REASONING_COOLDOWN_MS = 60_000;

  constructor(config: LLMConfig, cheats = true) {
    this.config = config;
    this.anthropic = new Anthropic();
    this.toolDefinition = getActionToolDefinition(cheats);
  }

  // Simple text chat (kept for backwards compat)
  async chat(systemPrompt: string, userMessage: string): Promise<string> {
    const response = await this.anthropic.messages.create({
      model: this.config.chatModel,
      max_tokens: this.config.maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const block = response.content[0];
    if (block.type === 'text') {
      return block.text.trim();
    }
    return '';
  }

  // Tool-use based action generation
  async getActions(
    systemPrompt: string,
    userMessage: string,
    retryMessages?: Anthropic.MessageParam[]
  ): Promise<{ parsed: ActionRequest } | { error: string }> {
    const messages: Anthropic.MessageParam[] = retryMessages
      ? [...retryMessages]
      : [{ role: 'user', content: userMessage }];

    try {
      const response = await this.anthropic.messages.create({
        model: this.config.chatModel,
        max_tokens: this.config.maxTokens,
        system: systemPrompt,
        messages,
        tools: [this.toolDefinition as any],
        tool_choice: { type: 'tool', name: 'take_actions' },
      });

      // Find the tool_use block
      for (const block of response.content) {
        if (block.type === 'tool_use' && block.name === 'take_actions') {
          const input = block.input as any;
          // Validate basic structure
          if (!input.thought || !Array.isArray(input.actions)) {
            return { error: 'Tool response missing thought or actions array' };
          }
          return {
            parsed: {
              thought: input.thought,
              actions: input.actions,
              goal: input.goal,
              goalComplete: input.goalComplete,
            },
          };
        }
      }

      // No tool use block found — check for text
      for (const block of response.content) {
        if (block.type === 'text' && block.text.trim()) {
          return { error: `LLM returned text instead of tool use: ${block.text.substring(0, 100)}` };
        }
      }

      return { error: 'No tool_use block in response' };
    } catch (err: any) {
      return { error: `API error: ${err.message}` };
    }
  }

  /**
   * Use the reasoning model (Sonnet) for complex planning questions.
   * Rate-limited to 1 call per 60 seconds.
   */
  async reason(systemPrompt: string, userMessage: string): Promise<{ text: string } | { error: string }> {
    const now = Date.now();
    if (now - this.lastReasoningCall < this.REASONING_COOLDOWN_MS) {
      const remaining = Math.ceil((this.REASONING_COOLDOWN_MS - (now - this.lastReasoningCall)) / 1000);
      return { error: `Reasoning model on cooldown. Try again in ${remaining}s.` };
    }

    this.lastReasoningCall = now;

    try {
      const response = await this.anthropic.messages.create({
        model: this.config.reasoningModel,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      const block = response.content[0];
      if (block.type === 'text') {
        return { text: block.text.trim() };
      }
      return { error: 'No text in reasoning response' };
    } catch (err: any) {
      return { error: `Reasoning API error: ${err.message}` };
    }
  }
}
