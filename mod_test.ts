import { cxg, govnSvcTelemetry as telem, path, shell } from "./deps.ts";
import { testingAsserts as ta } from "./deps-test.ts";
import * as mod from "./mod.ts";

const testModuleLocalFsPath = path.relative(
  Deno.cwd(),
  path.dirname(import.meta.url).substr("file://".length),
);

const testShellCmdRegistrarOptions: mod.fs.ShellFileRegistrarOptions<
  TestExecutive,
  mod.PluginContext<TestExecutive>
> = {
  shellCmdEnhancer: (
    _pc: mod.PluginContext<TestExecutive>,
    suggestedCmd: string[],
  ): string[] => {
    const cmd = [...suggestedCmd];
    cmd.push("test_added_arg1");
    cmd.push("--test_added_arg2=value");
    return cmd;
  },
  runShellCmdOpts: (): shell.RunShellCommandOptions => {
    return shell.cliVerboseShellOutputOptions;
  },
  envVarsSupplier: (
    pc: mod.PluginContext<TestExecutive>,
  ): Record<string, string> => {
    if (!mod.fs.isDiscoverFileSystemPluginSource(pc.plugin.source)) {
      throw new Error(
        "pc.plugin.source must be DiscoverFileSystemPluginSource",
      );
    }
    const pluginHome = path.dirname(pc.plugin.source.absPathAndFileName);
    const result: Record<string, string> = {
      TEST_EXTN_HOME_ABS: pluginHome,
      TEST_EXTN_HOME_REL: path.relative(
        testModuleLocalFsPath,
        pluginHome,
      ),
      TEST_EXTN_NAME: path.basename(pc.plugin.source.absPathAndFileName),
    };
    return result;
  },
  telemetry: new telem.Telemetry(),
};

export class TestExecutive {
}

export class TestContext implements mod.PluginContext<TestExecutive> {
  constructor(readonly container: TestExecutive, readonly plugin: mod.Plugin) {
  }

  onActivity(
    a: mod.CommandProxyPluginActivity,
    options?: { readonly dryRun?: boolean },
  ): void {
    console.log(a.message, "dryRun:", options?.dryRun);
  }
}

export class TestCustomPluginsManager
  implements mod.fs.FileSystemPluginsSupplier {
  readonly discoveryPath = path.join(testModuleLocalFsPath, "fs", "test");
  readonly plugins: mod.Plugin[] = [];
  readonly pluginsGraph: mod.PluginsGraph = new cxg.CxGraph();
  readonly invalidPlugins: mod.InvalidPluginRegistration[] = [];
  readonly localFsSources: mod.fs.FileSystemGlobs;
  readonly telemetry = new mod.TypicalTypeScriptRegistrarTelemetry();

  constructor(readonly executive: TestExecutive) {
    this.localFsSources = ["**/*.plugin.*"];
  }

  pluginByAbbrevName(name: string): mod.Plugin | undefined {
    return this.plugins.find((p) => p.source.abbreviatedName == name);
  }

  async init(): Promise<void> {
    await mod.fs.discoverFileSystemPlugins(this.executive, {
      discoveryPath: this.discoveryPath,
      globs: this.localFsSources,
      onValidPlugin: (vpr) => {
        this.plugins.push(vpr.plugin);
        vpr.plugin.registerNode(this.pluginsGraph);
      },
      onInvalidPlugin: (ipr) => {
        this.invalidPlugins.push(ipr);
      },
      shellFileRegistryOptions: testShellCmdRegistrarOptions,
      typeScriptFileRegistryOptions: {
        validateModule: mod.registerDenoFunctionModule,
        importModule: (source) => {
          return mod.importCachedModule(source, this.telemetry);
        },
        moduleMetaData: mod.moduleMetaData,
        telemetry: this.telemetry,
      },
    });
  }
}

Deno.test(`File system plugins discovery with custom plugins manager`, async () => {
  const executive = new TestExecutive();
  const pluginsMgr = new TestCustomPluginsManager(executive);
  await pluginsMgr.init();
  ta.assertEquals(6, pluginsMgr.plugins.length);

  // TODO: update as more telemetry is added, right now only TypeScript modules are instrumented
  ta.assertEquals(5, pluginsMgr.telemetry.instruments.length);

  // TODO: register depenedencies and test the graph
  // console.dir(pluginsMgr.pluginsGraph);

  const shellExePlugin = pluginsMgr.pluginByAbbrevName(
    "shell-exe-test.plugin.sh",
  );
  ta.assert(mod.isShellExePlugin(shellExePlugin));

  const tsAsyncPlugin = pluginsMgr.pluginByAbbrevName(
    "typescript-async-fn-test.plugin.ts",
  );
  ta.assert(mod.isDenoFunctionModulePlugin(tsAsyncPlugin));
  if (mod.isDenoFunctionModulePlugin(tsAsyncPlugin)) {
    ta.assert(tsAsyncPlugin.isAsync);
    ta.assertEquals(false, tsAsyncPlugin.isGenerator);
  }

  const tsAsyncGenPlugin = pluginsMgr.pluginByAbbrevName(
    "typescript-async-gfn-test.plugin.ts",
  );
  ta.assert(mod.isDenoFunctionModulePlugin(tsAsyncGenPlugin));
  if (mod.isDenoFunctionModulePlugin(tsAsyncGenPlugin)) {
    ta.assert(tsAsyncGenPlugin.isAsync);
    ta.assert(tsAsyncGenPlugin.isGenerator);
  }

  const tsSyncPlugin = pluginsMgr.pluginByAbbrevName(
    "typescript-sync-fn-test.plugin.ts",
  );
  ta.assert(mod.isDenoFunctionModulePlugin(tsSyncPlugin));
  if (mod.isDenoFunctionModulePlugin(tsSyncPlugin)) {
    ta.assertEquals(
      tsSyncPlugin.source.graphNodeName,
      "testSyncPluginFunction-graphNodeName",
    );
    ta.assertEquals(false, tsSyncPlugin.isAsync);
    ta.assertEquals(false, tsSyncPlugin.isGenerator);
  }

  const tsSyncGenPlugin = pluginsMgr.pluginByAbbrevName(
    "typescript-sync-gfn-test.plugin.ts",
  );
  ta.assert(mod.isDenoFunctionModulePlugin(tsSyncPlugin));
  if (mod.isDenoFunctionModulePlugin(tsSyncGenPlugin)) {
    ta.assertEquals(false, tsSyncGenPlugin.isAsync);
    ta.assert(tsSyncGenPlugin.isGenerator);
  }

  const tsConstructedPlugin = pluginsMgr.pluginByAbbrevName("constructed");
  ta.assert(mod.isDenoModulePlugin(tsConstructedPlugin));
  ta.assert("activateCountState" in tsConstructedPlugin);
  ta.assert("executeCountState" in tsConstructedPlugin);
});

Deno.test(`File system plugins discovery with commands proxy plugins manager`, async () => {
  const describeCmd: mod.ProxyableCommand = { proxyCmd: "describe" };
  const pluginsMgr = new mod.fs.CommandProxyFileSystemPluginsManager(
    new TestExecutive(),
    {
      [describeCmd.proxyCmd]: describeCmd,
    },
    {
      discoveryPath: path.join(testModuleLocalFsPath, "fs", "test"),
      localFsSources: ["**/*.cmd-plugin.*"],
      shellCmdPrepareRunOpts: (): shell.RunShellCommandOptions => {
        // usually we want output to go to the console but we're overriding it
        // in the test case so that we don't show anything but we can test it
        // with asserts
        return {};
      },
    },
  );
  await pluginsMgr.init();
  const pluginByAbbrevName = (name: string): mod.Plugin | undefined => {
    return pluginsMgr.plugins.find((p) => p.source.abbreviatedName == name);
  };

  ta.assertEquals(6, pluginsMgr.plugins.length);

  // TODO: register depenedencies and test the graph
  // console.dir(pluginsMgr.pluginsGraph);

  const shellExePlugin = pluginByAbbrevName(
    "shell-exe-test.cmd-plugin.sh",
  );
  ta.assert(mod.isShellExePlugin(shellExePlugin));

  const tsAsyncPlugin = pluginByAbbrevName(
    "typescript-async-fn-test.cmd-plugin.ts",
  );
  ta.assert(mod.isDenoFunctionModulePlugin(tsAsyncPlugin));
  if (mod.isDenoFunctionModulePlugin(tsAsyncPlugin)) {
    ta.assert(tsAsyncPlugin.isAsync);
    ta.assertEquals(false, tsAsyncPlugin.isGenerator);
  }

  const tsAsyncGenPlugin = pluginByAbbrevName(
    "typescript-async-gfn-test.cmd-plugin.ts",
  );
  ta.assert(mod.isDenoFunctionModulePlugin(tsAsyncGenPlugin));
  if (mod.isDenoFunctionModulePlugin(tsAsyncGenPlugin)) {
    ta.assert(tsAsyncGenPlugin.isAsync);
    ta.assert(tsAsyncGenPlugin.isGenerator);
  }

  const tsSyncPlugin = pluginByAbbrevName(
    "typescript-sync-fn-test.cmd-plugin.ts",
  );
  ta.assert(mod.isDenoFunctionModulePlugin(tsSyncPlugin));
  if (mod.isDenoFunctionModulePlugin(tsSyncPlugin)) {
    ta.assertEquals(false, tsSyncPlugin.isAsync);
    ta.assertEquals(false, tsSyncPlugin.isGenerator);
  }

  const tsSyncGenPlugin = pluginByAbbrevName(
    "typescript-sync-gfn-test.cmd-plugin.ts",
  );
  ta.assert(mod.isDenoFunctionModulePlugin(tsSyncGenPlugin));
  if (mod.isDenoFunctionModulePlugin(tsSyncGenPlugin)) {
    ta.assertEquals(false, tsSyncGenPlugin.isAsync);
    ta.assert(tsSyncGenPlugin.isGenerator);
  }

  const tsConstructedPlugin = pluginByAbbrevName("constructed");
  ta.assert(mod.isDenoModulePlugin(tsConstructedPlugin));

  let unhandledCount = 0;
  const results = await pluginsMgr.execute(describeCmd, {
    onUnhandledPlugin: (cppc) => {
      unhandledCount++;
      console.error("UNABLE TO EXECUTE");
      console.dir(cppc);
    },
  });
  ta.assertEquals(0, unhandledCount);
  ta.assertEquals(6, results.length);

  ta.assert("activateCountState" in tsConstructedPlugin);
  ta.assert("executeCountState" in tsConstructedPlugin);
  // deno-lint-ignore no-explicit-any
  ta.assert((tsConstructedPlugin as any).activateCountState == 0);
  // deno-lint-ignore no-explicit-any
  ta.assert((tsConstructedPlugin as any).executeCountState > 0);

  results.forEach((r) => {
    if (mod.isShellExeActionResult(r)) {
      if (shell.isExecutionResult(r.rscResult)) {
        const expected =
          "Describe what will be generated in 'test.auto.md' in '.' by shell-exe-test.cmd-plugin.sh\n";
        const output = new TextDecoder().decode(
          r.rscResult.stdOut,
        );
        ta.assertEquals(output, expected);
      }
    }
  });
});
