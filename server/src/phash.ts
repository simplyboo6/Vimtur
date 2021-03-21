export const PHash = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('phash2');
  } catch (err) {
    console.warn(`Failed to load phash library, disabling functionality: ${err.message}`);
    return undefined;
  }
})();

export default PHash;
