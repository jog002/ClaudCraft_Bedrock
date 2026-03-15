import Anthropic from '@anthropic-ai/sdk';
import { LLMConfig } from '../config';

export class LLMClient {
  private anthropic: Anthropic;
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
    this.anthropic = new Anthropic();  // Uses ANTHROPIC_API_KEY env var
  }

  async chat(systemPrompt: string, userMessage: string): Promise<string> {
    const response = await this.anthropic.messages.create({
      model: this.config.chatModel,
      max_tokens: this.config.maxTokens,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userMessage }
      ],
    });

    const block = response.content[0];
    if (block.type === 'text') {
      return block.text.trim();
    }
    return '';
  }
}
