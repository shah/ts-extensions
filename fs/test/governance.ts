import { extn, safety } from "../deps.ts";

export type TestPlugin = extn.DenoModulePlugin;
export type TestPluginSupplier = extn.PluginSupplier;
export type TestPluginFunction = extn.DenoFunctionModuleHandler;
export type TestPluginFunctionResult = extn.DenoFunctionModuleHandlerResult;

// deno-lint-ignore no-empty-interface
export interface TestPluginActivatable extends
  extn.Activatable<
    extn.PluginsManager,
    extn.ActivateContext<extn.PluginsManager>,
    extn.DeactivateContext<extn.PluginsManager>
  > {
}

export interface TestActionSupplier {
  readonly execute: () => Promise<void>;
}

export interface TestState extends extn.PluginGraphNodeSupplier {
  activateCountState: number;
  activateGraphCountState: number;
  deactivateCountState: number;
  deactivateGraphCountState: number;
  executeCountState: number;
}

export const isTestState = safety.typeGuard<TestState>(
  "activateCountState",
  "activateGraphCountState",
  "deactivateGraphCountState",
  "deactivateCountState",
  "executeCountState",
  "graphNode",
);
