require('dotenv').config({ quiet: true })

const path = require('node:path')
const webpack = require('webpack')
const TerserPlugin = require('terser-webpack-plugin')
const CopyWebpackPlugin = require('copy-webpack-plugin')
const HTMLWebpackPlugin = require('html-webpack-plugin')
const ESLintPlugin = require('eslint-webpack-plugin')
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin')

const extensionName = 'Censor Tracker'

function resolve(dir) {
  return path.join(__dirname, dir)
}

const BROWSER = process.env.BROWSER
const NODE_ENV = process.env.NODE_ENV || 'development'
const PRODUCTION = NODE_ENV === 'production'
const OUTPUT_SUB_DIR = PRODUCTION ? 'prod' : 'dev'

const isFirefox = BROWSER === 'firefox'
const isChromium = BROWSER === 'chrome'

const contentSecurityPolicy = {
  'Content-Security-Policy': `script-src 'self'; object-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com`,
}

const webWorkerConfig = {
  mode: NODE_ENV,
  devtool: 'inline-nosources-cheap-module-source-map',
  target: isFirefox ? 'webworker' : 'web',
  entry: {
    background: './src/shared/js/background/background.js',
  },
  output: {
    path: resolve(`dist/chrome/${OUTPUT_SUB_DIR}`),
    filename: '[name].js',
    publicPath: PRODUCTION ? '' : '/',
  },

  resolve: {
    extensions: ['.js', '.json'],
    alias: {
      '@': resolve('src'),
      Background: resolve('src/shared/js/background'),
    },
  },

  optimization: {
    minimize: true,
    minimizer: [],
    moduleIds: 'named',
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        use: 'babel-loader',
        exclude: /node_modules/,
        include: [resolve('src')],
      },
    ],
  },
}

const webConfig = {
  mode: NODE_ENV,
  // Also see: https://webpack.js.org/configuration/devtool/#devtool
  target: 'web',
  devtool: 'inline-nosources-cheap-module-source-map',
  entry: {
    popup: './src/shared/js/pages/popup.js',
    options: './src/shared/js/pages/options.js',
    'advanced-options': './src/shared/js/pages/advanced-options.js',
    'proxy-options': './src/shared/js/pages/proxy-options.js',
    'registry-options': './src/shared/js/pages/registry-options.js',
    'rules-editor': './src/shared/js/pages/rules-editor.js',
    translator: './src/shared/js/pages/translator.js',
    controlled: './src/shared/js/pages/controlled.js',
  },
  output: {
    path: resolve(`dist/${BROWSER}/${OUTPUT_SUB_DIR}`),
    filename: '[name].js',
    publicPath: PRODUCTION ? '' : '/',
  },
  resolve: {
    extensions: ['.js', '.json'],
    alias: {
      '@': resolve('src'),
      Background: resolve('src/shared/js/background'),
    },
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        use: 'babel-loader',
        exclude: /node_modules/,
        include: [resolve('src')],
      },
      {
        test: /\.(png|jpe?g|gif|svg)$/,
        type: 'asset/resource',
        generator: { filename: 'images/[name][ext]' },
      },
    ],
  },

  plugins: [
    new ESLintPlugin({ context: resolve('src'), failOnWarning: true }),
    ...(PRODUCTION ? [] : [new webpack.HotModuleReplacementPlugin()]),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: resolve(`src/{${BROWSER},shared}/manifest/*.json`),
          to: 'manifest.json',
          transformAll: (assets) =>
            JSON.stringify(
              Object.assign(
                {},
                ...assets.map(({ data }) => JSON.parse(data.toString())),
              ),
            ),
        },
        {
          from: resolve('src/shared/images'),
          to: resolve(`dist/${BROWSER}/${OUTPUT_SUB_DIR}/images`),
        },
        {
          from: resolve('src/shared/css'),
          to: resolve(`dist/${BROWSER}/${OUTPUT_SUB_DIR}/css`),
        },
        {
          from: resolve('src/shared/_locales/'),
          to: resolve(`dist/${BROWSER}/${OUTPUT_SUB_DIR}/_locales`),
        },
      ],
    }),
    new HTMLWebpackPlugin({
      title: extensionName,
      filename: 'popup.html',
      template: 'src/shared/pages/popup.html',
      inject: true,
      chunks: ['popup', 'translator'],
      meta: contentSecurityPolicy,
    }),
    new HTMLWebpackPlugin({
      filename: 'ignore-list.html',
      template: 'src/shared/pages/ignore-list.html',
      inject: true,
      chunks: ['rules-editor', 'translator'],
      meta: contentSecurityPolicy,
    }),
    new HTMLWebpackPlugin({
      filename: 'proxy-list.html',
      template: 'src/shared/pages/proxy-list.html',
      inject: true,
      chunks: ['rules-editor', 'translator'],
      meta: contentSecurityPolicy,
    }),
    new HTMLWebpackPlugin({
      title: extensionName,
      filename: 'registry.html',
      template: 'src/shared/pages/registry.html',
      inject: true,
      chunks: ['registry-options', 'translator'],
      meta: contentSecurityPolicy,
    }),
    new HTMLWebpackPlugin({
      filename: 'options.html',
      template: 'src/shared/pages/options.html',
      inject: true,
      chunks: ['options', 'translator'],
      meta: contentSecurityPolicy,
    }),
    new HTMLWebpackPlugin({
      filename: 'advanced-options.html',
      template: 'src/shared/pages/advanced-options.html',
      inject: true,
      chunks: ['advanced-options', 'translator'],
      meta: contentSecurityPolicy,
    }),
    new HTMLWebpackPlugin({
      title: extensionName,
      filename: 'proxy-options.html',
      template: 'src/shared/pages/proxy-options.html',
      inject: true,
      chunks: ['proxy-options', 'controlled'],
      meta: contentSecurityPolicy,
    }),
    new HTMLWebpackPlugin({
      title: extensionName,
      filename: 'controlled.html',
      template: `src/shared/pages/controlled.html`,
      inject: true,
      chunks: ['controlled'],
      meta: contentSecurityPolicy,
    }),
  ],
  optimization: {
    minimize: true,
    minimizer: [new CssMinimizerPlugin()],
    moduleIds: 'named',
  },
}

if (isFirefox) {
  webConfig.entry.background = `./src/shared/js/background/background.js`
  webConfig.entry.incognito_required = `./src/firefox/js/pages/incognito-required.js`
  webConfig.entry.installed = './src/firefox/js/pages/installed.js'
  webConfig.plugins.push(
    new HTMLWebpackPlugin({
      title: extensionName,
      filename: 'incognito-required-popup.html',
      template: 'src/firefox/pages/incognito-required-popup.html',
      inject: true,
      chunks: ['translator', 'incognito_required'],
      meta: contentSecurityPolicy,
    }),
  )
  webConfig.plugins.push(
    new HTMLWebpackPlugin({
      title: extensionName,
      filename: 'installed.html',
      template: 'src/firefox/pages/installed.html',
      inject: true,
      chunks: ['installed', 'translator'],
      meta: contentSecurityPolicy,
    }),
  )
  webConfig.plugins.push(
    new HTMLWebpackPlugin({
      title: extensionName,
      filename: 'incognito-required-tab.html',
      template: 'src/firefox/pages/incognito-required-tab.html',
      inject: true,
      chunks: ['translator', 'incognito_required'],
      meta: contentSecurityPolicy,
    }),
  )
}

if (isChromium) {
  webConfig.plugins.push(
    new HTMLWebpackPlugin({
      title: extensionName,
      filename: 'installed.html',
      template: `src/${BROWSER}/pages/installed.html`,
      inject: true,
      chunks: ['translator'],
      meta: contentSecurityPolicy,
    }),
  )
}

if (PRODUCTION) {
  // See https://git.io/JmiaL
  // See https://webpack.js.org/configuration/devtool/#production
  webConfig.devtool = 'nosources-source-map'

  // See https://webpack.js.org/configuration/optimization/#optimizationminimize
  webConfig.optimization.minimize = true
  webConfig.optimization.minimizer.push(
    new TerserPlugin({
      terserOptions: {
        output: {
          comments: false,
        },
      },
    }),
  )
  webWorkerConfig.devtool = 'nosources-source-map'
  webWorkerConfig.optimization.minimize = true
  webWorkerConfig.optimization.minimizer = [
    new TerserPlugin({
      terserOptions: {
        output: {
          comments: false,
        },
      },
    }),
  ]
}

module.exports = [webConfig, webWorkerConfig]
