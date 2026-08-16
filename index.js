// n8n loads this package through the `n8n` key in package.json, not through
// `main`. This entry exists so the package is still requireable as a plain
// module rather than resolving to nothing.
module.exports = {};
