import { loadConfig, loadAgentConfig, resolveEnv } from "../config.ts";
import { getAdapter } from "../adapters/registry.ts";
import { invoke } from "../invoke.ts";
import { saveSession, loadSession, loadLastSession } from "../session.ts";
import { writeRunLog } from "../log.ts";
import type { InvokeIntent } from "../adapters/types.ts";

export interface RunOptions {
  agent?: string;
  resume?: boolean;
  prompt: string;
  extraArgs: string[];
  pipedInput?: string;
}

export async function runCommand(opts: RunOptions): Promise<number> {
  const globalConfig = loadConfig();
  const agentName = opts.agent ?? globalConfig.default_agent;
  const agentConfig = loadAgentConfig(agentName);
  const adapter = getAdapter(agentName, agentConfig);
  const cwd = process.cwd();

  let prompt = opts.prompt;

  // Prepend piped stdin if present
  if (opts.pipedInput) {
    prompt = `${opts.pipedInput}\n\n${prompt}`;
  }

  let resumeId: string | undefined;

  if (opts.resume) {
    // Check if same agent has a session
    const agentSession = loadSession(cwd, agentName);
    if (agentSession?.sessionId) {
      resumeId = agentSession.sessionId;
    } else {
      // Handoff: load last session from any agent
      const lastSession = loadLastSession(cwd);
      if (lastSession && lastSession.agent !== agentName && lastSession.summary) {
        prompt = `Previous context from ${lastSession.agent}:\n${lastSession.summary}\n\n${prompt}`;
      }
    }
  }

  const env = resolveEnv(agentConfig.env ?? {});
  const intent: InvokeIntent = {
    prompt,
    model: agentConfig.model,
    resumeId,
    cwd,
    extraArgs: [...(agentConfig.extra_args ?? []), ...opts.extraArgs],
    env,
  };

  console.error(`\x1b[2m[harnessctl] agent=${agentName} cwd=${cwd}\x1b[0m`);

  try {
    let result = await invoke(adapter, intent, agentConfig);

    // Auto-retry fresh if resume failed (Paperclip's pattern)
    if (resumeId && result.exitCode !== 0) {
      console.error(`\x1b[2m[harnessctl] resume failed, retrying fresh...\x1b[0m`);
      intent.resumeId = undefined;
      result = await invoke(adapter, intent, agentConfig);
    }

    // Save session
    saveSession(cwd, agentName, result.sessionId, result.summary);

    // Write run log
    writeRunLog(agentName, opts.prompt, cwd, result);

    // Print summary
    if (result.cost != null || result.tokens) {
      const parts: string[] = [];
      if (result.tokens) parts.push(`tokens: ${result.tokens.input}in/${result.tokens.output}out`);
      if (result.cost != null) parts.push(`cost: $${result.cost.toFixed(4)}`);
      parts.push(`duration: ${result.duration.toFixed(1)}s`);
      console.error(`\x1b[2m[harnessctl] ${parts.join(" | ")}\x1b[0m`);
    }

    return result.exitCode ?? 1;
  } catch (err: any) {
    console.error(`\x1b[31m[harnessctl] error: ${err.message}\x1b[0m`);
    return 1;
  }
}
