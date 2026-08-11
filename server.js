// Legacy-resolution entry for 'base44-revenuecat/server'.
//
// Modern toolchains read the "exports" map in package.json and load
// server.cjs (require) or server.mjs (import). Some older runtime resolvers
// ignore the exports map entirely — webpack 4, older Jest resolvers, older
// Metro, browserify — and look for a sibling file named server.js. Without
// this shim those consumers type-check fine against server.d.ts and then fail
// at runtime with MODULE_NOT_FOUND.
//
// Keep it a plain re-export: the implementation lives in server.cjs.

'use strict'

module.exports = require('./server.cjs')
