import { cxg, safety } from "./deps.ts";
import * as actv from "./activity.ts";
import * as fr from "./framework.ts";
import * as shExtn from "./shell-exe-extn.ts";
import * as tsExtn from "./typescript-extn.ts";

/**
 * ProxyableCommandText is the name of a "hook" that can be extended.
 */
export type ProxyableCommandText = string;

/**
 * ProxyableCommand is a "hook" that can be executed by plugin.
 */
export interface ProxyableCommand {
  readonly proxyCmd: ProxyableCommandText;
}

export interface DryRunnableProxyableCommand {
  readonly isDryRun: boolean;
}

export const isCommandDryRunnable = safety.typeGuard<
  DryRunnableProxyableCommand
>("isDryRun");

export interface CommandProxyPluginContext<PE extends fr.PluginExecutive>
  extends fr.PluginContext<PE> {
  readonly command: ProxyableCommand;
  readonly arguments?: Record<string, string>;
}

export function isCommandProxyPluginContext<
  PE extends fr.PluginExecutive,
>(
  o: unknown,
): o is CommandProxyPluginContext<PE> {
  if (fr.isPluginContext(o)) {
    return "command" in o;
  }
  return false;
}

/**
   * defaultTypeScriptPluginResultEnhancer should be called by all Deno
   * TypeScript plugins so that we can do centralized "enhancing" of the
   * results of any extension. This allows logging, middleware, and other
   * standard function handling capabilities.
   * @param dfmhResult
   */
export function defaultTypeScriptPluginResultEnhancer<
  PE extends fr.PluginExecutive,
>(
  _cppc: CommandProxyPluginContext<PE>,
  dfmhResult?: tsExtn.DenoFunctionModuleHandlerResult,
): tsExtn.DenoFunctionModuleHandlerResult {
  if (!dfmhResult) return {};
  return dfmhResult;
}

export interface CommandProxyPluginsManagerOptions<
  PE extends fr.PluginExecutive,
  PC extends fr.PluginContext<PE>,
> {
  readonly shellCmdEnvVarsSupplier?: shExtn.ShellCmdEnvVarsSupplier<PE, PC>;
  readonly shellCmdEnvVarsDefaultPrefix?: string;
  readonly shellCmdEnhancer?: shExtn.ShellCmdEnhancer<PE, PC>;
  readonly shellCmdPrepareRunOpts?: shExtn.PrepareShellCmdRunOptions<PE, PC>;
  readonly typeScriptModuleOptions?: tsExtn.TypeScriptRegistrarOptions;
}

export class CommandProxyPluginsManager<
  PE extends fr.PluginExecutive,
  PC extends CommandProxyPluginContext<PE>,
> implements fr.PluginsSupplier {
  readonly plugins: fr.Plugin[] = [];
  readonly pluginsGraph: fr.PluginsGraph = new cxg.CxGraph();
  readonly invalidPlugins: fr.InvalidPluginRegistration[] = [];

  constructor(
    readonly executive: PE,
    readonly commands: Record<ProxyableCommandText, ProxyableCommand>,
    readonly options: CommandProxyPluginsManagerOptions<PE, PC>,
  ) {
  }

  async init(): Promise<void> {
  }

  registerValidPlugin(vpr: fr.ValidPluginRegistration): fr.Plugin {
    // TODO: make sure not to register duplicates; if it's a duplicate,
    // do not add, just return the existing one
    this.plugins.push(vpr.plugin);
    vpr.plugin.registerNode(this.pluginsGraph);
    return vpr.plugin;
  }

  handleInvalidPlugin(
    ipr: fr.InvalidPluginRegistration,
  ): fr.InvalidPluginRegistration {
    this.invalidPlugins.push(ipr);
    return ipr;
  }

  enhanceShellCmd(
    pc: CommandProxyPluginContext<PE>,
    suggestedCmd: string[],
  ): string[] {
    const cmd = [...suggestedCmd];
    cmd.push(pc.command.proxyCmd);
    if (pc.arguments) {
      for (const arg of Object.entries(pc.arguments)) {
        const [name, value] = arg;
        cmd.push(name, value);
      }
    }
    return cmd;
  }

  prepareShellCmdEnvVars(
    pc: CommandProxyPluginContext<PE>,
    envVarsPrefix: string,
  ): Record<string, string> {
    const result: Record<string, string> = {
      [`${envVarsPrefix}PLUGIN_SRC`]: pc.plugin.source.systemID,
      [`${envVarsPrefix}PLUGIN_SRC_FRIENDLY`]: pc.plugin.source.friendlyName,
      [`${envVarsPrefix}PLUGIN_SRC_ABBREV`]: pc.plugin.source.abbreviatedName,
      [`${envVarsPrefix}COMMAND`]: pc.command.proxyCmd,
    };
    if (pc.arguments) {
      if (Object.keys(pc.arguments).length > 0) {
        result.PUBCTLHOOK_ARGS_JSON = JSON.stringify(
          pc.arguments,
        );
      }
    }
    return result;
  }

  createExecutePluginContext(
    command: ProxyableCommand,
    plugin: fr.Plugin,
    options?: {
      readonly onActivity?: fr.PluginActivityReporter;
    },
  ): PC {
    const pc: PC = {
      onActivity: options?.onActivity ||
        ((a: actv.PluginActivity): actv.PluginActivity => {
          console.log(a.message);
          return a;
        }),
      container: this.executive,
      plugin,
      command,
    } as PC; // TODO: figure out why typecasting is required, was getting error
    return pc;
  }

  async execute(
    command: ProxyableCommand,
    options?: {
      readonly onActivity?: fr.PluginActivityReporter;
      readonly onUnhandledPlugin?: (pc: PC) => void;
    },
  ): Promise<fr.ActionResult<PE, PC>[]> {
    const results: fr.ActionResult<PE, PC>[] = [];
    for (const plugin of this.plugins) {
      const cppc = this.createExecutePluginContext(command, plugin, options);
      if (fr.isActionPlugin<PE, PC>(plugin)) {
        results.push(await plugin.execute(cppc));
      } else if (options?.onUnhandledPlugin) {
        options?.onUnhandledPlugin(cppc);
      }
    }
    return results;
  }
}
