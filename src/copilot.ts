import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface CopilotOptions {
  token: string;
  model: string;
  /** A soft, not hard, per-invocation spending limit. */
  maxAiCredits: number;
  timeoutMs: number;
  /** Injectable for offline tests; normally resolves `copilot` from PATH. */
  executable?: string;
}

/** Pure text analysis: no tools, repository instructions, MCPs or remote sessions. */
export function buildCopilotArgs(prompt: string, options: CopilotOptions): string[] {
  return [
    "--prompt", prompt,
    "--silent",
    "--output-format=text",
    "--stream=off",
    "--model", options.model,
    "--max-ai-credits", String(options.maxAiCredits),
    "--available-tools=",
    "--deny-tool=read,write,shell,url,memory",
    "--disable-builtin-mcps",
    "--no-custom-instructions",
    "--no-ask-user",
    "--no-auto-update",
    "--no-color",
    "--no-bash-env",
    "--no-remote",
    "--no-remote-export",
    "--log-level=none",
  ];
}

/**
 * Do not give the CLI unrelated secrets, local hooks/configs or Node preload
 * settings. These few GitHub metadata fields support Actions authentication.
 */
function childEnvironment(root: string, token: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH", "LANG", "LC_ALL", "SYSTEMROOT", "WINDIR",
    "GITHUB_ACTIONS", "GITHUB_REPOSITORY", "GITHUB_REPOSITORY_OWNER",
    "GITHUB_SERVER_URL", "GITHUB_API_URL", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT",
  ]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return {
    ...env,
    HOME: join(root, "home"),
    USERPROFILE: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_CACHE_HOME: join(root, "cache"),
    COPILOT_HOME: join(root, "copilot"),
    COPILOT_CACHE_HOME: join(root, "cache"),
    COPILOT_GITHUB_TOKEN: token,
    COPILOT_AUTO_UPDATE: "false",
    GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS: "false",
    GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS: "false",
    GITHUB_COPILOT_PROMPT_MODE_WORKSPACE_MCP: "false",
    CI: "true",
    NO_COLOR: "1",
  };
}

/**
 * Invoke without a shell: scraped text is one argv value, never executable
 * syntax. A fresh working/config directory keeps repository hooks and local
 * credentials out of the session. This is isolation, not an OS sandbox.
 */
export async function runCopilot(prompt: string, options: CopilotOptions): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "switch-watch-copilot-")));
  try {
    await mkdir(join(root, "home"));
    return await new Promise<string>((resolve, reject) => {
      const child = execFile(
        options.executable ?? "copilot",
        buildCopilotArgs(prompt, options),
        {
          cwd: root,
          env: childEnvironment(root, options.token),
          encoding: "utf8",
          timeout: options.timeoutMs,
          killSignal: "SIGKILL",
          maxBuffer: 512 * 1024,
          windowsHide: true,
        },
        (error, stdout) => {
          // execFile's default error embeds argv and stderr. Never log it:
          // that could leak a token or attacker-controlled workflow commands.
          if (error) {
            const code = String(error.code ?? "unknown");
            const reason = code === "ENOENT"
              ? "Copilot CLI not installed"
              : error.killed
                ? "Copilot CLI timed out or exceeded its output limit"
                : `Copilot CLI failed (${code}); check authentication, model access and quota`;
            reject(new Error(reason));
          } else if (!stdout.trim()) {
            reject(new Error("Copilot CLI returned an empty response"));
          } else {
            resolve(stdout.trim());
          }
        },
      );
      // No stdin prompts or interactive authentication on an Actions runner.
      child.stdin?.end();
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
