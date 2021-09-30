const puppeteer = require('puppeteer');

process.env.CHROME_BIN = puppeteer.executablePath();

module.exports = function (config) {
    config.set({
        plugins: [
            'karma-custom',
            'karma-chrome-launcher',
        ],
        frameworks: ['custom'],
        basePath: "..",
        files: [
            { pattern: 'node_modules/lodash/lodash.min.js', included: true, watched: false, served: true },
            { pattern: 'node_modules/benchmark/benchmark.js', included: true, watched: false, served: true },
            { pattern: 'dist/gandiva.benchmark.browser.js', included: true, watched: false, served: true },
            { pattern: 'dist/*', included: false, watched: false, served: true },
        ],
        autoWatch: false,
        singleRun: true,
        browsers: ['ChromeHeadlessWasmEH'],
        customLaunchers: {
            ChromeHeadlessWasmEH: {
                base: 'ChromeHeadless',
                flags: ['--no-sandbox', '--js-flags="--experimental-wasm-eh"'],
            },
        },
        concurrency: 1, // Only one browser at a time.
        browserNoActivityTimeout: 999999999,
    });
};
