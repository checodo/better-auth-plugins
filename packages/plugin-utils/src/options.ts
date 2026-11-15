/**
 * Returns a function that throws an option error prefixed with the plugin
 * id, `[referral] "codeLength" must be ...`, for validating options at
 * plugin creation.
 */
export function createFail(pluginId: string): (message: string) => never {
  return (message) => {
    throw new Error(`[${pluginId}] ${message}`);
  };
}
